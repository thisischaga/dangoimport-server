const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema({
  address: String,
  latitude: Number,
  longitude: Number,
}, { _id: false });

const currentLocationSchema = new mongoose.Schema({
  latitude: Number,
  longitude: Number,
  accuracy: Number,
  heading: Number,
  speed: Number,
  updatedAt: Date,
}, { _id: false });

const deliverySchema = new mongoose.Schema({
  deliveryId: { type: String, index: true, unique: true, sparse: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'ShopOrder', required: true, index: true },
  driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },

  status: {
    type: String,
    enum: ['ASSIGNED','ACCEPTED','PICKED_UP','IN_TRANSIT','ARRIVED','DELIVERED','FAILED','CANCELLED'],
    default: 'ASSIGNED',
    index: true,
  },

  pickupLocation: locationSchema,
  deliveryLocation: locationSchema,
  zone: String,

  qrToken: { type: String, index: true },
  qrExpiresAt: Date,
  qrUsedAt: Date,

  assignedAt: Date,
  acceptedAt: Date,
  pickedUpAt: Date,
  startedAt: Date,
  arrivedAt: Date,
  deliveredAt: Date,

  currentDriverLocation: currentLocationSchema,

  proofOfDelivery: [{ type: String }], // urls
  failureReason: String,

  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now },
});

deliverySchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Delivery', deliverySchema);
