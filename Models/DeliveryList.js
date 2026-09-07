const mongoose = require('mongoose');

const deliveryListSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    index: true,
  },
  driverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  deliveryIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Delivery',
    default: [],
  }],
  status: {
    type: String,
    enum: ['DRAFT', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
    default: 'ASSIGNED',
    index: true,
  },
  scheduledDate: {
    type: Date,
    default: null,
  },
  zone: {
    type: String,
    default: '',
  },
  priority: {
    type: String,
    enum: ['Normale', 'Urgente', 'normal', 'high', 'urgent', 'normale', 'haute'],
    default: 'Normale',
    set: (value) => {
      const normalized = String(value ?? 'Normale').trim().toLowerCase();
      if (['normal', 'normale'].includes(normalized)) return 'Normale';
      if (['high', 'haute', 'urgent', 'urgente'].includes(normalized)) return 'Urgente';
      return 'Normale';
    },
  },
  notes: {
    type: String,
    default: '',
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

deliveryListSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('DeliveryList', deliveryListSchema);
