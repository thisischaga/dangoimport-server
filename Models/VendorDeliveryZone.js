const mongoose = require('mongoose');

const vendorDeliveryZoneSchema = new mongoose.Schema({
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  storeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    default: null,
    index: true,
  },
  country: {
    type: String,
    required: true,
    trim: true,
  },
  region: {
    type: String,
    default: '',
    trim: true,
  },
  city: {
    type: String,
    default: '',
    trim: true,
  },
  zoneName: {
    type: String,
    required: true,
    trim: true,
  },
  deliveryFee: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },
  estimatedDelivery: {
    type: String,
    default: '',
  },
  isDefault: {
    type: Boolean,
    default: false,
  },
  pickupAddress: {
    type: String,
    default: '',
  },
  notes: {
    type: String,
    default: '',
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

vendorDeliveryZoneSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('VendorDeliveryZone', vendorDeliveryZoneSchema);
