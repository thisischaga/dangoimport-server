const crypto = require('crypto');
const mongoose = require('mongoose');
const Delivery = require('../Models/Delivery');
const DeliveryList = require('../Models/DeliveryList');
const Driver = require('../Models/Driver');
const ShopOrder = require('../Models/ShopOrder');
const Store = require('../Models/Store');
const User = require('../Models/User');

const DELIVERY_STATUSES = ['ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED', 'CANCELLED'];

const normalizeOrderStatus = (status) => String(status || '').toLowerCase();

const normalizeDeliveryPriority = (value) => {
  const normalized = String(value ?? 'Normale').trim().toLowerCase();

  if (['normal', 'normale'].includes(normalized)) return 'Normale';
  if (['high', 'haute', 'urgent', 'urgente'].includes(normalized)) return 'Urgente';

  return 'Normale';
};

function isOrderEligibleForDelivery(order = {}) {
  if (!order || !order._id) return false;

  const paymentOk = ['completed', 'paid', 'success'].includes(normalizeOrderStatus(order.paymentStatus));
  const statusMatches = ['confirmed', 'processing', 'prepared', 'ready', 'ready_to_ship', 'shipped'].includes(normalizeOrderStatus(order.status));
  const hasAddress = !!(
    (order.shippingAddress && (order.shippingAddress.fullAddress || order.shippingAddress.city || order.shippingAddress.neighborhood)) ||
    order.deliveryAddress ||
    order.address
  );

  if (!paymentOk) return false;
  if (!statusMatches) return false;
  if (!hasAddress) return false;

  return true;
}

async function getEligibleDeliveryOrders({ status, city, neighborhood, vendor, priority, dateFrom, dateTo, search }) {
  const filter = {};

  if (status) filter.status = status;
  if (city) filter['shippingAddress.city'] = { $regex: city, $options: 'i' };
  if (neighborhood) filter['shippingAddress.neighborhood'] = { $regex: neighborhood, $options: 'i' };
  if (vendor) filter['items.vendorName'] = { $regex: vendor, $options: 'i' };
  if (search) {
    filter.$or = [
      { orderNumber: { $regex: search, $options: 'i' } },
      { customerName: { $regex: search, $options: 'i' } },
      { customerPhone: { $regex: search, $options: 'i' } },
      { 'shippingAddress.fullAddress': { $regex: search, $options: 'i' } },
    ];
  }

  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) filter.createdAt.$lte = new Date(dateTo);
  }

  const assignedOrderIds = await Delivery.distinct('orderId', {
    status: { $nin: ['FAILED', 'CANCELLED'] },
  });

  const orders = await ShopOrder.find({
    ...filter,
    _id: { $nin: assignedOrderIds }
  }).sort({ createdAt: -1 }).lean();

  const eligible = orders.filter((order) => isOrderEligibleForDelivery(order));
  return eligible;
}

async function validateDriverForAssignment(driverId) {
  if (!driverId) throw new Error('Aucun livreur sélectionné.');

  const driverProfile = await Driver.findById(driverId).lean();
  if (!driverProfile) {
    throw new Error('Livreur introuvable.');
  }

  const driverUser = await User.findById(driverProfile.userId).lean();
  if (!driverUser) {
    throw new Error('Compte utilisateur du livreur introuvable.');
  }
  if (String(driverUser.role) !== 'driver') {
    throw new Error('Le compte sélectionné n’est pas un compte livreur.');
  }
  if (!driverProfile.isActive) {
    throw new Error('Ce livreur n’est pas actif.');
  }

  return { driverUser, driverProfile };
}

function normalizeLocationCoords(rawLocation) {
  if (!rawLocation || typeof rawLocation !== 'object') return { latitude: null, longitude: null };

  const coords = Array.isArray(rawLocation.coordinates) && rawLocation.coordinates.length >= 2
    ? rawLocation.coordinates
    : null;

  const latitude = Number(rawLocation.latitude ?? rawLocation.lat ?? (coords ? coords[1] : null));
  const longitude = Number(rawLocation.longitude ?? rawLocation.lng ?? (coords ? coords[0] : null));

  return {
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
  };
}

async function createDeliveryListFromOrders({
  name,
  driverId,
  selectedOrderIds = [],
  scheduledDate,
  zone,
  priority,
  notes,
  createdBy,
}) {
  if (!name) throw new Error('Le nom de la liste est requis.');
  if (!Array.isArray(selectedOrderIds) || selectedOrderIds.length === 0) {
    throw new Error('Sélectionnez au moins une commande.');
  }

  const { driverUser } = await validateDriverForAssignment(driverId);

  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const orderIds = [...new Set(selectedOrderIds.map((id) => String(id)))];
      const orders = await ShopOrder.find({ _id: { $in: orderIds } }).session(session).lean();

      if (orders.length !== orderIds.length) {
        throw new Error('Une ou plusieurs commandes ne sont pas valides.');
      }

      for (const order of orders) {
        if (!isOrderEligibleForDelivery(order)) {
          throw new Error(`La commande ${order.orderNumber || order._id} n’est pas éligible pour une livraison.`);
        }
      }

      const normalizedPriority = normalizeDeliveryPriority(priority);
      const deliveryIds = [];
      for (const order of orders) {
        const vendorId = order.items?.[0]?.vendorId || null;
        const store = vendorId ? await Store.findOne({ userId: vendorId }).lean() : null;
        const customerGeo = normalizeLocationCoords(order.shippingAddress || {});
        const vendorGeo = normalizeLocationCoords(store?.location || {});
        const qrToken = crypto.randomBytes(24).toString('hex');
        const qrHash = crypto.createHash('sha256').update(String(qrToken)).digest('hex');

        const delivery = await Delivery.create([{
          orderId: order._id,
          driverId: driverUser._id,
          vendorId,
          customerId: order.customerId || null,
          pickupLocation: {
            address: store?.address || store?.name || order.shippingAddress?.fullAddress || order.shippingAddress?.city || '',
            latitude: vendorGeo.latitude,
            longitude: vendorGeo.longitude,
          },
          deliveryLocation: {
            address: order.shippingAddress?.fullAddress || order.shippingAddress?.city || '',
            latitude: customerGeo.latitude,
            longitude: customerGeo.longitude,
          },
          zone: zone || order.shippingAddress?.city || '',
          status: 'ASSIGNED',
          assignedAt: new Date(),
          metadata: {
            orderNumber: order.orderNumber,
            customerName: order.customerName,
            priority: normalizedPriority,
          },
          driverId: driverUser._id,
          qrToken,
          qrHash,
          qrExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
        }], { session });

        deliveryIds.push(delivery[0]._id);
      }

      const list = await DeliveryList.create([{
        name,
        driverId: driverUser._id,
        deliveryIds,
        status: 'ASSIGNED',
        scheduledDate: scheduledDate ? new Date(scheduledDate) : new Date(),
        zone: zone || '',
        priority: normalizedPriority,
        notes: notes || '',
        createdBy: createdBy || null,
      }], { session });

      result = list[0];
    });

    return {
      success: true,
      data: result,
      message: 'Liste de livraison créée et attribuée au livreur.',
    };
  } finally {
    await session.endSession();
  }
}

async function getDriverDeliveriesForUser(driverUserId) {
  const deliveryListIds = await DeliveryList.find({ driverId: driverUserId }).select('_id').lean();
  const ids = deliveryListIds.map((d) => d._id);

  const deliveries = await Delivery.find({
    $or: [
      { driverId: driverUserId },
      { deliveryListId: { $in: ids } },
    ],
  }).sort({ createdAt: -1 }).lean();

  return deliveries;
}

module.exports = {
  DELIVERY_STATUSES,
  isOrderEligibleForDelivery,
  getEligibleDeliveryOrders,
  validateDriverForAssignment,
  createDeliveryListFromOrders,
  getDriverDeliveriesForUser,
};
