const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    index: true,
    unique: true
  },
  otp: {
    type: String,
    required: true
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 600 // Expire en 10 minutes (600 secondes)
  }
});

module.exports = mongoose.model('Otp', otpSchema);
