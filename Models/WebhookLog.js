const mongoose = require('mongoose');

const webhookLogSchema = new mongoose.Schema({
  eventId: {
    type: String,
    required: true,
    index: true,
  },
  provider: {
    type: String,
    default: 'fedapay',
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  signature: String,
  status: {
    type: String,
    enum: ['received', 'processed', 'failed', 'duplicate'],
    default: 'received',
    index: true,
  },
  error: String,
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

module.exports = mongoose.model('WebhookLog', webhookLogSchema);
