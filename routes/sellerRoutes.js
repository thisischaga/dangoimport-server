const express = require('express');
const mongoose = require('mongoose');
const ShopOrder = require('../Models/ShopOrder');
const VendorOrder = require('../Models/VendorOrder');
const QRCode = require('../Models/QRCode');
const Store = require('../Models/Store');
const User = require('../Models/User');
const AuditLog = require('../Models/AuditLog');
const OrderHistory = require('../Models/OrderHistory');
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
        select: 'orderNumber paymentStatus status customerName customerEmail customerPhone shippingAddress createdAt items',
      });

    const enrichedOrders = orders.map((order) => {
      const shopOrder = order.shopOrderId;
      if (!shopOrder) return order.toObject();
      const vendorIdToUse = String(req.vendorUser._id);
      const vendorItems = (shopOrder.items || []).filter((item) => String(item.vendorId) === vendorIdToUse);
      return {
        ...order.toObject(),
        items: vendorItems.map(item => ({
          productId: item.productId,
          productName: item.productName,
          productImage: item.productImage,
          quantity: item.quantity,
          price: item.price,
          subtotal: item.subtotal || (item.price * item.quantity)
        })),
        paymentStatus: shopOrder.paymentStatus,
        deliveryStatus: order.status || shopOrder.status,
      };
    });

    return res.status(200).json({ success: true, data: enrichedOrders });
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

    const shopOrder = order.shopOrderId;
    const vendorIdToUse = String(req.vendorUser._id);
    const vendorItems = shopOrder ? (shopOrder.items || []).filter((item) => String(item.vendorId) === vendorIdToUse) : [];

    const qrTokens = await QRCode.find({ orderId: shopOrder?._id, vendorId: req.vendorUser._id })
      .sort({ createdAt: -1 })
      .lean();

    const data = {
      ...order.toObject(),
      items: vendorItems.map(item => ({
        productId: item.productId,
        productName: item.productName,
        productImage: item.productImage,
        quantity: item.quantity,
        price: item.price,
        subtotal: item.subtotal || (item.price * item.quantity)
      })),
      paymentStatus: shopOrder ? shopOrder.paymentStatus : 'pending',
      deliveryStatus: order.status || (shopOrder ? shopOrder.status : 'pending'),
      qrTokens
    };

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('[sellerRoutes] get order detail:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur lors de la récupération du détail de la commande vendeur.' });
  }
});

router.post('/scan', verifyToken, verifySeller, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, message: 'Le code QR est requis.' });
    }

    const QRCodeModel = require('../Models/QRCode');
    const qrDoc = await QRCodeModel.findOne({ code: token });
    if (!qrDoc) {
      return res.status(404).json({ success: false, message: 'Code QR introuvable.' });
    }

    if (qrDoc.expiresAt && new Date(qrDoc.expiresAt) < new Date() && qrDoc.status === 'active') {
      qrDoc.status = 'expired';
      await qrDoc.save();
    }

    const order = await ShopOrder.findById(qrDoc.orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Commande associée introuvable.' });
    }

    const store = await Store.findOne({ userId: req.vendorUser._id });
    const vendorName = req.vendorUser.vendorName || store?.name || '';

    // Authorization check
    let isAuthorized = req.vendorUser.role === 'admin';
    if (!isAuthorized) {
      if (qrDoc.vendorId) {
        const qrVidStr = String(qrDoc.vendorId);
        if (qrVidStr === String(req.vendorUser._id) || (store && qrVidStr === String(store._id))) {
          isAuthorized = true;
        }
      }
      if (!isAuthorized && qrDoc.vendorName && qrDoc.vendorName.trim().toLowerCase() === vendorName.trim().toLowerCase()) {
        isAuthorized = true;
      }
      if (!isAuthorized && !qrDoc.vendorId) {
        // Fallback for legacy orders missing vendorId on QR
        const hasMatchingItem = order.items.some(item => 
          (item.vendorId && (String(item.vendorId) === String(req.vendorUser._id) || (store && String(item.vendorId) === String(store._id)))) ||
          (item.vendorName && item.vendorName.trim().toLowerCase() === vendorName.trim().toLowerCase())
        );
        if (hasMatchingItem) isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({ success: false, message: 'Vous n’êtes pas autorisé à valider ce code QR.' });
    }

    // Filter vendor items based on the matching criteria
    const vendorItems = order.items.filter((item) => {
      const vidMatch = item.vendorId && (String(item.vendorId) === String(req.vendorUser._id) || (store && String(item.vendorId) === String(store._id)));
      const vNameMatch = item.vendorName && item.vendorName.trim().toLowerCase() === vendorName.trim().toLowerCase();
      const qrVidMatch = item.vendorId && qrDoc.vendorId && String(item.vendorId) === String(qrDoc.vendorId);
      return vidMatch || vNameMatch || qrVidMatch;
    });

    const storeName = store ? store.name : (qrDoc.vendorName || 'Boutique');

    const vendorTotal = vendorItems.reduce((sum, item) => sum + Number(item.subtotal || item.price * item.quantity || 0), 0);

    const data = {
      qrCode: qrDoc.code,
      status: qrDoc.status,
      alreadyUsed: qrDoc.status === 'used',
      usedAt: qrDoc.usedAt || qrDoc.scannedAt,
      validatedBy: qrDoc.vendorName || 'Vendeur',
      orderId: order._id,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      storeName: storeName,
      items: vendorItems.map(item => ({
        productId: item.productId,
        productName: item.productName,
        productImage: item.productImage,
        quantity: item.quantity,
        price: item.price,
        subtotal: item.subtotal || (item.price * item.quantity)
      })),
      vendorTotal: vendorTotal,
      createdAt: order.createdAt,
      paymentDate: order.paymentDate,
      paymentStatus: order.paymentStatus,
      deliveryStatus: order.status
    };

    return res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    console.error('[sellerRoutes] scan error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Erreur lors de la lecture du QR.' });
  }
});

router.post('/confirm-delivery', verifyToken, verifySeller, getSellerStore, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const { token, vendorOrderId, orderId } = req.body;
    
    session.startTransaction();

    let qrDoc = null;
    let shopOrderId = orderId;
    let storeIdToUse = req.storeId;

    if (token) {
      qrDoc = await QRCode.findOne({ code: token }).session(session);
      if (!qrDoc) {
        await session.abortTransaction();
        return res.status(404).json({ success: false, message: 'Code QR introuvable.' });
      }
      if (qrDoc.status !== 'active') {
        await session.abortTransaction();
        return res.status(400).json({ success: false, message: 'Ce code QR est invalide ou déjà utilisé.' });
      }
      shopOrderId = qrDoc.orderId;
    }

    let vendorOrder = null;
    if (vendorOrderId) {
      vendorOrder = await VendorOrder.findOne({ _id: vendorOrderId, storeId: storeIdToUse }).session(session);
    } else if (shopOrderId) {
      vendorOrder = await VendorOrder.findOne({ shopOrderId, storeId: storeIdToUse }).session(session);
    }

    if (!vendorOrder) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Commande vendeur introuvable pour la confirmation.' });
    }

    if (qrDoc) {
      qrDoc.status = 'used';
      qrDoc.usedAt = new Date();
      qrDoc.scannedAt = qrDoc.scannedAt || new Date();
      await qrDoc.save({ session });
    }

    vendorOrder.status = 'delivered';
    await vendorOrder.save({ session });

    const store = await Store.findOne({ userId: req.vendorUser._id }).session(session);
    const vendorName = req.vendorUser.vendorName || store?.name || '';

    if (shopOrder) {
      shopOrder.items = shopOrder.items.map((item) => {
        const vidMatch = item.vendorId && (String(item.vendorId) === String(req.vendorUser._id) || (store && String(item.vendorId) === String(store._id)));
        const vNameMatch = item.vendorName && item.vendorName.trim().toLowerCase() === vendorName.trim().toLowerCase();
        const qrVidMatch = item.vendorId && qrDoc?.vendorId && String(item.vendorId) === String(qrDoc.vendorId);
        
        if (vidMatch || vNameMatch || qrVidMatch || req.vendorUser.role === 'admin') {
          const itemObject = typeof item.toObject === 'function' ? item.toObject() : item;
          return {
            ...itemObject,
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

      await AuditLog.create([
        {
          userId: req.vendorUser._id,
          userName: `${req.vendorUser.userFirstname || ''} ${req.vendorUser.userSurname || ''}`.trim(),
          role: req.vendorUser.role,
          action: 'SELLER_QR_CONFIRM_DELIVERY',
          targetResource: 'ShopOrder',
          targetId: shopOrder._id,
          details: {
            token,
            vendorName: req.vendorUser.vendorName || `${req.vendorUser.userFirstname || ''} ${req.vendorUser.userSurname || ''}`.trim(),
            isFullyDelivered,
          },
          ipAddress: req.ip,
        }
      ], { session, ordered: true });

      const eventLogs = [
        {
          orderId: shopOrder._id,
          event: token ? 'qr_scanned' : 'delivered',
          details: {
            token: token || '',
            vendorName: req.vendorUser.vendorName || `${req.vendorUser.userFirstname || ''} ${req.vendorUser.userSurname || ''}`.trim(),
            itemsCount: shopOrder.items.filter(item => String(item.vendorId) === vendorIdToUse).length
          },
          createdBy: req.vendorUser.vendorName || `${req.vendorUser.userFirstname || ''} ${req.vendorUser.userSurname || ''}`.trim(),
        }
      ];

      if (isFullyDelivered) {
        eventLogs.push({
          orderId: shopOrder._id,
          event: 'order_delivered',
          details: {
            orderNumber: shopOrder.orderNumber
          },
          createdBy: 'system',
        });
      }
      await OrderHistory.create(eventLogs, { session, ordered: true });

      if (shopOrder.customerId) {
        const notification = {
          recipient: shopOrder.customerId.toString(),
          recipientType: 'user',
          title: 'Votre commande a été mise à jour',
          message: isFullyDelivered
            ? `Votre commande ${shopOrder.orderNumber} a été remise en totalité.`
            : `Une partie de votre commande ${shopOrder.orderNumber} a été remise.`,
          type: 'order_delivery',
          link: `/mes-commandes/${shopOrder._id}`,
          isRead: false,
        };
        await Notification.create([notification], { session });

        await emailService.sendOrderDeliveredEmail({
          customerEmail: shopOrder.customerEmail,
          customerName: shopOrder.customerName,
          orderNumber: shopOrder.orderNumber,
          vendorName: req.vendorUser.vendorName || '',
          amount: shopOrder.total,
        });
      }
    }

    await session.commitTransaction();
    return res.status(200).json({
      success: true,
      message: 'Livraison confirmée avec succès.',
      data: {
        vendorOrderId: vendorOrder._id,
        shopOrderId: vendorOrder.shopOrderId,
        status: 'delivered'
      }
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('[sellerRoutes] confirm-delivery error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Erreur lors de la confirmation de livraison.' });
  } finally {
    session.endSession();
  }
});

module.exports = router;
