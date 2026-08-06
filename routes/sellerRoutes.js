const express = require('express');
const mongoose = require('mongoose');
const ShopOrder = require('../Models/ShopOrder');
const VendorOrder = require('../Models/VendorOrder');
const QRCode = require('../Models/QRCode');
const Store = require('../Models/Store');
const User = require('../Models/User');
const AuditLog = require('../Models/AuditLog');
const Notification = require('../Models/Notification');
const verifyToken = require('../Middlewares/verifyTokens');
const emailService = require('../utils/emailService');
const { validateVendorQr, markQrUsed } = require('../services/qrCodeService');

const router = express.Router();

const verifySeller = async (req, res, next) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Token vendeur invalide.' });
    }

    const user = await User.findById(userId);
    if (!user || user.role !== 'vendor') {
      return res.status(403).json({ success: false, message: 'Accès réservé aux vendeurs.' });
    }

    req.vendorUser = user;
    next();
  } catch (error) {
    console.error('[sellerRoutes] verifySeller error:', error);
    return res.status(500).json({ success: false, message: 'Erreur de vérification vendeur.' });
  }
};

const getSellerStore = async (req, res, next) => {
  try {
    const store = await Store.findOne({ userId: req.vendorUser._id });
    if (!store) {
      return res.status(404).json({ success: false, message: 'Boutique introuvable pour ce vendeur.' });
    }
    req.storeId = store._id;
    next();
  } catch (error) {
    console.error('[sellerRoutes] getSellerStore error:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur lors de la récupération de la boutique.' });
  }
};

router.get('/orders', verifyToken, verifySeller, getSellerStore, async (req, res) => {
  try {
    const orders = await VendorOrder.find({ storeId: req.storeId })
      .sort({ createdAt: -1 })
      .populate({
        path: 'shopOrderId',
        select: 'orderNumber paymentStatus status customerName customerEmail customerPhone shippingAddress createdAt',
      });

    return res.status(200).json({ success: true, data: orders });
  } catch (error) {
    console.error('[sellerRoutes] get orders:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur lors de la récupération des commandes vendeur.' });
  }
});

router.get('/orders/:id', verifyToken, verifySeller, getSellerStore, async (req, res) => {
  try {
    const order = await VendorOrder.findOne({ _id: req.params.id, storeId: req.storeId })
      .populate({
        path: 'shopOrderId',
        select: 'orderNumber paymentStatus status customerName customerEmail customerPhone shippingAddress items subtotal shippingCost total paymentMethod createdAt',
      });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Commande vendeur introuvable.' });
    }

    const qrTokens = await QRCode.find({ orderId: order.shopOrderId?._id, vendorId: req.vendorUser._id })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, data: { ...order.toObject(), qrTokens } });
  } catch (error) {
    console.error('[sellerRoutes] get order detail:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur lors de la récupération du détail de la commande vendeur.' });
  }
});

router.post('/scan', verifyToken, verifySeller, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, message: 'Le code QR est requis.' });
    }

    session.startTransaction();
    const qrDoc = await validateVendorQr({ code: token, vendorUserId: req.vendorUser._id, session });
    const order = await ShopOrder.findById(qrDoc.orderId).session(session);
    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Commande associée introuvable.' });
    }

    const vendorIdToUse = qrDoc.vendorId ? String(qrDoc.vendorId) : String(req.vendorUser._id);
    const vendorItems = order.items.filter((item) => String(item.vendorId) === vendorIdToUse);
    if (vendorItems.length === 0) {
      await session.abortTransaction();
      return res.status(403).json({ success: false, message: 'Vous n’êtes pas autorisé à valider cette commande.' });
    }

    const validatedItems = vendorItems.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      selectedOptions: item.selectedOptions,
      subtotal: item.subtotal,
    }));

    order.items = order.items.map((item) => {
      if (String(item.vendorId) === vendorIdToUse) {
        const itemObject = typeof item.toObject === 'function' ? item.toObject() : item;
        return {
          ...itemObject,
          delivered: true,
          deliveredAt: new Date(),
        };
      }
      return item;
    });

    const isFullyDelivered = order.items.every((item) => item.delivered === true);
    if (isFullyDelivered) {
      order.status = 'delivered';
      order.deliveredAt = new Date();
    } else if (['pending', 'confirmed'].includes(order.status)) {
      order.status = 'processing';
    }
    order.updatedAt = new Date();
    await order.save({ session });

    await markQrUsed({ qrDoc, session });

    await AuditLog.create([
      {
        userId: req.vendorUser._id,
        userName: `${req.vendorUser.userFirstname || ''} ${req.vendorUser.userSurname || ''}`.trim(),
        role: req.vendorUser.role,
        action: 'SELLER_QR_SCAN',
        targetResource: 'ShopOrder',
        targetId: order._id,
        details: {
          qrCode: qrDoc.code,
          validatedItems,
          vendorName: req.vendorUser.vendorName || `${req.vendorUser.userFirstname || ''} ${req.vendorUser.userSurname || ''}`.trim(),
          orderStatus: order.status,
          paymentStatus: order.paymentStatus,
        },
        ipAddress: req.ip,
      }
    ], { session });

    if (order.customerId) {
      const notification = {
        recipient: order.customerId.toString(),
        recipientType: 'user',
        title: 'Votre commande a été mise à jour',
        message: isFullyDelivered
          ? `Votre commande ${order.orderNumber} a été remise en totalité.`
          : `Une partie de votre commande ${order.orderNumber} a été remise.`,
        type: 'order_delivery',
        link: `/mes-commandes/${order._id}`,
        isRead: false,
      };
      await Notification.create([notification], { session });

      if (isFullyDelivered) {
        await emailService.sendOrderDeliveredEmail({
          customerEmail: order.customerEmail,
          customerName: order.customerName,
          orderNumber: order.orderNumber,
          vendorName: req.vendorUser.vendorName || '',
          amount: order.total,
        });
      }
    }

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: 'QR validé avec succès.',
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        orderStatus: order.status,
        paymentStatus: order.paymentStatus,
        validatedItems,
        qrToken: qrDoc.code,
        qrStatus: 'used',
        isFullyDelivered,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('[sellerRoutes] scan error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Erreur lors de la validation du QR.' });
  } finally {
    session.endSession();
  }
});

router.post('/confirm-delivery', verifyToken, verifySeller, getSellerStore, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const { vendorOrderId, orderId } = req.body;
    if (!vendorOrderId && !orderId) {
      return res.status(400).json({ success: false, message: 'vendorOrderId ou orderId est requis.' });
    }

    let vendorOrder = null;
    if (vendorOrderId) {
      vendorOrder = await VendorOrder.findOne({ _id: vendorOrderId, storeId: req.storeId }).session(session);
    }
    if (!vendorOrder && orderId) {
      vendorOrder = await VendorOrder.findOne({ shopOrderId: orderId, storeId: req.storeId }).session(session);
    }
    if (!vendorOrder) {
      return res.status(404).json({ success: false, message: 'Commande vendeur introuvable pour la confirmation.' });
    }

    session.startTransaction();
    vendorOrder.status = 'delivered';
    await vendorOrder.save({ session });

    const shopOrder = await ShopOrder.findById(vendorOrder.shopOrderId).session(session);
    if (shopOrder) {
      const vendorIdToUse = String(req.vendorUser._id);
      shopOrder.items = shopOrder.items.map((item) => {
        if (String(item.vendorId) === vendorIdToUse) {
          return {
            ...item.toObject?.(),
            ...item,
            delivered: true,
            deliveredAt: new Date(),
          };
        }
        return item;
      });

      const isFullyDelivered = shopOrder.items.every((item) => item.delivered === true);
      if (isFullyDelivered) {
        shopOrder.status = 'delivered';
        shopOrder.deliveredAt = new Date();
      } else if (['pending', 'confirmed'].includes(shopOrder.status)) {
        shopOrder.status = 'processing';
      }
      shopOrder.updatedAt = new Date();
      await shopOrder.save({ session });
    }

    await session.commitTransaction();
    return res.status(200).json({ success: true, message: 'Livraison confirmée pour le vendeur.', data: { vendorOrderId: vendorOrder._id, shopOrderId: vendorOrder.shopOrderId } });
  } catch (error) {
    await session.abortTransaction();
    console.error('[sellerRoutes] confirm-delivery error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Erreur lors de la confirmation de livraison.' });
  } finally {
    session.endSession();
  }
});

module.exports = router;
