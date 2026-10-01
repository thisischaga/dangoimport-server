const { DEFAULT_IMPORT_PRICING, SHIPPING_CATEGORIES, cloneImportPricingDefaults } = require('../config/importPricing');
const { toNumber, applyProductMarkup } = require('./dropshippingCalculations');
const { cjConfig } = require('../config/cj');
const { groupDropshippingLinesByOrigin } = require('./importShipmentGroups');

function mergeImportPricingConfig(overrides = {}) {
  const base = cloneImportPricingDefaults();
  const productMarkupMultiplier = Math.max(
    1,
    toNumber(overrides.productMarkupMultiplier, base.productMarkupMultiplier),
  );
  const minimumProductPrice = Math.max(
    0,
    Math.round(toNumber(overrides.minimumProductPrice, base.minimumProductPrice)),
  );
  const defaultMinimumOrderQuantity = Math.max(
    1,
    Math.round(toNumber(overrides.defaultMinimumOrderQuantity, base.defaultMinimumOrderQuantity)),
  );
  const shippingMarkup = Math.max(0, Math.round(toNumber(overrides.shippingMarkup, 0)));
  const chinaDomesticShippingUsd = Math.max(
    0,
    toNumber(overrides.chinaDomesticShippingUsd, base.chinaDomesticShippingUsd),
  );
  const estimatedImportDays = {
    min: Math.max(1, toNumber(overrides.estimatedImportDays?.min, base.estimatedImportDays.min)),
    max: Math.max(1, toNumber(overrides.estimatedImportDays?.max, base.estimatedImportDays.max)),
  };
  if (estimatedImportDays.max < estimatedImportDays.min) {
    estimatedImportDays.max = estimatedImportDays.min;
  }

  const incomingRates = overrides.shippingRates && typeof overrides.shippingRates === 'object'
    ? (overrides.shippingRates instanceof Map
      ? Object.fromEntries(overrides.shippingRates)
      : overrides.shippingRates)
    : {};
  const fallbackRate = toNumber(
    overrides.shippingRatePerKg,
    toNumber(incomingRates.normal?.ratePerKg, base.shippingRatePerKg),
  );
  const shippingRates = { ...base.shippingRates };
  SHIPPING_CATEGORIES.forEach((key) => {
    const row = incomingRates[key] || {};
    shippingRates[key] = {
      ratePerKg: toNumber(row.ratePerKg, fallbackRate),
      minDays: toNumber(row.minDays, estimatedImportDays.min),
      maxDays: toNumber(row.maxDays, estimatedImportDays.max),
    };
  });
  const shippingRatePerKg = toNumber(shippingRates.normal?.ratePerKg, fallbackRate);

  return {
    productMarkupMultiplier,
    minimumProductPrice,
    shippingRatePerKg,
    chinaDomesticShippingUsd,
    shippingMarkup,
    defaultMinimumOrderQuantity,
    lightProductMaxWeightKg: Math.max(0.05, toNumber(overrides.lightProductMaxWeightKg, base.lightProductMaxWeightKg)),
    lightProductMaxPrice: Math.max(0, Math.round(toNumber(overrides.lightProductMaxPrice, base.lightProductMaxPrice))),
    estimatedImportDays,
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
  const storedWeight = product.weightKg ?? product.weight;
  const storedKg = parseWeightToKg(storedWeight);
  const specKg = parseWeightToKg(weightFromSpecifications(product));
  const supplierKg = parseWeightToKg(
    product.supplier?.productWeight
    ?? product.productWeight
    ?? product.supplier?.weight
    ?? product.supplier?.cjProductWeight
    ?? product.variants?.[0]?.weight
    ?? product.variants?.[0]?.attributes?.weight,
  );

  if (specKg > 0 && (storedKg <= 0 || storedKg === 0.5)) return specKg;
  if (supplierKg > 0 && (storedKg <= 0 || storedKg === 0.5)) return supplierKg;
  if (storedKg > 0 && storedKg !== 0.5) return storedKg;
  if (specKg > 0) return specKg;
  if (supplierKg > 0) return supplierKg;
  if (storedKg > 0) return storedKg;
  return 0;
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

function lineSupplierGoodsUsd(line = {}) {
  const product = line.product || line;
  const qty = Math.max(1, Math.round(toNumber(line.quantity, 1)));
  const currency = String(product.supplier?.supplierCurrency || product.currency || 'XOF').toUpperCase();
  const price = toNumber(product.supplierRealPrice ?? product.supplier?.supplierPrice ?? 0, 0);
  if (currency === 'USD') return price * qty;
  return 0;
}

function calculateChinaDomesticShipping(lines = [], config) {
  const cfg = mergeImportPricingConfig(config || {});
  const usdPerGroup = Math.max(0, toNumber(cfg.chinaDomesticShippingUsd, 2));
  const grouped = groupDropshippingLinesByOrigin(lines);
  const groups = [...grouped.entries()].map(([origin, groupLines]) => ({
    origin,
    itemCount: groupLines.length,
    goodsUsd: Number(groupLines.reduce((sum, line) => sum + lineSupplierGoodsUsd(line), 0).toFixed(2)),
  }));
  const groupCount = groups.length;
  const usd = Number((groupCount * usdPerGroup).toFixed(2));
  const fcfa = Math.max(0, Math.round(usd * toNumber(cjConfig.usdToXofRate, 610)));
  const goodsUsd = Number(groups.reduce((sum, row) => sum + row.goodsUsd, 0).toFixed(2));
  return {
    usdPerGroup,
    groupCount,
    usd,
    fcfa,
    currency: 'USD',
    groups,
    goodsUsd,
    supplierTotalUsd: Number((goodsUsd + usd).toFixed(2)),
  };
}

function lightProductMoqFromWeight(weightKg, thresholdKg = 1) {
  const weight = Number(weightKg);
  const threshold = Number(thresholdKg);
  if (!(weight > 0) || !(threshold > 0) || weight >= threshold) return 1;
  return Math.max(2, Math.ceil((threshold / weight) - 1e-9));
}

function resolveMoqRules(product = {}, config = {}) {
  const cfg = mergeImportPricingConfig(config || {});
  const explicitMoq = Math.max(
    1,
    Math.round(toNumber(product.minimumOrderQuantity, cfg.defaultMinimumOrderQuantity)),
  );
  const converted = convertSupplierPriceFcfa(product);
  const multiplier = Math.max(1, toNumber(product.productMarkupMultiplier, cfg.productMarkupMultiplier));
  const unitPrice = applyProductMarkup(converted, multiplier, 0);
  const weight = parseProductWeightKg(product);
  const underWeight = weight > 0 && weight < cfg.lightProductMaxWeightKg;
  const underPrice = unitPrice > 0 && unitPrice < cfg.lightProductMaxPrice;
  const autoMoq = (underWeight && underPrice)
    ? lightProductMoqFromWeight(weight, cfg.lightProductMaxWeightKg)
    : 1;
  const moq = Math.max(explicitMoq, autoMoq);
  const hasExplicitIncrement = product.quantityIncrement != null && product.quantityIncrement !== '';
  const explicitIncrement = hasExplicitIncrement
    ? Math.max(1, Math.round(toNumber(product.quantityIncrement, moq)))
    : null;
  const increment = explicitIncrement && explicitIncrement !== explicitMoq
    ? explicitIncrement
    : moq;
  return {
    minimumOrderQuantity: moq,
    quantityIncrement: increment,
    soldAsLot: moq > 1 && increment === moq,
    lightProductMoq: autoMoq,
  };
}

function isValidOrderQuantity(quantity, rules) {
  const qty = Math.round(toNumber(quantity, 0));
  if (qty < rules.minimumOrderQuantity) return false;
  return (qty - rules.minimumOrderQuantity) % rules.quantityIncrement === 0;
}

function assertValidOrderQuantity(product, quantity, config) {
  const rules = resolveMoqRules(product, config);
  const qty = Math.round(toNumber(quantity, 0));
  if (isValidOrderQuantity(qty, rules)) return { ...rules, quantity: qty };
  const err = new Error(
    rules.soldAsLot
      ? `Quantité invalide pour ${product.name || 'ce produit'} : vente par lots de ${rules.minimumOrderQuantity}.`
      : `Quantité minimale : ${rules.minimumOrderQuantity} pour ${product.name || 'ce produit'}.`,
  );
  err.status = 400;
  throw err;
}

function calculateImportPricing(product = {}, { quantity = 1, config, includeShippingMarkup = false } = {}) {
  const cfg = mergeImportPricingConfig(config || {});
  const qty = Math.max(1, Math.round(toNumber(quantity, 1)));
  const multiplier = Math.max(
    1,
    toNumber(product.productMarkupMultiplier, cfg.productMarkupMultiplier),
  );
  const minUnitPrice = Math.max(
    0,
    Math.round(toNumber(product.minimumProductPrice, 0)),
  );
  const convertedSupplierPriceFCFA = convertSupplierPriceFcfa(product);
  const unitPrice = applyProductMarkup(convertedSupplierPriceFCFA, multiplier, minUnitPrice);
  const moq = resolveMoqRules(product, cfg);
  const packSize = moq.soldAsLot ? moq.minimumOrderQuantity : 1;
  const packPrice = unitPrice * packSize;
  const category = inferShippingCategory(product);
  const rate = cfg.shippingRates[category] || cfg.shippingRates.normal;
  const ratePerKg = toNumber(cfg.shippingRatePerKg, rate.ratePerKg);
  const unitWeight = parseProductWeightKg(product);
  const billedWeight = roundKg(unitWeight * qty);
  const shippingBaseCost = Math.round(ratePerKg * billedWeight);
  const shippingMarkup = includeShippingMarkup ? Math.round(cfg.shippingMarkup) : 0;
  const shippingCost = shippingBaseCost + shippingMarkup;
  const productLineTotal = unitPrice * qty;
  const estimatedDays = {
    min: toNumber(cfg.estimatedImportDays?.min, rate.minDays || 20),
    max: toNumber(cfg.estimatedImportDays?.max, rate.maxDays || 30),
  };

  return {
    productPrice: unitPrice,
    unitPrice,
    packPrice,
    packSize,
    quantity: qty,
    productLineTotal,
    shippingBaseCost,
    shippingMarkup,
    shippingCost,
    total: productLineTotal + shippingCost,
    estimatedDays,
    supplier: String(product.supplier?.platform || product.supplier?.name || 'CJ').toUpperCase().startsWith('CJ')
      ? 'CJ'
      : (product.supplier?.platform || product.supplier?.name || ''),
    supplierProductId: product.supplier?.productId || '',
    supplierRealPrice: toNumber(product.supplier?.supplierPrice, 0),
    currency: String(product.supplier?.supplierCurrency || 'XOF').toUpperCase(),
    convertedSupplierPriceFCFA,
    productMarkupMultiplier: multiplier,
    minimumProductPrice: minUnitPrice,
    minimumOrderQuantity: moq.minimumOrderQuantity,
    quantityIncrement: moq.quantityIncrement,
    soldAsLot: moq.soldAsLot,
    sellingPrice: unitPrice,
    weight: unitWeight,
    unitWeight,
    shippingCategory: category,
    estimatedImportDays: estimatedDays,
    shipping: {
      category,
      weight: unitWeight,
      billedWeight,
      ratePerKg,
      baseCost: shippingBaseCost,
      markup: shippingMarkup,
      customerCost: shippingCost,
      estimatedDays,
    },
  };
}

function calculateImportOrderPricing(lines = [], config) {
  const cfg = mergeImportPricingConfig(config || {});
  const itemQuotes = (lines || []).map((line) => {
    const product = line.product || line;
    const quantity = line.quantity != null ? line.quantity : 1;
    assertValidOrderQuantity(product, quantity, cfg);
    return calculateImportPricing(product, {
      quantity,
      config: cfg,
      includeShippingMarkup: false,
    });
  });
  const itemsTotal = itemQuotes.reduce((sum, row) => sum + row.productLineTotal, 0);
  const totalWeightKg = roundKg(itemQuotes.reduce((sum, row) => sum + row.shipping.billedWeight, 0));
  const ratePerKg = toNumber(cfg.shippingRatePerKg, 13500);
  const shippingCost = Math.round(ratePerKg * totalWeightKg);
  const days = itemQuotes.map((row) => row.estimatedDays);
  const minDays = days.length ? Math.min(...days.map((row) => row.min)) : cfg.estimatedImportDays.min;
  const maxDays = days.length ? Math.max(...days.map((row) => row.max)) : cfg.estimatedImportDays.max;
  const chinaDomesticShipping = calculateChinaDomesticShipping(lines, cfg);
  return {
    currency: 'XOF',
    itemsTotal: Math.round(itemsTotal),
    productTotal: Math.round(itemsTotal),
    totalWeightKg,
    billedWeight: totalWeightKg,
    ratePerKg,
    shippingRatePerKg: ratePerKg,
    shippingBaseCost: shippingCost,
    shippingMarkup: 0,
    shippingCost,
    chinaDomesticShipping,
    chinaDomesticShippingUsd: chinaDomesticShipping.usd,
    chinaDomesticShippingFcfa: chinaDomesticShipping.fcfa,
    total: Math.round(itemsTotal + shippingCost),
    estimatedDays: { min: minDays, max: maxDays },
    estimatedDelivery: { minDays, maxDays },
    estimatedDeliveryLabel: `${minDays}–${maxDays} jours`,
    items: itemQuotes,
  };
}

function calculateImportQuote(lines = [], config) {
  return calculateImportOrderPricing(lines, config);
}

module.exports = {
  mergeImportPricingConfig,
  applyProductMarkup,
  parseWeightToKg,
  parseProductWeightKg,
  inferShippingCategory,
  convertSupplierPriceFcfa,
  resolveMoqRules,
  lightProductMoqFromWeight,
  isValidOrderQuantity,
  assertValidOrderQuantity,
  calculateImportPricing,
  calculateImportQuote,
  calculateImportOrderPricing,
  calculateChinaDomesticShipping,
};
