const express = require('express');
const router = express.Router();
const verifyToken = require('../Middlewares/verifyTokens');
const User = require('../Models/User');
const { getIO } = require('../utils/socket');
const Delivery = require('../Models/Delivery');

// Get driver profile
router.get('/profile', verifyToken, async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'driver') return res.status(403).json({ message: 'Accès réservé aux livreurs' });
    const user = await User.findById(req.user.id).select('-userPassword -googleId');
    res.json({ success: true, data: user });
  } catch (e) {
    console.error('[driverRoutes] GET /profile error', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// Update driver status
router.patch('/status', verifyToken, async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'driver') return res.status(403).json({ message: 'Accès réservé aux livreurs' });
    const { status } = req.body;
    if (!['available','unavailable','on_delivery'].includes(status)) return res.status(400).json({ message: 'Status invalide' });
    const user = await User.findByIdAndUpdate(req.user.id, { driverStatus: status }, { new: true }).select('-userPassword -googleId');
    res.json({ success: true, data: user });
  } catch (e) {
    console.error('[driverRoutes] PATCH /status error', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// Post driver location (emits socket event and persists last location)
router.post('/location', verifyToken, async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'driver') return res.status(403).json({ message: 'Accès réservé aux livreurs' });
    const { latitude, longitude, accuracy, heading, speed } = req.body || {};
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return res.status(400).json({ message: 'Coordonnées invalides' });

    const loc = { latitude, longitude, accuracy, heading, speed, updatedAt: new Date() };
    const user = await User.findByIdAndUpdate(req.user.id, { currentLocation: loc }, { new: true }).select('-userPassword -googleId');

    try {
      const io = getIO();
      // Emit to the driver's own room and to any active deliveries assigned to them
      io.to(`driver_${String(req.user.id)}`).emit('driver:location', { driverId: String(req.user.id), location: loc });
      const active = await Delivery.find({ driverId: req.user.id, status: { $in: ['ASSIGNED','ACCEPTED','PICKED_UP','IN_TRANSIT','ARRIVED'] } }).select('_id');
      if (active && active.length) {
        active.forEach(d => {
          io.to(`delivery_${String(d._id)}`).emit('driver:location', { driverId: String(req.user.id), deliveryId: String(d._id), location: loc });
        });
      }
    } catch (e) {
      // socket not initialized — ignore
    }

    res.json({ success: true, data: { userId: req.user.id, location: loc } });
  } catch (e) {
    console.error('[driverRoutes] POST /location error', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
