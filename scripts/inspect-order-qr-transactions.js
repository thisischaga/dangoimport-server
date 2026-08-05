const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });
const ShopOrder = require('../Models/ShopOrder');
const QRCode = require('../Models/QRCode');
const Payment = require('../Models/Payment');
const Transaction = require('../Models/Transaction');
const WebhookLog = require('../Models/WebhookLog');

const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/dango';
const orderIds = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [
  '6a72f4247616e68adb20ffbb',
  '6a72f6fea11fc3ad876bdcf9',
  '6a72f83c0113c90f1b2783d1',
];

(async () => {
  try {
    await mongoose.connect(uri);
    for (const orderId of orderIds) {
      console.log('========================================================');
      console.log('OrderId:', orderId);
      const order = await ShopOrder.findById(orderId).lean();
      console.log('Order:', order ? { status: order.status, paymentStatus: order.paymentStatus, total: order.total, orderNumber: order.orderNumber, qrCodeIds: order.qrCodeIds?.length || 0 } : 'MISSING');
      const qrs = await QRCode.find({ orderId }).lean();
      console.log('QR codes:', qrs.map((q) => ({ code: q.code.slice(0, 8), status: q.status, vendorId: q.vendorId ? String(q.vendorId) : null, transactionId: q.transactionId })));
      const payments = await Payment.find({ orderId }).lean();
      console.log('Payments:', payments.map((p) => ({ transactionId: p.transactionId, status: p.status, amount: p.amount, provider: p.provider })));
      const txs = await Transaction.find({ orderId }).lean();
      console.log('Transactions:', txs.map((t) => ({ transactionId: t.transactionId, status: t.status, amount: t.amount, webhookProcessed: t.webhookProcessed })));
      const webhooks = await WebhookLog.find({ 'payload.entity.id': { $in: txs.map((t) => t.transactionId) } }).lean();
      console.log('WebhookLogs:', webhooks.map((w) => ({ eventId: w.eventId, status: w.status, error: w.error })));
      console.log('');
    }
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();