const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const verifyToken = require('../Middlewares/verifyTokens');
const Delivery = require('../Models/Delivery');
const DeliveryList = require('../Models/DeliveryList');
const User = require('../Models/User');
const { changeStatus, pushEvent } = require('../services/deliveryService');

const requireDeliveryDriver = (req, res, next) => {
  if (!req.user || req.user.role !== 'driver') {
    return res.status(403).json({ success: false, message: 'Accès réservé aux livreurs.' });
  }
  return next();
};

router.get('/lists', verifyToken, requireDeliveryDriver, async (req, res) => {
  try {
    const lists = await DeliveryList.find({ driverId: req.user.id }).sort({ scheduledDate: -1, createdAt: -1 }).lean();
    res.json({ success: true, data: lists });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/lists/:id', verifyToken, requireDeliveryDriver, async (req, res) => {
  try {
    const list = await DeliveryList.findOne({ _id: req.params.id, driverId: req.user.id }).lean();
    if (!list) return res.status(404).json({ success: false, message: 'Liste introuvable.' });
    const deliveries = await Delivery.find({ _id: { $in: list.deliveryIds } }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: { ...list, deliveries } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/deliveries', verifyToken, requireDeliveryDriver, async (req, res) => {
  try {
    const deliveries = await Delivery.find({ driverId: req.user.id }).sort({ createdAt: -1 }).limit(200).lean();
    res.json({ success: true, data: deliveries });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/deliveries/:id', verifyToken, requireDeliveryDriver, async (req, res) => {
  try {
    const delivery = await Delivery.findOne({ _id: req.params.id, driverId: req.user.id }).lean();
    if (!delivery) return res.status(403).json({ success: false, message: 'Cette livraison ne fait pas partie de vos livraisons.' });
    res.json({ success: true, data: delivery });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/:id', verifyToken, requireDeliveryDriver, async (req, res) => {
  try {
    const delivery = await Delivery.findOne({ _id: req.params.id, driverId: req.user.id }).lean();
    if (!delivery) return res.status(403).json({ success: false, message: 'Cette livraison ne fait pas partie de vos livraisons.' });
    res.json({ success: true, data: delivery });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/history', verifyToken, requireDeliveryDriver, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      Delivery.find({ driverId: req.user.id, status: { $in: ['DELIVERED', 'CANCELLED', 'FAILED'] } }).sort({ deliveredAt: -1, updatedAt: -1 }).skip(skip).limit(limit).lean(),
      Delivery.countDocuments({ driverId: req.user.id, status: { $in: ['DELIVERED', 'CANCELLED', 'FAILED'] } }),
    ]);
    res.json({ success: true, data: items, pagination: { page, limit, total } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/deliveries/:id/accept', verifyToken, requireDeliveryDriver, async (req, res) => {
  try {
    const delivery = await Delivery.findOne({ _id: req.params.id, driverId: req.user.id });
    if (!delivery) return res.status(403).json({ success: false, message: 'Cette livraison ne fait pas partie de vos livraisons.' });
    const updated = await changeStatus(delivery._id, 'ACCEPTED', req.user.id, req.user.role, { metadata: { driverId: req.user.id } });
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/:id/accept', verifyToken, requireDeliveryDriver, async (req, res) => {
  try {
    const delivery = await Delivery.findOne({ _id: req.params.id, driverId: req.user.id });
    if (!delivery) return res.status(403).json({ success: false, message: 'Cette livraison ne fait pas partie de vos livraisons.' });
    const updated = await changeStatus(delivery._id, 'ACCEPTED', req.user.id, req.user.role, { metadata: { driverId: req.user.id } });
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/deliveries/:id/decline', verifyToken, requireDeliveryDriver, async (req, res) => {
  try {
    const delivery = await Delivery.findOne({ _id: req.params.id, driverId: req.user.id });
    if (!delivery) return res.status(403).json({ success: false, message: 'Cette livraison ne fait pas partie de vos livraisons.' });
    const updated = await changeStatus(delivery._id, 'CANCELLED', req.user.id, req.user.role, { metadata: { driverId: req.user.id, action: 'declined' } });
    res.json({ success: true, data: updated, message: 'Livraison déclinée.' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/:id/decline', verifyToken, requireDeliveryDriver, async (req, res) => {
  try {
    const delivery = await Delivery.findOne({ _id: req.params.id, driverId: req.user.id });
    if (!delivery) return res.status(403).json({ success: false, message: 'Cette livraison ne fait pas partie de vos livraisons.' });
    const updated = await changeStatus(delivery._id, 'CANCELLED', req.user.id, req.user.role, { metadata: { driverId: req.user.id, action: 'declined' } });
    res.json({ success: true, data: updated, message: 'Livraison déclinée.' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.patch('/deliveries/:id/status', verifyToken, requireDeliveryDriver, async (req, res) => {
  try {
    const { status } = req.body || {};
    const delivery = await Delivery.findOne({ _id: req.params.id, driverId: req.user.id });
    if (!delivery) return res.status(403).json({ success: false, message: 'Cette livraison ne fait pas partie de vos livraisons.' });
    const updated = await changeStatus(delivery._id, status, req.user.id, req.user.role, { metadata: { driverId: req.user.id } });
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/scan', verifyToken, requireDeliveryDriver, async (req, res) => {
  try {
    const { token, type } = req.body || {};
    if (!token) return res.status(400).json({ success: false, code: 'INVALID_QR', message: 'Code colis invalide.' });

    const candidateHash = crypto.createHash('sha256').update(String(token)).digest('hex');
    const delivery = await Delivery.findOne({ qrHash: candidateHash, driverId: req.user.id }).lean();
    if (!delivery) {
      const anyDelivery = await Delivery.findOne({ qrHash: candidateHash }).lean();
      if (anyDelivery) {
        return res.status(403).json({ success: false, message: 'Ce colis ne fait pas partie de vos livraisons.' });
      }
      return res.status(404).json({ success: false, code: 'INVALID_QR', message: 'Code colis invalide.' });
    }

    if (['DELIVERED', 'CANCELLED', 'FAILED'].includes(delivery.status)) {
      return res.status(409).json({ success: false, code: 'ALREADY_SCANNED', message: 'Ce colis a déjà été scanné.' });
    }

    if (type && type === 'PICKUP_SCAN' && delivery.status !== 'ACCEPTED') {
      return res.status(400).json({ success: false, message: 'Le scan de retrait n’est pas autorisé à ce stade.' });
    }

    const nextStatus = delivery.status === 'ASSIGNED' ? 'ACCEPTED' : delivery.status === 'ACCEPTED' ? 'PICKED_UP' : delivery.status === 'PICKED_UP' ? 'IN_TRANSIT' : delivery.status === 'IN_TRANSIT' ? 'ARRIVED' : 'DELIVERED';
    const updated = await changeStatus(delivery._id, nextStatus, req.user.id, req.user.role, { metadata: { driverId: req.user.id, scanType: type || 'AUTO' } });

    res.json({ success: true, message: 'Scan validé.', data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/driver', verifyToken, requireDeliveryDriver, async (req, res) => {
  try {
    const deliveries = await Delivery.find({ driverId: req.user.id }).sort({ createdAt: -1 }).limit(200).lean();
    res.json({ success: true, data: deliveries });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
