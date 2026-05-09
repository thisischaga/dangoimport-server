const mongoose = require('mongoose');

const DevisSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  phone: {
    type: String,
    required: true,
    trim: true,
  },
  productLink: {
    type: String,
    required: true,
    trim: true,
  },
  quantity: {
    type: Number,
    required: true,
  },
  description: {
    type: String,
    trim: true,
    default: '',
  },
  studyFee: {
    type: Number,
    default: 5000,
  },
  photoUrl: {
    type: String,
    trim: true,
  },
  photoFilename: {
    type: String,
    trim: true,
  },
  status: {
    type: String,
    enum: ['pending_payment', 'paid', 'failed'],
    default: 'pending_payment',
  },
  paymentToken: {
    type: String,
    trim: true,
  },
  invoiceUrl: {
    type: String,
    trim: true,
  },
  invoiceStatus: {
    type: String,
    trim: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Devis', DevisSchema);
