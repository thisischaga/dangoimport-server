const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  userName: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    required: true,
  },
  action: {
    type: String,
    required: true,
  },
  targetResource: {
    type: String,
    required: true,
  },
  targetId: {
    type: String,
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  ipAddress: {
    type: String,
    default: '127.0.0.1',
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
