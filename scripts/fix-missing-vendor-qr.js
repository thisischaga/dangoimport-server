const mongoose = require('mongoose');
const crypto = require('crypto');
const dotenv = require('dotenv');
const connectDB = require('../Congfig/db');

dotenv.config();

const ShopOrder = require('../Models/ShopOrder');
const Product = require('../Models/Product');
const QRCode = require('../Models/QRCode');
const VendorOrder = require('../Models/VendorOrder');
const Store = require('../Models/Store');
const User = require('../Models/User');

async function ensureStoreForVendor(vendorId) {
  let store = await Store.findOne({ userId: vendorId });
  if (store) return store;
  const vendorUser = await User.findById(vendorId).lean();
  const baseName = vendorUser ? (vendorUser.vendorName || `${vendorUser.userFirstname || ''} ${vendorUser.userSurname || ''}`.trim()) : 'Ma boutique';
  const slug = `${baseName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${crypto.randomBytes(3).toString('hex')}`;
  const created = await Store.create({ userId: vendorId, slug, name: baseName, whatsapp: vendorUser ? vendorUser.userPhone : '' });
  return created;
}

async function processOrders(limit = 200) {
  console.log('Scanning ShopOrders for missing vendorId/items or no QR...');
  const query = {
    $or: [
      { qrCodeIds: { $exists: false } },
      { qrCodeIds: { $size: 0 } },
      { 'items.vendorId': { $exists: false } },
      { 'items.vendorId': null },
    ],
  };
  const orders = await ShopOrder.find(query).sort({ createdAt: -1 }).limit(limit);
  console.log(`Found ${orders.length} orders to inspect`);
  let totalQr = 0;
  let totalVendorOrders = 0;

  for (const order of orders) {
    let touched = false;
    // fix missing item vendorId from product
    for (const it of order.items) {
      if (!it.vendorId) {
        const prod = await Product.findById(it.productId).lean();
        if (prod && prod.vendorId) {
          it.vendorId = prod.vendorId;
          it.vendorName = prod.vendorName || prod.vendorName || 'Vendeur Indépendant';
          touched = true;
        }
      }
    }

    if (touched) {
      await order.save();
      console.log(`Updated items vendorId for order ${order._id}`);
    }

    // create QR codes grouped by vendor
    const byVendor = (order.items || []).reduce((acc, item) => {
      const vid = item.vendorId ? String(item.vendorId) : 'platform';
      if (!acc[vid]) acc[vid] = { vendorId: item.vendorId || null, vendorName: item.vendorName || 'Dango Import', items: [] };
      acc[vid].items.push(item);
      return acc;
    }, {});

    const qrDocsPayload = [];
    const vendorOrderPayloads = [];
    const txId = `manual_fix_${Date.now()}`;

    for (const group of Object.values(byVendor)) {
      const vendorTotal = group.items.reduce((s, it) => s + Number(it.subtotal || it.price * it.quantity || 0), 0);
      const code = crypto.randomBytes(24).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      qrDocsPayload.push({ code, orderId: order._id, transactionId: txId, vendorId: group.vendorId, vendorName: group.vendorName, status: 'active', metadata: { vendorTotal }, expiresAt });

      if (group.vendorId) {
        vendorOrderPayloads.push({ vendorGroup: group, vendorTotal });
      }
    }

    let createdQrs = [];
    if (qrDocsPayload.length > 0) {
      createdQrs = await QRCode.create(qrDocsPayload);
      totalQr += createdQrs.length;
      // attach qr ids to order
      order.qrCodeIds = (order.qrCodeIds || []).concat(createdQrs.map(q => q._id));
      await order.save();
      console.log(`Created ${createdQrs.length} QR codes for order ${order._id}`);
    }

    // create vendor orders
    for (const vp of vendorOrderPayloads) {
      const v = vp.vendorGroup;
      let store = await Store.findOne({ userId: v.vendorId });
      if (!store) {
        store = await ensureStoreForVendor(v.vendorId);
      }
      const vendorTotal = vp.vendorTotal || 0;
      const itemsPayload = v.items.map(it => ({ productId: it.productId, quantity: it.quantity, price: it.price || 0 }));
      const vendorOrder = await VendorOrder.create({ storeId: store._id, shopOrderId: order._id, customerName: order.customerName, customerPhone: order.customerPhone, total: vendorTotal, status: 'pending', items: itemsPayload });
      totalVendorOrders += 1;
      console.log(`Created VendorOrder ${vendorOrder._id} for vendor ${String(v.vendorId)}`);
    }
  }

  console.log(`Done. Created ${totalQr} QR codes and ${totalVendorOrders} vendor orders.`);
}

(async () => {
  try {
    await connectDB();
    await processOrders(200);
    console.log('Finished repair script');
    process.exit(0);
  } catch (err) {
    console.error('Error running repair script:', err);
    process.exit(1);
  }
})();