const mongoose = require('mongoose');

const sourcingRequestSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    country: { type: String, required: true, enum: ['Togo', 'Bénin', 'Benin'] },
    productDescription: { type: String, required: true, trim: true },
    quantity: { type: String, required: true, trim: true },
    budget: { type: Number, required: true, min: 0 },
    exampleLink: { type: String, trim: true },
    imageUrl: { type: String, trim: true },
    studyFee: { type: Number, default: 5000 },
    status: {
      type: String,
      enum: ['pending_payment', 'paid', 'failed', 'in_progress', 'done'],
      default: 'pending_payment',
      index: true,
    },
    paymentTransactionId: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SourcingRequest', sourcingRequestSchema);
