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

function roundKg(value) {
  return Math.round(Math.max(0, toNumber(value, 0)) * 1000) / 1000;
}

function parseWeightToKg(raw) {
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw <= 0) return 0;
    return raw > 30 ? roundKg(raw / 1000) : roundKg(raw);
  }
  const text = String(raw).trim().toLowerCase().replace(',', '.');
  if (!text) return 0;
  const match = text.match(/([\d.]+)\s*(kg|kgs|kilo|kilogrammes?|g|gr|grammes?|lbs?)?/);
  if (!match) return 0;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const unit = String(match[2] || '');
  if (unit === 'g' || unit === 'gr' || unit.startsWith('gram')) return roundKg(n / 1000);
  if (unit.startsWith('lb')) return roundKg(n * 0.453592);
  if (unit.startsWith('kg') || unit.startsWith('kilo')) return roundKg(n);
  return n > 30 ? roundKg(n / 1000) : roundKg(n);
}

function weightFromSpecifications(product = {}) {
  const rows = Array.isArray(product.specifications) ? product.specifications : [];
  const row = rows.find((entry) => /poids|weight|masse/i.test(String(entry?.key || '')));
  return row?.value;
}

function parseProductWeightKg(product = {}) {
  const candidates = [
    product.weightKg,
    product.weight,
    product.productWeight,
    product.supplier?.weight,
    product.supplier?.productWeight,
    product.supplier?.cjProductWeight,
    product.variants?.[0]?.weight,
    product.variants?.[0]?.attributes?.weight,
    weightFromSpecifications(product),
  ];
  for (const candidate of candidates) {
    const kg = parseWeightToKg(candidate);
    if (kg > 0) return kg;
  }
  return 0.5;
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

function calculateImportPricing(product = {}, { quantity = 1, config, includeShippingMarkup = true } = {}) {
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
  const billedWeight = roundKg(unitWeight * qty);
  const shippingBaseCost = Math.round(toNumber(rate.ratePerKg) * billedWeight);
  const shippingMarkup = includeShippingMarkup ? Math.round(cfg.shippingMarkup) : 0;
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
    includeShippingMarkup: false,
  }));
  const productTotal = itemQuotes.reduce((sum, row) => sum + row.productLineTotal, 0);
  const billedWeight = roundKg(itemQuotes.reduce((sum, row) => sum + row.shipping.billedWeight, 0));
  const ratePerKg = toNumber(cfg.shippingRates.normal?.ratePerKg, 10000);
  const shippingBaseCost = Math.round(ratePerKg * billedWeight);
  const shippingMarkup = itemQuotes.length ? Math.round(cfg.shippingMarkup) : 0;
  const shippingCost = shippingBaseCost + shippingMarkup;
  const days = itemQuotes.map((row) => row.estimatedDays);
  const minDays = days.length ? Math.min(...days.map((row) => row.min)) : 20;
  const maxDays = days.length ? Math.max(...days.map((row) => row.max)) : 30;
  return {
    currency: 'XOF',
    productTotal: Math.round(productTotal),
    billedWeight,
    ratePerKg,
    shippingBaseCost,
    shippingMarkup,
    shippingCost,
    total: Math.round(productTotal + shippingCost),
    estimatedDays: { min: minDays, max: maxDays },
    estimatedDeliveryLabel: `${minDays}–${maxDays} jours`,
    items: itemQuotes,
  };
}

module.exports = {
  mergeImportPricingConfig,
  applyProductMarkup,
  parseWeightToKg,
  parseProductWeightKg,
  inferShippingCategory,
  convertSupplierPriceFcfa,
  calculateImportPricing,
  calculateImportQuote,
};
