const DEFAULT_IMPORT_PRICING = {
  productMarkupMultiplier: 1.3,
  shippingMarkup: 3000,
  shippingRates: {
    normal: { ratePerKg: 100000, minDays: 20, maxDays: 30 },
    fragile: { ratePerKg: 100000, minDays: 20, maxDays: 30 },
    special: { ratePerKg: 100000, minDays: 20, maxDays: 30 },
    medical: { ratePerKg: 100000, minDays: 20, maxDays: 30 },
    telephone: { ratePerKg: 100000, minDays: 20, maxDays: 30 },
    ordinateur: { ratePerKg: 100000, minDays: 20, maxDays: 30 },
  },
};

const LEGACY_RATE_PER_KG = new Set([9000, 10500, 11500, 15000, 25000]);

const SHIPPING_CATEGORIES = Object.keys(DEFAULT_IMPORT_PRICING.shippingRates);

function cloneImportPricingDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_IMPORT_PRICING));
}

function hasLegacyTransitRates(config = {}) {
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
