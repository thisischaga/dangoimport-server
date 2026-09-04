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

module.exports = { createDelivery, changeStatus, pushEvent };
