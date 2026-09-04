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
  const R = 6371; // km
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDlat = Math.sin(dLat / 2) * Math.sin(dLat / 2);
  const sinDlon = Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(sinDlat + Math.cos(lat1) * Math.cos(lat2) * sinDlon), Math.sqrt(1 - (sinDlat + Math.cos(lat1) * Math.cos(lat2) * sinDlon)));
  return R * c;
}

async function determineDeliveryProvider({ store, clientLocation }) {
  if (!store) return { provider: 'DANGOIMPORT', reason: 'no_store' };

  const mode = store.delivery?.mode || 'DANGOIMPORT';
  const sellerDelivery = store.delivery?.sellerDelivery || {};

  // Normalize client location
  const client = toLngLat(clientLocation);
  const sellerLoc = toLngLat((sellerDelivery.location && sellerDelivery.location.coordinates) || (store.location && store.location.coordinates));

  if (mode === 'SELLER') {
    // If seller mode, prefer seller if within radius and enabled
    if (sellerDelivery.enabled && sellerLoc && client) {
      const dist = haversineKm(sellerLoc, client);
      if (dist <= (Number(sellerDelivery.radiusKm) || 0)) return { provider: 'SELLER', reason: 'within_radius', distanceKm: dist };
      // out of radius -> fallback depends on dangoImportFallback
      if (store.delivery?.dangoImportFallback) return { provider: 'DANGOIMPORT', reason: 'out_of_radius_fallback', distanceKm: dist };
      return { provider: 'SELLER', reason: 'out_of_radius_no_fallback', distanceKm: dist };
    }
    // no seller location configured
    return { provider: 'DANGOIMPORT', reason: 'seller_not_configured' };
  }

  if (mode === 'HYBRID') {
    if (sellerDelivery.enabled && sellerLoc && client) {
      const dist = haversineKm(sellerLoc, client);
      if (dist <= (Number(sellerDelivery.radiusKm) || 0)) return { provider: 'SELLER', reason: 'hybrid_within_radius', distanceKm: dist };
      return { provider: 'DANGOIMPORT', reason: 'hybrid_outside_radius', distanceKm: dist };
    }
    return { provider: 'DANGOIMPORT', reason: 'hybrid_no_seller' };
  }

  // default DANGOIMPORT
  return { provider: 'DANGOIMPORT', reason: 'default' };
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

module.exports = { createDelivery, changeStatus, pushEvent, determineDeliveryProvider };

