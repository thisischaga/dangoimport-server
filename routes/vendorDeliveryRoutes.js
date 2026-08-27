const express = require('express');
const router = express.Router();
const VendorDeliveryZone = require('../Models/VendorDeliveryZone');
const User = require('../Models/User');
const verifyToken = require('../Middlewares/verifyTokens');

const ensureVendor = async (req, res, next) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Non autorisé' });
    }

    const user = await User.findById(userId);
    if (!user || user.role !== 'vendor') {
      return res.status(403).json({ message: 'Accès vendeur requis' });
    }

    req.vendorUser = user;
    next();
  } catch (error) {
    console.error('[vendorDeliveryRoutes] ensureVendor error:', error);
    return res.status(500).json({ message: 'Erreur vendeur' });
  }
};

router.get('/public/:vendorId', async (req, res) => {
  try {
    const vendorId = req.params.vendorId;
    if (!vendorId) {
      return res.status(400).json({ message: 'Identifiant vendeur requis' });
    }

    const zones = await VendorDeliveryZone.find({
      vendorId,
      isActive: true,
    }).sort({ country: 1, city: 1, zoneName: 1 });

    return res.status(200).json({ success: true, data: zones });
  } catch (error) {
    console.error('[vendorDeliveryRoutes] public get zones error:', error);
    return res.status(500).json({ message: 'Erreur récupération zones vendeur' });
  }
});

router.use(verifyToken);
router.use(ensureVendor);

router.get('/zones', async (req, res) => {
  try {
    const zones = await VendorDeliveryZone.find({
      vendorId: req.vendorUser._id,
      isActive: true,
    }).sort({ country: 1, city: 1, zoneName: 1 });

    return res.status(200).json({ success: true, data: zones });
  } catch (error) {
    console.error('[vendorDeliveryRoutes] get zones error:', error);
    return res.status(500).json({ message: 'Erreur récupération zones' });
  }
});

router.get('/zones/:country', async (req, res) => {
  try {
    const zones = await VendorDeliveryZone.find({
      vendorId: req.vendorUser._id,
      country: req.params.country,
      isActive: true,
    }).sort({ city: 1, zoneName: 1 });

    return res.status(200).json({ success: true, data: zones });
  } catch (error) {
    console.error('[vendorDeliveryRoutes] get zones by country error:', error);
    return res.status(500).json({ message: 'Erreur zones pays' });
  }
});

router.post('/zones', async (req, res) => {
  try {
    const {
      country,
      region,
      city,
      zoneName,
      deliveryFee,
      estimatedDelivery,
      pickupAddress,
      notes,
      isDefault,
    } = req.body;

    if (!country || !zoneName) {
      return res.status(400).json({ message: 'Pays et zone requis' });
    }

    const zone = await VendorDeliveryZone.create({
      vendorId: req.vendorUser._id,
      storeId: req.vendorUser.storeId || null,
      country,
      region: region || '',
      city: city || '',
      zoneName,
      deliveryFee: Number(deliveryFee || 0),
      estimatedDelivery: estimatedDelivery || '',
      pickupAddress: pickupAddress || '',
      notes: notes || '',
      isDefault: Boolean(isDefault),
    });

    return res.status(201).json({ success: true, data: zone });
  } catch (error) {
    console.error('[vendorDeliveryRoutes] create zone error:', error);
    return res.status(500).json({ message: 'Erreur création zone' });
  }
});

router.put('/zones/:id', async (req, res) => {
  try {
    const zone = await VendorDeliveryZone.findOne({
      _id: req.params.id,
      vendorId: req.vendorUser._id,
    });

    if (!zone) {
      return res.status(404).json({ message: 'Zone introuvable' });
    }

    Object.assign(zone, req.body);
    await zone.save();

    return res.status(200).json({ success: true, data: zone });
  } catch (error) {
    console.error('[vendorDeliveryRoutes] update zone error:', error);
    return res.status(500).json({ message: 'Erreur mise à jour zone' });
  }
});

router.delete('/zones/:id', async (req, res) => {
  try {
    const zone = await VendorDeliveryZone.findOne({
      _id: req.params.id,
      vendorId: req.vendorUser._id,
    });

    if (!zone) {
      return res.status(404).json({ message: 'Zone introuvable' });
    }

    zone.isActive = false;
    await zone.save();

    return res.status(200).json({ success: true, message: 'Zone désactivée' });
  } catch (error) {
    console.error('[vendorDeliveryRoutes] delete zone error:', error);
    return res.status(500).json({ message: 'Erreur suppression zone' });
  }
});

module.exports = router;
