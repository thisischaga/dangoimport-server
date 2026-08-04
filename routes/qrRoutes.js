const express = require('express');
const ShopOrder = require('../Models/ShopOrder');
const User = require('../Models/User');
const verifyToken = require('../Middlewares/verifyTokens');
const AuditLog = require('../Models/AuditLog');
const Notification = require('../Models/Notification');
const emailService = require('../utils/emailService');

const router = express.Router();

const QR_TOKEN_EXPIRES_IN = '24h';

const generatePayload = ({ orderId, orderNumber, vendorId, vendorName, vendorTotal, paymentMethod, expiresAt }) => ({
  orderId,
  orderNumber,
  vendorId,
  vendorName,
  vendorTotal,
  paymentMethod,
  expiresAt: expiresAt.toISOString(),
});

router.post('/generate/:orderId', verifyToken, async (req, res) => {
  try {
    const order = await ShopOrder.findById(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Commande introuvable' });

    if (order.customerId && order.customerId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Accès refusé' });
    }

    if (order.paymentStatus !== 'completed' && order.status !== 'confirmed') {
      return res.status(400).json({ success: false, message: 'Paiement non confirmé' });
    }

    // Find QRCode documents for this order
    const QRModel = require('../Models/QRCode');
    let qrDocs = await QRModel.find({ orderId: order._id });

    // If the requester is the customer, ensure ownership
    if (req.user && req.user.role === 'customer') {
      if (order.customerId && order.customerId.toString() !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Accès refusé' });
      }
    }

    // If requester is vendor, filter to vendor-specific QR docs
    if (req.user && req.user.role === 'vendor') {
      qrDocs = qrDocs.filter((q) => q.vendorId && String(q.vendorId) === String(req.user.id));
      if (!qrDocs.length) {
        return res.status(404).json({ success: false, message: 'Aucun QR disponible pour ce vendeur' });
      }
    }

    const qrTokens = qrDocs.map((q) => ({
      vendorId: q.vendorId || null,
      vendorName: q.vendorName || 'Vendeur',
      vendorTotal: q.metadata?.vendorTotal || 0,
      token: q.code,
      expiresAt: q.expiresAt,
      status: q.status,
    }));

    return res.json({ success: true, data: { orderId: order._id, orderNumber: order.orderNumber, qrTokens } });
  } catch (error) {
    console.error('[qrRoutes] generate token error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/validate', verifyToken, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Token absent' });

    const QRModel = require('../Models/QRCode');
    const qrDoc = await QRModel.findOne({ code: token });
    if (!qrDoc) return res.status(404).json({ success: false, message: 'QR introuvable' });

    if (qrDoc.expiresAt && new Date(qrDoc.expiresAt) < new Date()) {
      qrDoc.status = 'expired';
      await qrDoc.save();
      return res.status(400).json({ success: false, message: 'QR expiré' });
    }

    if (qrDoc.status === 'used' || qrDoc.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'QR invalide ou déjà utilisé' });
    }

    const order = await ShopOrder.findById(qrDoc.orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Commande introuvable' });

    if (order.paymentStatus !== 'completed' && order.status !== 'confirmed') {
      return res.status(400).json({ success: false, message: 'Paiement non confirmé' });
    }

    const vendorUser = await User.findById(req.user.id);
    if (!vendorUser || (vendorUser.role !== 'vendor' && vendorUser.role !== 'admin')) {
      return res.status(403).json({ success: false, message: 'Accès vendeur requis' });
    }

    const vendorIdToUse = qrDoc.vendorId ? String(qrDoc.vendorId) : String(req.user.id);
    const vendorItems = order.items.filter((item) => String(item.vendorId) === vendorIdToUse);
    if (vendorItems.length === 0 && vendorUser.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Vous n’êtes pas autorisé à valider cette commande' });
    }

    const validatedItems = vendorItems.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      selectedOptions: item.selectedOptions,
      subtotal: item.subtotal,
    }));

    // Mark items delivered for this vendor
    order.items = order.items.map((item) => {
      if (String(item.vendorId) === vendorIdToUse) {
        return { ...item, delivered: true, deliveredAt: new Date() };
      }
      return item;
    });

    const isFullyDelivered = order.items.every((item) => item.delivered === true);
    if (isFullyDelivered) {
      order.status = 'delivered';
      order.deliveredAt = new Date();
    } else {
      order.status = 'processing';
    }

    order.updatedAt = new Date();
    await order.save();

    qrDoc.status = 'used';
    qrDoc.usedAt = new Date();
    qrDoc.scannedAt = qrDoc.scannedAt || new Date();
    await qrDoc.save();

    await AuditLog.create({
      userId: req.user.id,
      userName: `${vendorUser.userFirstname || ''} ${vendorUser.userSurname || ''}`.trim(),
      role: vendorUser.role,
      action: 'QR_VALIDATION',
      targetResource: 'ShopOrder',
      targetId: order._id,
      details: {
        vendorId: vendorIdToUse,
        vendorName: qrDoc.vendorName || vendorUser.storeName || '',
        validatedItems,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] || '',
      },
    });

    if (order.customerId) {
      await Notification.create({
        recipient: order.customerId.toString(),
        recipientType: 'user',
        title: 'Votre commande a été remise',
        message: `Votre commande ${order.orderNumber} a été remise avec succès.`,
        type: 'order_delivered',
        link: `/mes-commandes/${order._id}`,
        isRead: false,
      });

      await emailService.sendOrderDeliveredEmail({
        customerEmail: order.customerEmail,
        customerName: order.customerName,
        orderNumber: order.orderNumber,
        vendorName: qrDoc.vendorName || vendorUser.storeName || '',
        amount: order.total,
      });
    }

    return res.json({ success: true, message: 'Commande validée avec succès', data: { orderId: order._id, orderNumber: order.orderNumber, validatedItems, orderStatus: order.status } });
  } catch (error) {
    console.error('[qrRoutes] validation error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
