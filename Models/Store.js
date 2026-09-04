const mongoose = require('mongoose');

const storeSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    unique: true,
    required: true,
    index: true
  },
  slug: {
    type: String,
    unique: true,
    required: true,
    trim: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  logo: {
    type: String,
    default: ''
  },
  banner: {
    type: String,
    default: ''
  },
  country: {
    type: String,
    default: ''
  },
  city: {
    type: String,
    default: ''
  },
  address: {
    type: String,
    default: ''
  },
  deliveryPolicy: {
    type: String,
    default: ''
  },
  returnPolicy: {
    type: String,
    default: ''
  },
  whatsapp: {
    type: String,
    default: ''
  },
  fedaPayLink: {
    type: String,
    default: ''
  },
  delivery: {
    mode: {
      type: String,
      enum: ['DANGOIMPORT', 'SELLER', 'HYBRID'],
      default: 'DANGOIMPORT'
    },
    sellerDelivery: {
      enabled: { type: Boolean, default: false },
      radiusKm: { type: Number, default: 0 },
      location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], default: [0, 0] }
      }
    },
    dangoImportFallback: { type: Boolean, default: true }
  },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] }
  },
  onboarding: {
    profileCompleted: { type: Boolean, default: false },
    storeCompleted: { type: Boolean, default: false },
    deliveryCompleted: { type: Boolean, default: false },
    paymentCompleted: { type: Boolean, default: false }
  },
  verification: {
    status: {
      type: String,
      enum: ['PENDING', 'VERIFIED', 'UNVERIFIED', 'REJECTED'],
      default: 'UNVERIFIED'
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for geospatial queries
storeSchema.index({ 'delivery.sellerDelivery.location': '2dsphere' });
storeSchema.index({ 'location': '2dsphere' });

module.exports = mongoose.model('Store', storeSchema);
