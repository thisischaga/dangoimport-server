const DEFAULT_IMPORT_PRICING = {
  productMarkupMultiplier: 1.3,
  shippingMarkup: 3000,
  shippingRates: {
    normal: { ratePerKg: 9000, minDays: 20, maxDays: 30 },
    fragile: { ratePerKg: 10500, minDays: 20, maxDays: 30 },
    special: { ratePerKg: 10500, minDays: 20, maxDays: 30 },
    medical: { ratePerKg: 11500, minDays: 20, maxDays: 30 },
    telephone: { ratePerKg: 15000, minDays: 20, maxDays: 30 },
    ordinateur: { ratePerKg: 25000, minDays: 20, maxDays: 30 },
  },
};

const SHIPPING_CATEGORIES = Object.keys(DEFAULT_IMPORT_PRICING.shippingRates);

function cloneImportPricingDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_IMPORT_PRICING));
}

module.exports = {
  DEFAULT_IMPORT_PRICING,
  SHIPPING_CATEGORIES,
  cloneImportPricingDefaults,
};
