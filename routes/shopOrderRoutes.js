const express = require('express');
const mongoose = require('mongoose');
const verifyToken = require('../Middlewares/verifyTokens');
const ShopOrder = require('../Models/ShopOrder');
const { streamOrderInvoicePdf } = require('../utils/invoiceGenerator');

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const router = express.Router();

function sanitizeOrderForClient(order) {
  const doc = order?.toObject ? order.toObject() : order;
  if (!doc) return null;

  return {
    _id: doc._id,
    orderNumber: doc.orderNumber,
    status: doc.status,
    paymentStatus: doc.paymentStatus,
    createdAt: doc.createdAt,
    paymentDate: doc.paymentDate,
    subtotal: doc.subtotal,
    shippingCost: doc.shippingCost,
    discount: doc.discount,
    total: doc.total,
    items: (doc.items || []).map((item) => ({
      productId: item.productId,
      productName: item.productName,
      productImage: item.productImage,
      vendorName: item.vendorName,
      quantity: item.quantity,
      price: item.price,
    })),
    shippingAddress: doc.shippingAddress
      ? {
          city: doc.shippingAddress.city,
          country: doc.shippingAddress.country,
        }
      : undefined,
  };
}

// GET - mes commandes (ShopOrder) — historique sans QR ni données sensibles
router.get('/my-orders', verifyToken, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const userEmail = String(req.user?.userEmail || '').trim().toLowerCase();

    const orFilters = [];
    if (userId) {
      if (mongoose.Types.ObjectId.isValid(userId)) {
        orFilters.push({ customerId: new mongoose.Types.ObjectId(userId) });
      }
      orFilters.push({ customerId: String(userId) });
    }
    if (userEmail) {
      orFilters.push({ customerEmail: new RegExp(`^${escapeRegExp(userEmail)}$`, 'i') });
    }

    if (orFilters.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const orders = await ShopOrder.find({ $or: orFilters })
      .sort({ createdAt: -1 })
      .limit(100)
      .select('-qrCodeIds -adminNotes -notes -history -customerPhone')
      .lean();

    return res.json({
      success: true,
      data: orders.map(sanitizeOrderForClient).filter(Boolean),
    });
  } catch (err) {
    console.error('[shopOrderRoutes] my-orders error:', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET - details ShopOrder
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const order = await ShopOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Commande introuvable' });

    const userEmail = (req.user.userEmail || '').trim().toLowerCase();
    const isCustomerIdMatch = order.customerId && order.customerId.toString() === req.user.id;
    const isEmailMatch = order.customerEmail && userEmail && order.customerEmail.toLowerCase() === userEmail;

    if (!isCustomerIdMatch && !isEmailMatch && !['admin', 'dev-admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Accès refusé' });
    }
    return res.json({ success: true, data: order });
  } catch (err) {
    console.error('[shopOrderRoutes] get error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/:id/invoice', verifyToken, async (req, res) => {
  try {
    const order = await ShopOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Commande introuvable' });

    const userEmail = (req.user.userEmail || '').trim().toLowerCase();
    const isCustomerIdMatch = order.customerId && order.customerId.toString() === req.user.id;
    const isEmailMatch = order.customerEmail && userEmail && order.customerEmail.toLowerCase() === userEmail;

    if (!isCustomerIdMatch && !isEmailMatch && !['admin', 'dev-admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Accès refusé' });
    }

    streamOrderInvoicePdf(res, order, { fileName: `facture-${order.orderNumber || order._id}.pdf` });
  } catch (err) {
    console.error('[shopOrderRoutes] invoice error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }
});

module.exports = router;
