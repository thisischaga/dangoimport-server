const mongoose = require('mongoose');
const ShopOrder = require('../Models/ShopOrder');
const Product = require('../Models/Product');
const VendorOrder = require('../Models/VendorOrder');
const OrderHistory = require('../Models/OrderHistory');

const generateOrderNumber = () => {
  const timestamp = Date.now().toString();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `DI-${random}-${timestamp.slice(-8)}`;
};

const normalizeShippingMethod = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (['express', 'livraison express', 'express_delivery'].includes(normalized)) return 'express';
  if (['pickup', 'retrait', 'pickup_point', 'pick-up'].includes(normalized)) return 'pickup';
  return 'standard';
};

const orderDeliveryDate = (shippingMethod) => {
  const date = new Date();
  if (shippingMethod === 'express') date.setDate(date.getDate() + 2);
  else if (shippingMethod === 'pickup') date.setDate(date.getDate() + 1);
  else date.setDate(date.getDate() + 5);
  return date;
};

const buildOrderPayload = ({ userId, customer, shippingAddress, items, subtotal, shippingCost, tax, discount, total, shippingMethod }) => ({
  orderNumber: generateOrderNumber(),
  customerId: mongoose.isValidObjectId(userId) ? new mongoose.Types.ObjectId(userId) : null,
  customerName: `${customer.firstname || 'Client'} ${customer.lastname || ''}`.trim(),
  customerEmail: customer.email,
  customerPhone: customer.phone_number?.number || '',
  shippingAddress,
  items,
  subtotal,
  shippingCost,
  tax,
  discount,
  total,
  shippingMethod,
  estimatedDelivery: orderDeliveryDate(shippingMethod),
});

const createOrderFromTransaction = async ({ transaction, session }) => {
  const metadata = transaction.metadata || {};
  const userId = metadata.userId;
  const customer = transaction.customer;
  const shippingAddress = metadata.shippingAddress || {};
  const items = metadata.items || [];
  const subtotal = metadata.subtotal || transaction.amount;
  const shippingCost = metadata.shippingCost || 0;
  const tax = metadata.tax || 0;
  const discount = metadata.discount || 0;
  const total = metadata.total || transaction.amount;
  const shippingMethod = normalizeShippingMethod(metadata.shippingMethod || 'standard');

  const orderItems = [];
  for (const item of items) {
    const product = await Product.findById(item.productId).session(session);
    if (!product) {
      throw new Error(`Produit introuvable : ${item.productId}`);
    }
    if (product.stock < item.quantity) {
      throw new Error(`Stock insuffisant pour le produit ${product.name}`);
    }
    orderItems.push({
      productId: product._id,
      productName: product.name,
      productImage: product.images?.[0]?.url || product.image || '',
      vendorId: product.vendorId,
      vendorName: product.vendorName || item.vendorName || 'Vendeur Indépendant',
      price: product.salePrice || product.price,
      originalPrice: product.price,
      salePrice: product.salePrice || 0,
      category: product.category,
      quantity: item.quantity,
      selectedOptions: item.selectedOptions || {},
      subtotal: item.subtotal || (product.salePrice || product.price) * item.quantity,
      delivered: false,
    });
  }

  const orderPayload = buildOrderPayload({
    userId,
    customer,
    shippingAddress,
    items: orderItems,
    subtotal,
    shippingCost,
    tax,
    discount,
    total,
    shippingMethod,
  });

  orderPayload.status = 'confirmed';
  orderPayload.paymentStatus = 'completed';
  orderPayload.paymentMethod = 'FedaPay';
  orderPayload.paymentDate = new Date();
  orderPayload.history = ['Order created after payment confirmed'];

  const [order] = await ShopOrder.create([orderPayload], { session });
  return order;
};

const decrementStockForOrder = async ({ order, session }) => {
  for (const item of order.items) {
    await Product.findByIdAndUpdate(item.productId, {
      $inc: { stock: -item.quantity, totalSales: item.quantity },
    }, { session });
  }
};

const recordOrderHistory = async ({ orderId, event, details, session }) => {
  await OrderHistory.create([{ orderId, event, details, createdBy: 'system' }], { session });
};

module.exports = {
  createOrderFromTransaction,
  decrementStockForOrder,
  recordOrderHistory,
};
