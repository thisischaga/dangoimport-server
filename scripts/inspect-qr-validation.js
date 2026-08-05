const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '../.env') });
const ShopOrder = require('../Models/ShopOrder');
const QRCode = require('../Models/QRCode');

const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/dango';
(async () => {
  try {
    await mongoose.connect(uri);
    const qrs = await QRCode.find().sort({ createdAt: -1 }).limit(20);
    if (!qrs.length) {
      console.log('NO QR FOUND');
      process.exit(0);
    }
    for (const qr of qrs) {
      const order = await ShopOrder.findById(qr.orderId).lean();
      console.log('QR:', qr.code.slice(0, 8),
        'vendorId:', qr.vendorId ? String(qr.vendorId) : 'null',
        'vendorName:', qr.vendorName || 'null',
        'qrStatus:', qr.status,
        'orderId:', String(qr.orderId),
        'orderStatus:', order?.status || 'missing',
        'paymentStatus:', order?.paymentStatus || 'missing',
        'orderNumber:', order?.orderNumber || 'missing');
    }
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();