const mongoose = require('mongoose');

const alibabaConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'default', unique: true },
  sourceCurrency: { type: String, enum: ['USD', 'CNY'], default: 'USD' },
  saleCurrency: { type: String, enum: ['XOF', 'XAF'], default: 'XOF' },
  usdToXofRate: { type: Number, min: 1, default: 655 },
  cnyToUsdRate: { type: Number, min: 0.01, default: 7.2 },
  rateSafetyMarginPercent: { type: Number, min: 0, max: 100, default: 0 },
  rateProvider: { type: String, enum: ['manual', 'automatic'], default: 'manual' },
  generalMarginPercent: { type: Number, min: 0, max: 500, default: 30 },
  categoryMargins: { type: Map, of: Number, default: {} },
  minimumSalePrice: { type: Number, min: 0, default: 0 },
  enableMinimumSalePrice: { type: Boolean, default: true },
  roundingMode: { type: String, enum: ['none', 'nearest', 'up', 'down'], default: 'nearest' },
  roundingIncrement: { type: Number, min: 1, default: 1 },
  enableRounding: { type: Boolean, default: true },
  additionalFeesXof: { type: Number, min: 0, default: 0 },
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

module.exports = mongoose.model('AlibabaConfig', alibabaConfigSchema);
