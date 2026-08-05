const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

const ShopOrder = require('../Models/ShopOrder');
const QRCode = require('../Models/QRCode');
const Transaction = require('../Models/Transaction');
const VendorOrder = require('../Models/VendorOrder');
const User = require('../Models/User');

const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/dango';

async function inspect(orderId) {
  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  const order = await ShopOrder.findById(orderId).lean();
  if (!order) {
    console.log('ORDER NOT FOUND', orderId);
    await mongoose.disconnect();
    return;
  }

  console.log('ORDER:', {
    _id: String(order._id),
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    qrCodeIds: (order.qrCodeIds || []).map(String),
    items: (order.items || []).map((i) => ({ productId: String(i.productId), vendorId: i.vendorId ? String(i.vendorId) : null, vendorName: i.vendorName, quantity: i.quantity, subtotal: i.subtotal })),
  });

  const qrs = await QRCode.find({ orderId: order._id }).lean();
  console.log('QRS count:', qrs.length);
  qrs.forEach((q) => {
    console.log('  QR:', {
      code: q.code.slice(0, 8),
      vendorId: q.vendorId ? String(q.vendorId) : null,
      vendorName: q.vendorName,
      status: q.status,
      transactionId: q.transactionId,
      expiresAt: q.expiresAt,
    });
  });

  const tx1 = await Transaction.findOne({ 'metadata.orderId': String(order._id) }).lean();
  const tx2 = await Transaction.findOne({ orderId: String(order._id) }).lean();
  console.log('TRANSACTION metadata.orderId:', tx1 ? { id: String(tx1._id), transactionId: tx1.transactionId, status: tx1.status, webhookProcessed: tx1.webhookProcessed } : 'NOT FOUND');
  console.log('TRANSACTION orderId:', tx2 ? { id: String(tx2._id), transactionId: tx2.transactionId, status: tx2.status, webhookProcessed: tx2.webhookProcessed } : 'NOT FOUND');

  const vendorOrders = await VendorOrder.find({ shopOrderId: order._id }).lean();
  console.log('VENDOR ORDERS count:', vendorOrders.length);
  vendorOrders.forEach((v) => {
    console.log('  VendorOrder:', { _id: String(v._id), storeId: String(v.storeId), total: v.total, status: v.status });
  });

  const vendorIds = new Set((order.items || []).map((i) => i.vendorId ? String(i.vendorId) : null).filter(Boolean));
  for (const vid of vendorIds) {
    const user = await User.findById(vid).lean();
    console.log('VENDOR USER', vid, user ? { email: user.userEmail, role: user.role, vendorName: user.vendorName } : 'NOT FOUND');
  }

  await mongoose.disconnect();
}

const orderId = process.argv[2];
if (!orderId) {
  console.error('Usage: node inspect-order-detail.js <orderId>');
  process.exit(1);
}
inspect(orderId).catch((err) => {
  console.error(err);
  process.exit(1);
});