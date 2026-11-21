const mongoose = require('mongoose');

const localDeliveryConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'default', unique: true },
  config: { type: mongoose.Schema.Types.Mixed, default: {} },
  revision: { type: Number, default: 1 },
  updatedBy: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now },
  changeHistory: {
    type: [{
      changedAt: { type: Date, default: Date.now },
      changedBy: { type: String, default: '' },
      revision: Number,
    }],
    default: [],
  },
}, { timestamps: true, minimize: false });

module.exports = mongoose.model('LocalDeliveryConfig', localDeliveryConfigSchema);
