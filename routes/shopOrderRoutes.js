const express = require('express');
const verifyToken = require('../Middlewares/verifyTokens');
const ShopOrder = require('../Models/ShopOrder');
const { streamOrderInvoicePdf } = require('../utils/invoiceGenerator');

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const router = express.Router();

// GET - mes commandes (ShopOrder)
router.get('/my-orders', verifyToken, async (req, res) => {
  return res.status(403).json({
    success: false,
    message: "L'accès à l'historique des commandes via l'application est suspendu. Vos codes QR et détails de commande vous ont été envoyés par email."
  });
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
