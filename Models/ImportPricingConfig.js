const mongoose = require('mongoose');
const { DEFAULT_IMPORT_PRICING, SHIPPING_CATEGORIES } = require('../config/importPricing');

const rateSchema = new mongoose.Schema({
  ratePerKg: { type: Number, min: 0, required: true },
  minDays: { type: Number, min: 1, required: true },
  maxDays: { type: Number, min: 1, required: true },
}, { _id: false });

const importPricingConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'default', unique: true },
  productMarkupMultiplier: { type: Number, min: 1, default: DEFAULT_IMPORT_PRICING.productMarkupMultiplier },
  minimumProductPrice: { type: Number, min: 0, default: DEFAULT_IMPORT_PRICING.minimumProductPrice },
  shippingRatePerKg: { type: Number, min: 0, default: DEFAULT_IMPORT_PRICING.shippingRatePerKg },
  shippingMarkup: { type: Number, min: 0, default: 0 },
  defaultMinimumOrderQuantity: { type: Number, min: 1, default: DEFAULT_IMPORT_PRICING.defaultMinimumOrderQuantity },
  estimatedImportDays: {
    min: { type: Number, min: 1, default: 20 },
    max: { type: Number, min: 1, default: 30 },
  },
  shippingRates: {
    type: Map,
    of: rateSchema,
    default: () => DEFAULT_IMPORT_PRICING.shippingRates,
  },
  updatedAt: { type: Date, default: Date.now },
});

importPricingConfigSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('ImportPricingConfig', importPricingConfigSchema);
module.exports.SHIPPING_CATEGORIES = SHIPPING_CATEGORIES;
