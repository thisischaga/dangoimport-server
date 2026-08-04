const mongoose = require('mongoose');

const qrCodeSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ShopOrder',
    required: true,
    index: true,
  },
  transactionId: {
    type: String,
    required: true,
    index: true,
  },
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
    index: true,
  },
  vendorName: {
    type: String,
    default: '',
    index: true,
  },
  status: {
    type: String,
    enum: ['active', 'scanned', 'expired', 'cancelled', 'used'],
    default: 'active',
    index: true,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true,
  },
  scannedAt: Date,
  usedAt: Date,
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

qrCodeSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('QRCode', qrCodeSchema);
