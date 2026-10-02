const DEFAULT_IMPORT_PRICING = {
  productMarkupMultiplier: 1.3,
  minimumProductPrice: 0,
  shippingRatePerKg: 13500,
  chinaDomesticShippingUsd: 2,
  shippingMarkup: 0,
  defaultMinimumOrderQuantity: 20,
  lightProductMaxWeightKg: 1,
  lightProductMaxPrice: 2000,
  estimatedImportDays: { min: 20, max: 30 },
  shippingRates: {
    normal: { ratePerKg: 13500, minDays: 20, maxDays: 30 },
    fragile: { ratePerKg: 13500, minDays: 20, maxDays: 30 },
    special: { ratePerKg: 13500, minDays: 20, maxDays: 30 },
    medical: { ratePerKg: 13500, minDays: 20, maxDays: 30 },
    telephone: { ratePerKg: 13500, minDays: 20, maxDays: 30 },
    ordinateur: { ratePerKg: 13500, minDays: 20, maxDays: 30 },
  },
};

const LEGACY_RATE_PER_KG = new Set([9000, 10000, 10500, 11500, 15000, 25000, 100000]);

const SHIPPING_CATEGORIES = Object.keys(DEFAULT_IMPORT_PRICING.shippingRates);

function cloneImportPricingDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_IMPORT_PRICING));
}

function hasLegacyTransitRates(config = {}) {
  if (Number(config.shippingMarkup) === 3000) return true;
  if (Number(config.shippingRatePerKg) === 10000) return true;
  if (Number(config.minimumProductPrice) === 1000) return true;
  const rates = config.shippingRates && typeof config.shippingRates === 'object'
    ? (config.shippingRates instanceof Map
      ? Object.fromEntries(config.shippingRates)
      : config.shippingRates)
    : {};
  return SHIPPING_CATEGORIES.some((key) => LEGACY_RATE_PER_KG.has(Number(rates[key]?.ratePerKg)));
}

module.exports = {
  DEFAULT_IMPORT_PRICING,
  SHIPPING_CATEGORIES,
  cloneImportPricingDefaults,
  hasLegacyTransitRates,
};
