const mongoose = require('mongoose');

const alibabaTokenSchema = new mongoose.Schema({
  key: { type: String, default: 'default', unique: true },
  accessToken: { type: String, default: '' },
  refreshToken: { type: String, default: '' },
  expiresAt: { type: Date, default: null },
  aliId: { type: String, default: '' },
  resourceOwner: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now },
});

alibabaTokenSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('AlibabaToken', alibabaTokenSchema);
