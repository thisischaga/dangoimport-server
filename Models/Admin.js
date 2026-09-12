const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  adminFirstname: {
    type: String,
    required: true,
  },
  adminSurname: {
    type: String,
    required: true,
  },
  adminName: {
    type: String,
    required: true,
    unique: true,
  },
  adminPassword: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    required: true,
  },
  totpEnabled: {
    type: Boolean,
    default: false,
  },
  totpSecret: {
    type: String,
    select: false,
  },
  totpPendingSecret: {
    type: String,
    select: false,
  },
  totpBackupCodes: {
    type: [String],
    default: [],
    select: false,
  },
});

module.exports = mongoose.model('Admin', userSchema);
