const express = require('express');
const router = express.Router();
const verifyToken = require('../Middlewares/verifyTokens');
const Delivery = require('../Models/Delivery');
const { changeStatus, pushEvent } = require('../services/deliveryService');

// Get deliveries assigned to driver (filter by role driver)
router.get('/driver', verifyToken, async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'driver') return res.status(403).json({ message: 'Accès réservé aux livreurs' });
    const deliveries = await Delivery.find({ driverId: req.user.id }).sort({ createdAt: -1 }).limit(200);
    res.json({ success: true, data: deliveries });
  } catch (e) {
    console.error('[deliveryRoutes] GET /driver error', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// Get single delivery
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const d = await Delivery.findById(req.params.id);
    if (!d) return res.status(404).json({ success: false, message: 'Delivery not found' });
    // ensure driver or admin can view
    if (req.user.role !== 'admin' && String(d.driverId) !== String(req.user.id)) return res.status(403).json({ message: 'Not allowed' });
    res.json({ success: true, data: d });
  } catch (e) {
    console.error('[deliveryRoutes] GET /:id error', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// Driver accepts a delivery
router.post('/:id/accept', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'driver') return res.status(403).json({ message: 'Accès réservé aux livreurs' });
    const delivery = await changeStatus(req.params.id, 'ACCEPTED', req.user.id, req.user.role, { metadata: { driverId: req.user.id } });
    res.json({ success: true, data: delivery });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// Mark picked up
router.post('/:id/pickup', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'driver') return res.status(403).json({ message: 'Accès réservé aux livreurs' });
    const delivery = await changeStatus(req.params.id, 'PICKED_UP', req.user.id, req.user.role, { metadata: { driverId: req.user.id } });
    res.json({ success: true, data: delivery });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// Start transit
router.post('/:id/start', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'driver') return res.status(403).json({ message: 'Accès réservé aux livreurs' });
    const { location } = req.body || {};
    const delivery = await changeStatus(req.params.id, 'IN_TRANSIT', req.user.id, req.user.role, { location, metadata: { driverId: req.user.id } });
    res.json({ success: true, data: delivery });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// Arrived
router.post('/:id/arrive', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'driver') return res.status(403).json({ message: 'Accès réservé aux livreurs' });
    const delivery = await changeStatus(req.params.id, 'ARRIVED', req.user.id, req.user.role, { metadata: { driverId: req.user.id } });
    res.json({ success: true, data: delivery });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// Confirm delivery (should be validated server-side via QR/OTP)
router.post('/:id/confirm', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'driver') return res.status(403).json({ message: 'Accès réservé aux livreurs' });
    // For safety, require server-side check before allowing DELIVERED; here we trust an external QR route to validate
    const delivery = await changeStatus(req.params.id, 'DELIVERED', req.user.id, req.user.role, { metadata: { driverId: req.user.id } });
    res.json({ success: true, data: delivery });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// Fail delivery
router.post('/:id/fail', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'driver') return res.status(403).json({ message: 'Accès réservé aux livreurs' });
    const { reason } = req.body || {};
    const delivery = await changeStatus(req.params.id, 'FAILED', req.user.id, req.user.role, { updates: { failureReason: reason } });
    res.json({ success: true, data: delivery });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

module.exports = router;
