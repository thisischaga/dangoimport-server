const Delivery = require('../Models/Delivery');
const DeliveryEvent = require('../Models/DeliveryEvent');
const ShopOrder = require('../Models/ShopOrder');
const { getIO, sendNotification } = require('../utils/socket');

const allowedTransitions = {
  ASSIGNED: ['ACCEPTED','CANCELLED'],
  ACCEPTED: ['PICKED_UP','CANCELLED'],
  PICKED_UP: ['IN_TRANSIT','FAILED'],
  IN_TRANSIT: ['ARRIVED','FAILED'],
  ARRIVED: ['DELIVERED','FAILED'],
};

// Determine delivery provider based on store settings and client location
// clientLocation: { lat, lng } or [lng, lat]
function toLngLat(coords) {
  if (!coords) return null;
  if (Array.isArray(coords) && coords.length >= 2) return { lng: Number(coords[0]), lat: Number(coords[1]) };
  if (coords.lng !== undefined && coords.lat !== undefined) return { lng: Number(coords.lng), lat: Number(coords.lat) };
  return null;
}

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDlat = Math.sin(dLat / 2) * Math.sin(dLat / 2);
  const sinDlon = Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const aTerm = Math.cos(lat1) * Math.cos(lat2) * sinDlon;
  const c = 2 * Math.atan2(Math.sqrt(sinDlat + aTerm), Math.sqrt(1 - (sinDlat + aTerm)));
  return R * c;
}

function getSellerFee({ distanceKm = 0, baseFee = 500, ratePerKm = 150 }) {
  const dist = Number(distanceKm) || 0;
  const normalizedBase = Number(baseFee) || 500;
  const normalizedRate = Number(ratePerKm) || 150;

  let zone = 'urban';
  let multiplier = 1;

  if (dist > 12) {
    zone = 'suburban';
    multiplier = 1.35;
  }
  if (dist > 25) {
    zone = 'rural';
    multiplier = 1.75;
  }

  const raw = normalizedBase + (normalizedRate * dist);
  const fee = Math.round(raw * multiplier);

  return {
    zone,
    baseFee: normalizedBase,
    ratePerKm: normalizedRate,
    distanceKm: Number(dist.toFixed(2)),
    fee: Math.max(normalizedBase, fee),
  };
}

async function determineDeliveryProvider({ store, clientLocation }) {
  if (!store) {
    return {
      provider: 'DANGOIMPORT',
      reason: 'no_store',
      sellerDeliveryAvailable: false,
      fee: 0,
      estimatedDeliveryTime: '3-5 jours',
    };
  }

  const mode = store.delivery?.mode || 'DANGOIMPORT';
  const sellerDelivery = store.delivery?.sellerDelivery || {};
  const client = toLngLat(clientLocation);
  const sellerLoc = toLngLat((sellerDelivery.location && sellerDelivery.location.coordinates) || (store.location && store.location.coordinates));

  if (!sellerLoc || !client) {
    return {
      provider: 'DANGOIMPORT',
      reason: 'missing_geo',
      sellerDeliveryAvailable: false,
      fee: 0,
      estimatedDeliveryTime: '3-5 jours',
    };
  }

  const dist = haversineKm(sellerLoc, client);
  const baseFee = Number(sellerDelivery.baseFee || 500);
  const ratePerKm = Number(sellerDelivery.ratePerKm || 150);
  const radiusKm = Number(sellerDelivery.radiusKm || 0);
  const enabled = Boolean(sellerDelivery.enabled);

  if (enabled && dist <= Math.max(radiusKm || 50, 20)) {
    const pricing = getSellerFee({ distanceKm: dist, baseFee, ratePerKm });
    return {
      provider: 'SELLER',
      reason: mode === 'SELLER' ? 'within_radius' : 'hybrid_within_radius',
      distanceKm: pricing.distanceKm,
      sellerDeliveryAvailable: true,
      fee: pricing.fee,
      estimatedDeliveryTime: dist <= 8 ? '1-3 jours' : '2-5 jours',
      breakdown: pricing,
    };
  }

  if (mode === 'SELLER') {
    return {
      provider: 'DANGOIMPORT',
      reason: 'out_of_radius_fallback',
      distanceKm: Number(dist.toFixed(2)),
      sellerDeliveryAvailable: false,
      fee: 0,
      estimatedDeliveryTime: '3-5 jours',
    };
  }

  return {
    provider: 'DANGOIMPORT',
    reason: mode === 'HYBRID' ? 'hybrid_outside_radius' : 'default',
    distanceKm: Number(dist.toFixed(2)),
    sellerDeliveryAvailable: false,
    fee: 0,
    estimatedDeliveryTime: '3-5 jours',
  };
}

async function calculateDeliveryForItems({ items = [], clientLocation = null }) {
  const Store = require('../Models/Store');
  const Product = require('../Models/Product');

  if (!Array.isArray(items) || items.length === 0) {
    return {
      provider: 'DANGOIMPORT',
      reason: 'no_items',
      groups: [],
      shippingCost: 0,
    };
  }

  const vendorGroups = {};
  for (const item of items) {
    let vendorId = item.vendorId || item.sellerId;
    if (!vendorId && item.productId) {
      try {
        const prod = await Product.findById(item.productId);
        if (prod) vendorId = prod.vendorId || prod.vendor || prod.vendorName;
      } catch (e) {
        // ignore product lookup failure and continue with default grouping
      }
    }
    const key = vendorId ? String(vendorId) : 'default';
    if (!vendorGroups[key]) {
      vendorGroups[key] = { vendorId: key !== 'default' ? key : null, items: [] };
    }
    vendorGroups[key].items.push(item);
  }

  const groupResults = [];
  for (const group of Object.values(vendorGroups)) {
    let store = null;
    const vendorKey = group.vendorId;

    if (vendorKey) {
      try {
        const maybeObjectId = vendorKey.match(/^[0-9a-fA-F]{24}$/) ? vendorKey : null;
        if (maybeObjectId) {
          store = await Store.findOne({ userId: maybeObjectId });
        }
      } catch (e) {
        store = null;
      }
    }

    const res = await determineDeliveryProvider({ store, clientLocation });

    groupResults.push({
      vendorId: vendorKey,
      storeName: store?.name || 'Vendeur',
      provider: res.provider,
      reason: res.reason,
      sellerDeliveryAvailable: res.sellerDeliveryAvailable,
      distanceKm: res.distanceKm,
      fee: Number(res.fee || 0),
      estimatedDeliveryTime: res.estimatedDeliveryTime || '3-5 jours',
      itemsCount: group.items.length,
      breakdown: res.breakdown || null,
    });
  }

  const allSeller = groupResults.length > 0 && groupResults.every((g) => g.provider === 'SELLER');
  const allDango = groupResults.length > 0 && groupResults.every((g) => g.provider === 'DANGOIMPORT');
  const overallProvider = allSeller ? 'SELLER' : allDango ? 'DANGOIMPORT' : 'HYBRID';
  const shippingCost = groupResults.reduce((sum, g) => sum + Number(g.fee || 0), 0);

  return {
    provider: overallProvider,
    reason: groupResults.map((g) => `${g.storeName}: ${g.reason}`).join('; '),
    groups: groupResults,
    shippingCost,
  };
}

async function createDelivery(payload) {
  const d = new Delivery(payload);
  await d.save();
  await pushEvent(d._id, 'DELIVERY_CREATED', payload.driverId, 'System', {});
  return d;
}

async function pushEvent(deliveryId, event, actorId, actorRole = 'User', metadata = {}, location) {
  const ev = await DeliveryEvent.create({ deliveryId, event, actorId, actorRole, metadata, location });
  try {
    const io = getIO();
    // Emit to delivery room and driver room when possible
    io.to(`delivery_${String(deliveryId)}`).emit('delivery:updated', { deliveryId, event, actorId, actorRole, metadata, location, timestamp: ev.timestamp });
    // also emit to driver room if metadata.driverId present
    if (metadata && metadata.driverId) {
      io.to(`driver_${String(metadata.driverId)}`).emit('delivery:updated', { deliveryId, event, actorId, actorRole, metadata, location, timestamp: ev.timestamp });
    }
  } catch (e) {
    // ignore socket if not initialized
  }
  return ev;
}

async function changeStatus(deliveryId, newStatus, actorId, actorRole, opts = {}) {
  const delivery = await Delivery.findById(deliveryId);
  if (!delivery) throw new Error('Delivery not found');

  const current = delivery.status;
  if (current === newStatus) return delivery;

  // simple transition guard
  if (allowedTransitions[current] && !allowedTransitions[current].includes(newStatus)) {
    throw new Error(`Transition ${current} -> ${newStatus} not allowed`);
  }

  // Update timestamps
  const now = new Date();
  if (newStatus === 'ACCEPTED') delivery.acceptedAt = now;
  if (newStatus === 'PICKED_UP') delivery.pickedUpAt = now;
  if (newStatus === 'IN_TRANSIT') delivery.startedAt = now;
  if (newStatus === 'ARRIVED') delivery.arrivedAt = now;
  if (newStatus === 'DELIVERED') delivery.deliveredAt = now;

  delivery.status = newStatus;
  Object.assign(delivery, opts.updates || {});
  await delivery.save();

  await pushEvent(delivery._id, `STATUS_${newStatus}`, actorId, actorRole, opts.metadata || {}, opts.location);

  // notify customer and admin
  try {
    await sendNotification({ recipient: delivery.customerId ? String(delivery.customerId) : 'admin', type: 'delivery_status', title: 'Mise à jour de livraison', message: `Statut: ${newStatus}`, link: `/deliveries/${delivery._id}`, sender: 'System' });
  } catch (e) {}

  return delivery;
}

module.exports = { createDelivery, changeStatus, pushEvent, determineDeliveryProvider, calculateDeliveryForItems };

