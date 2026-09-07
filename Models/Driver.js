const mongoose = require('mongoose');

const driverSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  },

  driverCode: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
    index: true,
  },

  status: {
    type: String,
    enum: ['available', 'unavailable', 'on_delivery'],
    default: 'unavailable',
    index: true,
  },

  phone: {
    type: String,
    trim: true,
    default: '',
  },

  driverPassword: {
    type: String,
    default: '',
    trim: true,
  },

  vehicleType: {
    type: String,
    default: '',
  },

  vehiclePlate: {
    type: String,
    default: '',
  },

  zone: {
    type: String,
    default: '',
  },

  isActive: {
    type: Boolean,
    default: true,
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },

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

driverSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Driver', driverSchema);
