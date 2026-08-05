const crypto = require('crypto');
const QRCodeModel = require('../Models/QRCode');

const buildQrPayload = ({ orderId, transactionId, vendorId, vendorName, vendorTotal, expiresInHours = 24 }) => {
  const code = crypto.randomBytes(24).toString('hex');
  return {
    code,
    orderId,
    transactionId,
    vendorId,
    vendorName,
    status: 'active',
    metadata: { vendorTotal },
    expiresAt: new Date(Date.now() + expiresInHours * 60 * 60 * 1000),
  };
};

const createQRCodesForOrder = async ({ order, transactionId, session }) => {
  const byVendor = (order.items || []).reduce((acc, item) => {
    const vid = item.vendorId ? String(item.vendorId) : 'platform';
    if (!acc[vid]) acc[vid] = { vendorId: item.vendorId || null, vendorName: item.vendorName || 'Dango Import', items: [] };
    acc[vid].items.push(item);
    return acc;
  }, {});

  const qrDocs = [];
  for (const group of Object.values(byVendor)) {
    const vendorTotal = group.items.reduce((sum, item) => sum + Number(item.subtotal || item.price * item.quantity || 0), 0);
    const qrPayload = buildQrPayload({
      orderId: order._id,
      transactionId,
      vendorId: group.vendorId,
      vendorName: group.vendorName,
      vendorTotal,
    });
    const [qrDoc] = await QRCodeModel.create([qrPayload], { session });
    qrDocs.push(qrDoc);
  }

  return qrDocs;
};

const validateVendorQr = async ({ code, vendorUserId, session }) => {
  const qrDoc = await QRCodeModel.findOne({ code }).session(session);
  if (!qrDoc) throw new Error('QR introuvable');
  if (qrDoc.status !== 'active') throw new Error('QR non actif');
  if (qrDoc.expiresAt < new Date()) {
    qrDoc.status = 'expired';
    await qrDoc.save({ session });
    throw new Error('QR expiré');
  }
  if (qrDoc.vendorId && String(qrDoc.vendorId) !== String(vendorUserId)) {
    throw new Error('QR appartenant à un autre vendeur');
  }
  return qrDoc;
};

const markQrUsed = async ({ qrDoc, session }) => {
  qrDoc.status = 'used';
  qrDoc.usedAt = new Date();
  qrDoc.scannedAt = qrDoc.scannedAt || new Date();
  await qrDoc.save({ session });
  return qrDoc;
};

module.exports = {
  createQRCodesForOrder,
  validateVendorQr,
  markQrUsed,
};
