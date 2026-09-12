const mongoose = require('mongoose');

const vendorWithdrawalSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  amount: { type: Number, required: true },
  destinationPhone: { type: String, required: true },
  status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
  otpVerified: { type: Boolean, default: false },
  reservedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  meta: { type: mongoose.Schema.Types.Mixed }
});

module.exports = mongoose.model('VendorWithdrawal', vendorWithdrawalSchema);
