const express = require('express');
const mongoose = require('mongoose');
const verifyToken = require('../Middlewares/verifyTokens');
const { requireAdminFromDb } = require('../Middlewares/securityHelpers');
const ShopOrder = require('../Models/ShopOrder');
const {
  getLocalDeliveryConfig,
  updateLocalDeliveryConfig,
} = require('../services/localDeliveryPricingService');

const router = express.Router();

router.use(verifyToken, requireAdminFromDb);

router.get('/config', async (_req, res) => {
  try {
    const config = await getLocalDeliveryConfig({ forceRefresh: true });
    return res.json({ success: true, config });
  } catch (error) {
    console.error('[adminLocalDeliveryRoutes] GET /config:', error);
    return res.status(500).json({ success: false, message: 'Impossible de charger la grille de livraison locale.' });
  }
});

router.put('/config', async (req, res) => {
  try {
    const actor = req.user?.id || req.user?.userId || req.user?.email || 'admin';
    const config = await updateLocalDeliveryConfig(req.body?.config || req.body || {}, actor);
    return res.json({ success: true, message: 'Grille de livraison locale enregistrée.', config });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('[adminLocalDeliveryRoutes] PUT /config:', error);
    return res.status(status).json({ success: false, message: error.message || 'Impossible d’enregistrer la grille locale.' });
  }
});

router.get('/transport-costs', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const filter = { orderType: 'dropshipping' };
    const [orders, total] = await Promise.all([
      ShopOrder.find(filter)
        .select('orderNumber customerName shippingCost importShipping shippingAddress createdAt transportCostTracking')
        .select('+transportCostTracking')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ShopOrder.countDocuments(filter),
    ]);
    return res.json({
      success: true,
      data: orders.map((order) => {
        const tracking = order.transportCostTracking || {};
        const estimatedInternationalCost = Number(
          tracking.estimatedInternationalCost
          ?? order.importShipping?.internationalShippingCost
          ?? order.importShipping?.baseCost
          ?? 0,
        );
        const estimatedLocalDeliveryCost = Number(
          tracking.estimatedLocalDeliveryCost
          ?? order.importShipping?.localDeliveryFee
          ?? 0,
        );
        const actualComplete = tracking.actualInternationalCost != null
          && tracking.actualLocalDeliveryCost != null;
        const actualTotal = actualComplete
          ? Number(tracking.actualInternationalCost) + Number(tracking.actualLocalDeliveryCost)
          : null;
        return {
          _id: order._id,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          country: order.shippingAddress?.country || '',
          city: order.shippingAddress?.city || '',
          createdAt: order.createdAt,
          customerShippingPaid: Number(order.shippingCost || 0),
          estimatedInternationalCost,
          estimatedLocalDeliveryCost,
          actualInternationalCost: tracking.actualInternationalCost ?? '',
          actualLocalDeliveryCost: tracking.actualLocalDeliveryCost ?? '',
          actualRecordedAt: tracking.actualRecordedAt || null,
          note: tracking.note || '',
          variance: actualComplete ? actualTotal - estimatedInternationalCost - estimatedLocalDeliveryCost : null,
          shippingMargin: actualComplete ? Number(order.shippingCost || 0) - actualTotal : null,
          localZone: order.importShipping?.localDelivery?.zoneName || '',
        };
      }),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('[adminLocalDeliveryRoutes] GET /transport-costs:', error);
    return res.status(500).json({ success: false, message: 'Impossible de charger les coûts de transport.' });
  }
});

router.patch('/transport-costs/:orderId', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.orderId)) {
      return res.status(400).json({ success: false, message: 'Identifiant de commande invalide.' });
    }
    const order = await ShopOrder.findOne({ _id: req.params.orderId, orderType: 'dropshipping' })
      .select('+transportCostTracking');
    if (!order) return res.status(404).json({ success: false, message: 'Commande dropshipping introuvable.' });

    const current = order.transportCostTracking || {};
    for (const field of ['actualInternationalCost', 'actualLocalDeliveryCost']) {
      if (req.body[field] === undefined) continue;
      if (req.body[field] === null || req.body[field] === '') {
        current[field] = null;
        continue;
      }
      const value = Number(req.body[field]);
      if (!Number.isFinite(value) || value < 0) {
        return res.status(400).json({ success: false, message: `${field} doit être un montant positif ou nul.` });
      }
      current[field] = value;
    }
    if (req.body.note !== undefined) {
      if (typeof req.body.note !== 'string' || req.body.note.length > 500) {
        return res.status(400).json({ success: false, message: 'La note doit contenir au maximum 500 caractères.' });
      }
      current.note = req.body.note.trim();
    }

    current.estimatedInternationalCost = Number(
      current.estimatedInternationalCost
      ?? order.importShipping?.internationalShippingCost
      ?? order.importShipping?.baseCost
      ?? 0,
    );
    current.estimatedLocalDeliveryCost = Number(
      current.estimatedLocalDeliveryCost
      ?? order.importShipping?.localDeliveryFee
      ?? 0,
    );
    const actualComplete = current.actualInternationalCost != null
      && current.actualLocalDeliveryCost != null;
    if (actualComplete) {
      const actualTotal = Number(current.actualInternationalCost) + Number(current.actualLocalDeliveryCost);
      current.variance = actualTotal - current.estimatedInternationalCost - current.estimatedLocalDeliveryCost;
      current.shippingMargin = Number(order.shippingCost || 0) - actualTotal;
      current.actualRecordedAt = new Date();
      current.actualRecordedBy = String(req.user?.id || req.user?.userId || req.user?.email || 'admin');
    } else {
      current.variance = null;
      current.shippingMargin = null;
      current.actualRecordedAt = null;
      current.actualRecordedBy = '';
    }
    order.transportCostTracking = current;
    await order.save();
    return res.json({ success: true, message: 'Coûts réels enregistrés sans modifier le total payé.', data: { _id: order._id } });
  } catch (error) {
    console.error('[adminLocalDeliveryRoutes] PATCH /transport-costs/:orderId:', error);
    return res.status(500).json({ success: false, message: 'Impossible d’enregistrer les coûts réels.' });
  }
});

module.exports = router;
