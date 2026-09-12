const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const verifyToken = require('../Middlewares/verifyTokens');
const Delivery = require('../Models/Delivery');
const DeliveryList = require('../Models/DeliveryList');
const QRCode = require('../Models/QRCode');
const User = require('../Models/User');
const ShopOrder = require('../Models/ShopOrder');
const { changeStatus, pushEvent } = require('../services/deliveryService');
const { extractQrToken } = require('../utils/qrTokenParser');

const requireDeliveryDriver = (req, res, next) => {
  if (!req.user || req.user.role !== 'driver') {
    return res.status(403).json({ success: false, message: 'Accès réservé aux livreurs.' });
  }
  return next();
};

function formatDeliveryForDriver(item, orderMap = new Map(), userMap = new Map()) {
  if (!item) return item;
  const meta = item.metadata || {};
  const order = orderMap.get(String(item.orderId));
  const customerUser = userMap.get(String(item.customerId));
  const pickupAddress = item.pickupLocation?.address || '';
  const deliveryAddress = item.deliveryLocation?.address || '';
  const customerPhone = meta.customerPhone || meta.phone || order?.customerPhone || customerUser?.userPhone || '';

  return {
    ...item,
    deliveryNumber: item.deliveryId || meta.orderNumber || '',
    orderNumber: meta.orderNumber || item.deliveryId || '',
    customerName: meta.customerName || order?.customerName || 'Client',
    vendorName: meta.vendorName || meta.storeName || '',
    pickupAddress,
    vendorAddress: pickupAddress,
    deliveryAddress,
    customerAddress: deliveryAddress,
    customerPhone,
    instructions: meta.instructions || item.deliveryLocation?.instructions || order?.shippingAddress?.instructions || '',
  };
}

async function enrichDeliveriesForDriver(items) {
  if (!items?.length) return [];

  const orderIds = [...new Set(items.map((item) => item.orderId).filter(Boolean))];
  const customerIds = [...new Set(items.map((item) => item.customerId).filter(Boolean))];

  const [orders, users] = await Promise.all([
    orderIds.length
      ? ShopOrder.find({ _id: { $in: orderIds } }).select('customerPhone customerName shippingAddress').lean()
      : [],
    customerIds.length
      ? User.find({ _id: { $in: customerIds } }).select('userPhone').lean()
      : [],
  ]);

  const orderMap = new Map(orders.map((order) => [String(order._id), order]));
  const userMap = new Map(users.map((user) => [String(user._id), user]));

  return items.map((item) => formatDeliveryForDriver(item, orderMap, userMap));
}

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
    const data = await enrichDeliveriesForDriver(deliveries);
    res.json({ success: true, data, deliveries: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/deliveries/:id', verifyToken, requireDeliveryDriver, async (req, res) => {
  try {
    const driverId = req.user.id || req.user.userId;
    const delivery = await Delivery.findOne({ _id: req.params.id, driverId }).lean();
    if (!delivery) return res.status(403).json({ success: false, message: 'Cette livraison ne fait pas partie de vos livraisons.' });
    const [data] = await enrichDeliveriesForDriver([delivery]);
    res.json({ success: true, data, delivery: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Routes statiques AVANT /:id — sinon "history" et "driver" sont pris pour des ObjectId → 500
router.get('/history', verifyToken, requireDeliveryDriver, async (req, res) => {
  try {
    const driverId = req.user.id || req.user.userId;
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const skip = (page - 1) * limit;
    const filter = { driverId, status: { $in: ['DELIVERED', 'CANCELLED', 'FAILED'] } };
    const [rows, total] = await Promise.all([
      Delivery.find(filter).sort({ deliveredAt: -1, updatedAt: -1 }).skip(skip).limit(limit).lean(),
      Delivery.countDocuments(filter),
    ]);
    const data = await enrichDeliveriesForDriver(rows);
    res.json({ success: true, data, deliveries: data, pagination: { page, limit, total } });
  } catch (error) {
    console.error('[deliveryRoutes] GET /history:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/driver', verifyToken, requireDeliveryDriver, async (req, res) => {
  try {
    const driverId = req.user.id || req.user.userId;
    const deliveries = await Delivery.find({ driverId }).sort({ createdAt: -1 }).limit(200).lean();
    const data = await enrichDeliveriesForDriver(deliveries);
    res.json({ success: true, data, deliveries: data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

const NEXT_STATUS_MAP = {
  ASSIGNED: 'ACCEPTED',
  ACCEPTED: 'PICKED_UP',
  PICKED_UP: 'IN_TRANSIT',
  IN_TRANSIT: 'ARRIVED',
  ARRIVED: 'DELIVERED',
};

const STATUS_ACTION_LABELS = {
  ACCEPTED: 'Accepter la livraison',
  PICKED_UP: 'Confirmer le retrait du colis',
  IN_TRANSIT: 'Démarrer la livraison',
  ARRIVED: 'Confirmer l’arrivée chez le client',
  DELIVERED: 'Confirmer la remise au client',
};

const STATUS_SUCCESS_LABELS = {
  ACCEPTED: 'Livraison acceptée.',
  PICKED_UP: 'Colis récupéré.',
  IN_TRANSIT: 'Livraison en cours.',
  ARRIVED: 'Arrivée enregistrée.',
  DELIVERED: 'Colis livré avec succès.',
};

const getNextDeliveryStatus = (currentStatus) => NEXT_STATUS_MAP[currentStatus] || null;

async function resolveDeliveryForDriverScan(token, driverId) {
  const candidateHash = crypto.createHash('sha256').update(token).digest('hex');

  let delivery = await Delivery.findOne({
    $or: [{ qrToken: token }, { qrHash: candidateHash }],
    driverId,
  });

  let scanSource = 'delivery_qr';

  if (!delivery) {
    const orderQr = await QRCode.findOne({ code: token }).lean();
    if (orderQr?.orderId) {
      delivery = await Delivery.findOne({ orderId: orderQr.orderId, driverId });
      if (delivery) scanSource = 'order_qr';
    }
  }

  if (!delivery) {
    const anyDelivery = await Delivery.findOne({
      $or: [{ qrToken: token }, { qrHash: candidateHash }],
    }).lean();

    if (anyDelivery) {
      const err = new Error('Ce colis ne fait pas partie de vos livraisons.');
      err.status = 403;
      throw err;
    }

    const orderQr = await QRCode.findOne({ code: token }).lean();
    if (orderQr) {
      const anyOrderDelivery = await Delivery.findOne({ orderId: orderQr.orderId }).lean();
      if (anyOrderDelivery) {
        const err = new Error('Commande reconnue, mais cette livraison n’est pas assignée à votre compte.');
        err.status = 403;
        err.code = 'NOT_YOUR_DELIVERY';
        throw err;
      }
      const err = new Error('Commande reconnue, mais aucune livraison n’a encore été planifiée pour ce colis.');
      err.status = 404;
      err.code = 'NO_DELIVERY_PLANNED';
      throw err;
    }

    const err = new Error('Code colis invalide. Utilisez le QR de la commande ou le QR livraison assigné.');
    err.status = 404;
    err.code = 'INVALID_QR';
    throw err;
  }

  return { delivery, scanSource };
}

function buildScanPreviewPayload(delivery, scanSource) {
  const nextStatus = getNextDeliveryStatus(delivery.status);
  const meta = delivery.metadata || {};

  return {
    deliveryId: delivery._id,
    orderNumber: meta.orderNumber || delivery.deliveryId || String(delivery._id).slice(-8).toUpperCase(),
    customerName: meta.customerName || 'Client',
    customerAddress: delivery.deliveryLocation?.address || '',
    pickupAddress: delivery.pickupLocation?.address || '',
    currentStatus: delivery.status,
    nextStatus,
    nextActionLabel: nextStatus ? STATUS_ACTION_LABELS[nextStatus] : null,
    scanSource,
  };
}

// Routes scan AVANT /:id/confirm — sinon "scan" est pris pour un ObjectId
router.post('/scan/confirm', verifyToken, requireDeliveryDriver, async (req, res) => {
  try {
    const rawToken = req.body?.token ?? req.body?.code ?? req.body?.qrCode;
    const { deliveryId, type } = req.body || {};
    const token = extractQrToken(rawToken);

    const driverId = req.user.id || req.user.userId;
    let delivery = null;
    let scanSource = 'delivery_qr';

    if (deliveryId) {
      delivery = await Delivery.findOne({ _id: deliveryId, driverId });
      if (!delivery && token) {
        const resolved = await resolveDeliveryForDriverScan(token, driverId);
        delivery = resolved.delivery;
        scanSource = resolved.scanSource;
      }
    } else if (token) {
      const resolved = await resolveDeliveryForDriverScan(token, driverId);
      delivery = resolved.delivery;
      scanSource = resolved.scanSource;
    } else {
      return res.status(400).json({ success: false, message: 'QR code ou identifiant de livraison requis.' });
    }

    if (!delivery) {
      return res.status(404).json({ success: false, message: 'Livraison introuvable.' });
    }

    if (['DELIVERED', 'CANCELLED', 'FAILED'].includes(delivery.status)) {
      return res.status(409).json({ success: false, code: 'ALREADY_SCANNED', message: 'Ce colis a déjà été traité.' });
    }

    const nextStatus = getNextDeliveryStatus(delivery.status);
    if (!nextStatus) {
      return res.status(400).json({ success: false, message: 'Aucune action disponible pour ce colis à ce stade.' });
    }

    const updated = await changeStatus(delivery._id, nextStatus, req.user.id, req.user.role, {
      metadata: { driverId: req.user.id, scanType: type || 'CONFIRMED', scanSource, confirmedAt: new Date() },
    });

    return res.json({
      success: true,
      confirmed: true,
      message: STATUS_SUCCESS_LABELS[nextStatus] || 'Action confirmée.',
      data: updated,
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      code: error.code || 'CONFIRM_ERROR',
      message: error.message || 'Erreur lors de la confirmation.',
    });
  }
});

router.post('/scan', verifyToken, requireDeliveryDriver, async (req, res) => {
  try {
    const rawToken = req.body?.token ?? req.body?.code ?? req.body?.qrCode;
    const { type } = req.body || {};
    const token = extractQrToken(rawToken);
    if (!token) {
      return res.status(400).json({ success: false, code: 'INVALID_QR', message: 'Code colis invalide. Vérifiez que le QR code est bien lisible.' });
    }

    const driverId = req.user.id || req.user.userId;
    const { delivery, scanSource } = await resolveDeliveryForDriverScan(token, driverId);

    if (['DELIVERED', 'CANCELLED', 'FAILED'].includes(delivery.status)) {
      return res.status(409).json({ success: false, code: 'ALREADY_SCANNED', message: 'Ce colis a déjà été traité.' });
    }

    if (type && type === 'PICKUP_SCAN' && delivery.status !== 'ACCEPTED') {
      return res.status(400).json({ success: false, message: 'Le scan de retrait n’est pas autorisé à ce stade.' });
    }

    const nextStatus = getNextDeliveryStatus(delivery.status);
    if (!nextStatus) {
      return res.status(400).json({ success: false, message: 'Aucune action disponible pour ce colis à ce stade.' });
    }

    return res.json({
      success: true,
      preview: true,
      message: 'QR code reconnu. Confirmez l’action pour valider.',
      data: buildScanPreviewPayload(delivery, scanSource),
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      code: error.code || 'SCAN_ERROR',
      message: error.message || 'Erreur lors du scan.',
    });
  }
});

router.get('/:id', verifyToken, requireDeliveryDriver, async (req, res) => {
  try {
    const driverId = req.user.id || req.user.userId;
    const delivery = await Delivery.findOne({ _id: req.params.id, driverId }).lean();
    if (!delivery) return res.status(403).json({ success: false, message: 'Cette livraison ne fait pas partie de vos livraisons.' });
    const [formatted] = await enrichDeliveriesForDriver([delivery]);
    res.json({ success: true, data: formatted, delivery: formatted });
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

router.post('/deliveries/:id/pickup', verifyToken, requireDeliveryDriver, async (req, res) => {
  try {
    const delivery = await Delivery.findOne({ _id: req.params.id, driverId: req.user.id });
    if (!delivery) return res.status(403).json({ success: false, message: 'Cette livraison ne fait pas partie de vos livraisons.' });
    const updated = await changeStatus(delivery._id, 'PICKED_UP', req.user.id, req.user.role, { metadata: { driverId: req.user.id, action: 'pickup' } });
    res.json({ success: true, data: updated, message: 'Retrait confirmé.' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/:id/pickup', verifyToken, requireDeliveryDriver, async (req, res) => {
  try {
    const delivery = await Delivery.findOne({ _id: req.params.id, driverId: req.user.id });
    if (!delivery) return res.status(403).json({ success: false, message: 'Cette livraison ne fait pas partie de vos livraisons.' });
    const updated = await changeStatus(delivery._id, 'PICKED_UP', req.user.id, req.user.role, { metadata: { driverId: req.user.id, action: 'pickup' } });
    res.json({ success: true, data: updated, message: 'Retrait confirmé.' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/deliveries/:id/start', verifyToken, requireDeliveryDriver, async (req, res) => {
  try {
    const delivery = await Delivery.findOne({ _id: req.params.id, driverId: req.user.id });
    if (!delivery) return res.status(403).json({ success: false, message: 'Cette livraison ne fait pas partie de vos livraisons.' });
    const updated = await changeStatus(delivery._id, 'IN_TRANSIT', req.user.id, req.user.role, { metadata: { driverId: req.user.id, action: 'start' } });
    res.json({ success: true, data: updated, message: 'Livraison en cours.' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/:id/start', verifyToken, requireDeliveryDriver, async (req, res) => {
  try {
    const delivery = await Delivery.findOne({ _id: req.params.id, driverId: req.user.id });
    if (!delivery) return res.status(403).json({ success: false, message: 'Cette livraison ne fait pas partie de vos livraisons.' });
    const updated = await changeStatus(delivery._id, 'IN_TRANSIT', req.user.id, req.user.role, { metadata: { driverId: req.user.id, action: 'start' } });
    res.json({ success: true, data: updated, message: 'Livraison en cours.' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/deliveries/:id/arrive', verifyToken, requireDeliveryDriver, async (req, res) => {
  try {
    const delivery = await Delivery.findOne({ _id: req.params.id, driverId: req.user.id });
    if (!delivery) return res.status(403).json({ success: false, message: 'Cette livraison ne fait pas partie de vos livraisons.' });
    const updated = await changeStatus(delivery._id, 'ARRIVED', req.user.id, req.user.role, { metadata: { driverId: req.user.id, action: 'arrive' } });
    res.json({ success: true, data: updated, message: 'Arrivée enregistrée.' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/:id/arrive', verifyToken, requireDeliveryDriver, async (req, res) => {
  try {
    const delivery = await Delivery.findOne({ _id: req.params.id, driverId: req.user.id });
    if (!delivery) return res.status(403).json({ success: false, message: 'Cette livraison ne fait pas partie de vos livraisons.' });
    const updated = await changeStatus(delivery._id, 'ARRIVED', req.user.id, req.user.role, { metadata: { driverId: req.user.id, action: 'arrive' } });
    res.json({ success: true, data: updated, message: 'Arrivée enregistrée.' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/deliveries/:id/confirm', verifyToken, requireDeliveryDriver, async (req, res) => {
  try {
    const delivery = await Delivery.findOne({ _id: req.params.id, driverId: req.user.id });
    if (!delivery) return res.status(403).json({ success: false, message: 'Cette livraison ne fait pas partie de vos livraisons.' });
    const updated = await changeStatus(delivery._id, 'DELIVERED', req.user.id, req.user.role, { metadata: { driverId: req.user.id, action: 'confirm' } });
    res.json({ success: true, data: updated, message: 'Livraison confirmée.' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/:id/confirm', verifyToken, requireDeliveryDriver, async (req, res) => {
  try {
    const delivery = await Delivery.findOne({ _id: req.params.id, driverId: req.user.id });
    if (!delivery) return res.status(403).json({ success: false, message: 'Cette livraison ne fait pas partie de vos livraisons.' });
    const updated = await changeStatus(delivery._id, 'DELIVERED', req.user.id, req.user.role, { metadata: { driverId: req.user.id, action: 'confirm' } });
    res.json({ success: true, data: updated, message: 'Livraison confirmée.' });
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

module.exports = router;
