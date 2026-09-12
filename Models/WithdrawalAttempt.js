const mongoose = require('mongoose');

const withdrawalAttemptSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  amount: { type: Number, required: true },
  destinationPhone: { type: String, required: true },
  otpHash: { type: String, required: true },
  otpExpiresAt: { type: Date, required: true },
  otpAttempts: { type: Number, default: 0 },
  otpVerifiedAt: { type: Date, default: null },
  status: { type: String, enum: ['otp_sent', 'verified', 'cancelled', 'expired'], default: 'otp_sent' },
  createdAt: { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.model('WithdrawalAttempt', withdrawalAttemptSchema);
