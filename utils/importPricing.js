const { DEFAULT_IMPORT_PRICING, SHIPPING_CATEGORIES, cloneImportPricingDefaults } = require('../config/importPricing');
const { toNumber, applyProductMarkup } = require('./dropshippingCalculations');
const { cjConfig } = require('../config/cj');

function mergeImportPricingConfig(overrides = {}) {
  const base = cloneImportPricingDefaults();
  const productMarkupMultiplier = toNumber(
    overrides.productMarkupMultiplier,
    base.productMarkupMultiplier,
  );
  const shippingMarkup = toNumber(overrides.shippingMarkup, base.shippingMarkup);
  const incomingRates = overrides.shippingRates && typeof overrides.shippingRates === 'object'
    ? (overrides.shippingRates instanceof Map
      ? Object.fromEntries(overrides.shippingRates)
      : overrides.shippingRates)
    : {};
  const shippingRates = { ...base.shippingRates };
  SHIPPING_CATEGORIES.forEach((key) => {
    const row = incomingRates[key] || {};
    shippingRates[key] = {
      ratePerKg: toNumber(row.ratePerKg, shippingRates[key].ratePerKg),
      minDays: toNumber(row.minDays, shippingRates[key].minDays),
      maxDays: toNumber(row.maxDays, shippingRates[key].maxDays),
    };
  });
  return {
    productMarkupMultiplier: Math.max(1, productMarkupMultiplier),
    shippingMarkup: Math.max(0, Math.round(shippingMarkup)),
    shippingRates,
  };
}

function parseProductWeightKg(product = {}) {
  const raw = product.weightKg
    ?? product.weight
    ?? product.supplier?.weight
    ?? product.productWeight;
  const n = toNumber(raw, 0);
  if (n <= 0) return 0.5;
  if (n > 30) return Math.round((n / 1000) * 1000) / 1000;
  return Math.round(n * 1000) / 1000;
}

function inferShippingCategory(product = {}) {
  const stored = String(product.shippingCategory || '').trim().toLowerCase();
  if (SHIPPING_CATEGORIES.includes(stored)) return stored;
  const hay = [
    product.category,
    product.subCategory,
    product.name,
    product.tags?.join?.(' '),
  ].join(' ').toLowerCase();
  if (/téléphone|telephone|smartphone|iphone|samsung galaxy/.test(hay)) return 'telephone';
  if (/ordinateur|laptop|computer|\bpc\b|macbook/.test(hay)) return 'ordinateur';
  if (/médical|medical|pharma|médicament/.test(hay)) return 'medical';
  if (/fragile|verre|glass|porcelaine/.test(hay)) return 'fragile';
  if (/spécial|special/.test(hay)) return 'special';
  return 'normal';
}

function convertSupplierPriceFcfa(product = {}) {
  const stored = toNumber(product.convertedSupplierPriceFCFA ?? product.supplier?.convertedSupplierPriceFCFA, 0);
  if (stored > 0) return Math.round(stored);
  const supplierPrice = toNumber(product.supplierRealPrice ?? product.supplier?.supplierPrice ?? product.costPrice, 0);
  const currency = String(product.supplier?.supplierCurrency || product.currency || 'XOF').toUpperCase();
  if (currency === 'USD') {
    return Math.max(0, Math.round(supplierPrice * toNumber(cjConfig.usdToXofRate, 610)));
  }
  return Math.round(supplierPrice);
}

function calculateImportPricing(product = {}, { quantity = 1, config } = {}) {
  const cfg = mergeImportPricingConfig(config || {});
  const qty = Math.max(1, Math.round(toNumber(quantity, 1)));
  const multiplier = Math.max(
    1,
    toNumber(product.productMarkupMultiplier, cfg.productMarkupMultiplier),
  );
  const convertedSupplierPriceFCFA = convertSupplierPriceFcfa(product);
  const productPrice = applyProductMarkup(convertedSupplierPriceFCFA, multiplier);
  const category = inferShippingCategory(product);
  const rate = cfg.shippingRates[category] || cfg.shippingRates.normal;
  const unitWeight = parseProductWeightKg(product);
  const billedWeight = Math.round(unitWeight * qty * 1000) / 1000;
  const shippingBaseCost = Math.round(toNumber(rate.ratePerKg) * billedWeight);
  const shippingMarkup = Math.round(cfg.shippingMarkup);
  const shippingCost = shippingBaseCost + shippingMarkup;
  const productLineTotal = productPrice * qty;
  const total = productLineTotal + shippingCost;
  const estimatedDays = {
    min: toNumber(rate.minDays, 20),
    max: toNumber(rate.maxDays, 30),
  };

  return {
    productPrice,
    quantity: qty,
    productLineTotal,
    shippingBaseCost,
    shippingMarkup,
    shippingCost,
    total,
    estimatedDays,
    supplier: String(product.supplier?.platform || product.supplier?.name || 'CJ').toUpperCase().startsWith('CJ')
      ? 'CJ'
      : (product.supplier?.platform || product.supplier?.name || ''),
    supplierProductId: product.supplier?.productId || '',
    supplierRealPrice: toNumber(product.supplier?.supplierPrice, 0),
    currency: String(product.supplier?.supplierCurrency || 'XOF').toUpperCase(),
    convertedSupplierPriceFCFA,
    productMarkupMultiplier: multiplier,
    sellingPrice: productPrice,
    weight: unitWeight,
    shippingCategory: category,
    estimatedImportDays: estimatedDays,
    shipping: {
      category,
      weight: unitWeight,
      billedWeight,
      ratePerKg: toNumber(rate.ratePerKg),
      baseCost: shippingBaseCost,
      markup: shippingMarkup,
      customerCost: shippingCost,
      estimatedDays,
    },
  };
}

function calculateImportQuote(lines = [], config) {
  const cfg = mergeImportPricingConfig(config || {});
  const itemQuotes = lines.map((line) => calculateImportPricing(line.product, {
    quantity: line.quantity,
    config: cfg,
  }));
  const productTotal = itemQuotes.reduce((sum, row) => sum + row.productLineTotal, 0);
  const shippingBaseCost = itemQuotes.reduce((sum, row) => sum + row.shippingBaseCost, 0);
  const shippingMarkup = itemQuotes.reduce((sum, row) => sum + row.shippingMarkup, 0);
  const shippingCost = itemQuotes.reduce((sum, row) => sum + row.shippingCost, 0);
  const billedWeight = itemQuotes.reduce((sum, row) => sum + row.shipping.billedWeight, 0);
  const minDays = Math.min(...itemQuotes.map((row) => row.estimatedDays.min));
  const maxDays = Math.max(...itemQuotes.map((row) => row.estimatedDays.max));
  const ratePerKg = itemQuotes[0]?.shipping.ratePerKg ?? cfg.shippingRates.normal.ratePerKg;
  return {
    currency: 'XOF',
    productTotal: Math.round(productTotal),
    billedWeight: Math.round(billedWeight * 1000) / 1000,
    ratePerKg,
    shippingBaseCost: Math.round(shippingBaseCost),
    shippingMarkup: Math.round(shippingMarkup),
    shippingCost: Math.round(shippingCost),
    total: Math.round(productTotal + shippingCost),
    estimatedDays: { min: minDays, max: maxDays },
    estimatedDeliveryLabel: `${minDays}–${maxDays} jours`,
    items: itemQuotes,
  };
}

module.exports = {
  mergeImportPricingConfig,
  applyProductMarkup,
  parseProductWeightKg,
  inferShippingCategory,
  convertSupplierPriceFcfa,
  calculateImportPricing,
  calculateImportQuote,
};
