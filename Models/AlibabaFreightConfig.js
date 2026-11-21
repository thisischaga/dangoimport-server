const mongoose = require('mongoose');

const alibabaFreightConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'default', unique: true },
  destinations: { type: mongoose.Schema.Types.Mixed, default: {} },
  volumetric: { type: mongoose.Schema.Types.Mixed, default: {} },
  updatedBy: { type: String, default: '' },
  changeHistory: {
    type: [{
      changedAt: { type: Date, default: Date.now },
      changedBy: { type: String, default: '' },
      changedFields: { type: [String], default: [] },
    }],
    default: [],
  },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true, minimize: false });

module.exports = mongoose.model('AlibabaFreightConfig', alibabaFreightConfigSchema);
