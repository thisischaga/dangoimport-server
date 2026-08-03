const express = require('express');
const jwt = require('jsonwebtoken');
const Order = require('../Models/Commande');
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
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Commande introuvable' });

    if (order.customerId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Accès refusé' });
    }

    if (order.paymentStatus !== 'completed') {
      return res.status(400).json({ success: false, message: 'Paiement non confirmé' });
    }

    const vendorGroups = order.items.reduce((groups, item) => {
      const vendorName = item.vendorName || 'Vendeur Indépendant';
      const vendorId = item.vendorId ? item.vendorId.toString() : null;
      const key = `${vendorId || 'unknown'}::${vendorName}`;

      if (!groups[key]) {
        groups[key] = {
          vendorId,
          vendorName,
          items: [],
        };
      }

      groups[key].items.push(item);
      return groups;
    }, {});

    const qrTokens = Object.values(vendorGroups).map((group) => {
      const vendorTotal = group.items.reduce((sum, item) => sum + (item.subtotal || 0), 0);
      const payload = generatePayload({
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        vendorId: group.vendorId,
        vendorName: group.vendorName,
        vendorTotal,
        paymentMethod: order.paymentMethod,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      const token = jwt.sign(payload, process.env.QR_SECRET || process.env.JWT_SECRET, {
        expiresIn: QR_TOKEN_EXPIRES_IN,
      });

      return {
        vendorId: group.vendorId,
        vendorName: group.vendorName,
        vendorTotal,
        token,
      };
    });

    return res.json({ success: true, data: { orderId: order._id, orderNumber: order.orderNumber, qrTokens } });
  } catch (error) {
    console.error('[qrRoutes] generate token error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/validate', verifyToken, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, message: 'Token absent' });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.QR_SECRET || process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Token invalide ou expiré' });
    }

    const order = await Order.findById(payload.orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Commande introuvable' });
    }

    if (order.paymentStatus !== 'completed') {
      return res.status(400).json({ success: false, message: 'Paiement non confirmé' });
    }

    if (order.status === 'delivered') {
      return res.status(400).json({ success: false, message: 'Commande déjà remise' });
    }

    const vendorItems = order.items.filter((item) => item.vendorId?.toString() === payload.vendorId?.toString());
    if (vendorItems.length === 0) {
      return res.status(403).json({ success: false, message: 'Vous n’êtes pas autorisé à valider cette commande' });
    }

    const vendorUser = await User.findById(req.user.id);
    if (!vendorUser || (vendorUser.role !== 'vendor' && vendorUser.role !== 'admin')) {
      return res.status(403).json({ success: false, message: 'Accès vendeur requis' });
    }

    const validatedItems = vendorItems.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      selectedOptions: item.selectedOptions,
      subtotal: item.subtotal,
    }));

    const isFullyDelivered = order.items.every((item) => item.delivered === true || item.vendorId?.toString() === payload.vendorId?.toString());

    order.items = order.items.map((item) => {
      if (item.vendorId?.toString() === payload.vendorId?.toString()) {
        return { ...item, delivered: true, deliveredAt: new Date() };
      }
      return item;
    });

    if (isFullyDelivered) {
      order.status = 'delivered';
      order.deliveredAt = new Date();
    } else {
      order.status = 'processing';
    }

    order.updatedAt = new Date();
    await order.save();

    await AuditLog.create({
      userId: req.user.id,
      userName: `${vendorUser.userFirstname || ''} ${vendorUser.userSurname || ''}`.trim(),
      role: vendorUser.role,
      action: 'QR_VALIDATION',
      targetResource: 'Order',
      targetId: order._id,
      details: {
        vendorId: payload.vendorId,
        vendorName: payload.vendorName,
        validatedItems,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] || '',
      },
    });

    await Notification.create({
      recipient: order.customerId.toString(),
      recipientType: 'user',
      title: 'Votre commande a été remise',
      message: `Votre commande ${order.orderNumber} a été remise avec succès par ${payload.vendorName}.`,
      type: 'order_delivered',
      link: `/mes-commandes/${order._id}`,
      isRead: false,
    });

    await emailService.sendOrderDeliveredEmail({
      customerEmail: order.customerEmail,
      customerName: order.customerName,
      orderNumber: order.orderNumber,
      vendorName: payload.vendorName,
      amount: order.total,
    });

    return res.json({ success: true, message: 'Commande validée avec succès', data: { orderId: order._id, orderNumber: order.orderNumber, validatedItems, orderStatus: order.status } });
  } catch (error) {
    console.error('[qrRoutes] validation error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
