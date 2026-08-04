const express = require('express');
const verifyToken = require('../Middlewares/verifyTokens');
const ShopOrder = require('../Models/ShopOrder');

const router = express.Router();

// GET - mes commandes (ShopOrder)
router.get('/my-orders', verifyToken, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;
    const filter = { customerId: req.user.id };
    const orders = await ShopOrder.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
    const total = await ShopOrder.countDocuments(filter);
    return res.json({ success: true, data: orders, pagination: { currentPage: parseInt(page), totalPages: Math.ceil(total / limit), totalItems: total } });
  } catch (err) {
    console.error('[shopOrderRoutes] my-orders error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET - details ShopOrder
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const order = await ShopOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Commande introuvable' });
    if (order.customerId && order.customerId.toString() !== req.user.id && !['admin', 'dev-admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Accès refusé' });
    }
    return res.json({ success: true, data: order });
  } catch (err) {
    console.error('[shopOrderRoutes] get error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
