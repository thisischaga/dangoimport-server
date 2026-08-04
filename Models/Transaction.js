const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  transactionId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  checkoutUrl: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'canceled', 'failed'],
    default: 'pending',
    index: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  currency: {
    type: String,
    required: true,
    default: 'XOF',
  },
  customer: {
    firstname: String,
    lastname: String,
    email: String,
    phone_number: {
      number: String,
      country: String,
    },
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ShopOrder',
    default: null,
    index: true,
  },
  provider: {
    type: String,
    default: 'fedapay',
  },
  webhookProcessed: {
    type: Boolean,
    default: false,
    index: true,
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

transactionSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Transaction', transactionSchema);
