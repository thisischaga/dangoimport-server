const { DEFAULT_IMPORT_PRICING, SHIPPING_CATEGORIES, cloneImportPricingDefaults } = require('../config/importPricing');
const { toNumber, applyProductMarkup } = require('./dropshippingCalculations');
const { cjConfig } = require('../config/cj');
const { groupDropshippingLinesByOrigin } = require('./importShipmentGroups');

function isAlibabaManagedProduct(product = {}) {
  return product.isAlibaba === true
    || String(product.source || '').toUpperCase() === 'ALIBABA'
    || product.importSourceType === 'ALIBABA_API'
    || String(product.fulfillmentPlatform || '').toLowerCase() === 'alibaba'
    || String(product.supplier?.platform || '').toLowerCase() === 'alibaba'
    || /^alibaba:/i.test(String(product.externalSourceKey || ''));
}

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
  const localDeliveryFee = Math.max(0, Math.round(toNumber(overrides.localDeliveryFee, base.localDeliveryFee || 2000)));
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
    localDeliveryFee,
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
  const safeProduct = product && typeof product === 'object' ? product : {};
  let weight;
  const visit = (value, depth = 0) => {
    if (weight != null || depth > 8 || value == null) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, depth + 1));
      return;
    }
    if (typeof value !== 'object') return;

    const key = String(value.key || value.name || value.attr_name_desc || value.attr_name
      || value.attributeName || value.prop_name || value.property_name || '');
    const directValue = value.value ?? value.val ?? value.attr_value_desc ?? value.attr_value
      ?? value.attributeValue ?? value.prop_value ?? value.property_value;
    if (/poids|weight|masse/i.test(key) && directValue != null) {
      weight = directValue;
      return;
    }
    if (/poids|weight|masse/i.test(key) && Array.isArray(value.values)) {
      const entry = value.values.find((item) => item != null);
      if (entry != null) {
        weight = typeof entry === 'object'
          ? entry.value ?? entry.val ?? entry.attr_value_desc ?? entry.attr_value
          : entry;
        if (weight != null) return;
      }
    }
    for (const field of ['specifications', 'attributes', 'attribute_list', 'attr_list', 'product_attributes']) {
      if (value[field]) visit(value[field], depth + 1);
    }
  };

  visit(safeProduct.specifications);
  visit(safeProduct.attributes);
  visit(safeProduct.rawSections?.keyAttributes);
  visit(safeProduct.rawPayload?.keyAttributes);
  visit(safeProduct.rawPayload?.result_data?.keyAttributes);
  visit(safeProduct.rawPayload?.raw?.keyAttributes);
  return weight;
}

function parseProductWeightKg(product = {}) {
  const safeProduct = product && typeof product === 'object' ? product : {};
  const logistics = safeProduct.logistics || {};
  const logisticsWeight = logistics.grossWeight
    ?? logistics.netWeight
    ?? logistics.weight;
  const storedWeight = safeProduct.weightKg != null && safeProduct.weightKg !== ''
    ? `${safeProduct.weightKg} kg`
    : (typeof logisticsWeight === 'number' && logistics.weightUnit
      ? `${logisticsWeight} ${logistics.weightUnit}`
      : logisticsWeight) ?? safeProduct.weight;
  const storedKg = parseWeightToKg(storedWeight);
  const specKg = parseWeightToKg(weightFromSpecifications(safeProduct));
  const supplierKg = parseWeightToKg(
    safeProduct.supplier?.productWeight
    ?? safeProduct.productWeight
    ?? safeProduct.supplier?.weight
    ?? safeProduct.supplier?.cjProductWeight
    ?? safeProduct.variants?.[0]?.weight
    ?? safeProduct.variants?.[0]?.attributes?.weight,
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
  const safeProduct = product && typeof product === 'object' ? product : {};
  const stored = String(safeProduct.shippingCategory || '').trim().toLowerCase();
  if (SHIPPING_CATEGORIES.includes(stored)) return stored;
  const hay = [
    safeProduct.category,
    safeProduct.subCategory,
    safeProduct.name,
    safeProduct.tags?.join?.(' '),
  ].join(' ').toLowerCase();
  if (/téléphone|telephone|smartphone|iphone|samsung galaxy/.test(hay)) return 'telephone';
  if (/ordinateur|laptop|computer|\bpc\b|macbook/.test(hay)) return 'ordinateur';
  if (/médical|medical|pharma|médicament/.test(hay)) return 'medical';
  if (/fragile|verre|glass|porcelaine/.test(hay)) return 'fragile';
  if (/spécial|special/.test(hay)) return 'special';
  return 'normal';
}

function convertSupplierPriceFcfa(product = {}) {
  const safeProduct = product && typeof product === 'object' ? product : {};
  const stored = toNumber(
    safeProduct.convertedSupplierPriceFCFA
      ?? safeProduct.supplier?.convertedSupplierPriceFCFA
      ?? safeProduct.pricing?.calculation?.convertedSupplierPrice,
    0,
  );
  if (stored > 0) return Math.round(stored);
  if (isAlibabaManagedProduct(safeProduct)) return 0;

  const directPrice = toNumber(safeProduct.salePrice || safeProduct.price || safeProduct.unitPrice || 0);

  let supplierPrice = toNumber(
    safeProduct.supplierRealPrice
    ?? safeProduct.supplier?.supplierPrice
    ?? safeProduct.costPrice
    ?? safeProduct.pricing?.sourcePrice
    ?? safeProduct.pricing?.tiers?.[0]?.price
    ?? safeProduct.sourcePriceTiers?.[0]?.price
    ?? safeProduct.publicPriceTiers?.[0]?.price
    ?? safeProduct.variants?.[0]?.ladderPrices?.[0]?.price
    ?? safeProduct.variants?.[0]?.price
    ?? safeProduct.wholesale?.price
    ?? 0
  );

  let currency = String(
    safeProduct.supplier?.supplierCurrency
    || safeProduct.pricing?.currency
    || safeProduct.currency
    || (supplierPrice > 0 ? 'USD' : 'XOF')
  ).toUpperCase();

  if (supplierPrice <= 0 && directPrice > 0) {
    return Math.round(directPrice);
  }

  if (currency === 'USD') {
    return Math.max(0, Math.round(supplierPrice * toNumber(cjConfig?.usdToXofRate || 620, 620)));
  }
  return Math.round(supplierPrice || directPrice);
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
  const fcfa = Math.max(0, Math.round(usd * toNumber(cjConfig.usdToXofRate, 620)));
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
  const safeProduct = product && typeof product === 'object' ? product : {};
  const cfg = mergeImportPricingConfig(config || {});
  const explicitMoq = Math.max(
    1,
    Math.round(toNumber(safeProduct.minimumOrderQuantity, cfg.defaultMinimumOrderQuantity)),
  );
  const converted = convertSupplierPriceFcfa(safeProduct);
  const multiplier = Math.max(1, toNumber(safeProduct.productMarkupMultiplier, cfg.productMarkupMultiplier));
  const unitPrice = applyProductMarkup(converted, multiplier, 0);
  const weight = parseProductWeightKg(safeProduct);
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

function calculateImportPricing(product = {}, {
  quantity = 1,
  config,
  includeShippingMarkup = false,
  unitPriceOverride,
} = {}) {
  const safeProduct = product && typeof product === 'object' ? product : {};
  const cfg = mergeImportPricingConfig(config || {});
  const qty = Math.max(1, Math.round(toNumber(quantity, 1)));
  const isAlibaba = isAlibabaManagedProduct(safeProduct);
  const multiplier = Math.max(
    1,
    toNumber(safeProduct.productMarkupMultiplier, cfg.productMarkupMultiplier),
  );
  const minUnitPrice = Math.max(
    0,
    Math.round(toNumber(safeProduct.minimumProductPrice, 0)),
  );
  const convertedSupplierPriceFCFA = convertSupplierPriceFcfa(safeProduct);
  const hasUnitPriceOverride = unitPriceOverride !== undefined && unitPriceOverride !== null;
  const alibabaSalePrice = hasUnitPriceOverride
    ? toNumber(unitPriceOverride, 0)
    : toNumber(safeProduct.price, 0) || toNumber(safeProduct.pricing?.calculation?.salePrice, 0);
  if (isAlibaba && (!Number.isFinite(alibabaSalePrice) || alibabaSalePrice <= 0)) {
    const error = new Error('Prix de vente Alibaba absent : le prix doit être recalculé par le service central avant la commande.');
    error.status = 422;
    throw error;
  }
  const unitPrice = isAlibaba
    ? Math.max(0, Math.round(alibabaSalePrice))
    : hasUnitPriceOverride
    ? Math.max(0, Math.round(toNumber(unitPriceOverride, 0)))
    : applyProductMarkup(convertedSupplierPriceFCFA, multiplier, minUnitPrice);
  const moq = resolveMoqRules(safeProduct, cfg);
  const packSize = moq.soldAsLot ? moq.minimumOrderQuantity : 1;
  const packPrice = unitPrice * packSize;
  const category = inferShippingCategory(safeProduct);
  const rate = cfg.shippingRates[category] || cfg.shippingRates.normal;
  const ratePerKg = toNumber(rate.ratePerKg, cfg.shippingRatePerKg);
  const unitWeight = parseProductWeightKg(safeProduct);
  const billedWeight = roundKg(unitWeight * qty);
  const shippingBaseCost = Math.round(ratePerKg * billedWeight);
  const shippingMarkup = includeShippingMarkup ? Math.round(cfg.shippingMarkup) : 0;
  const shippingCost = shippingBaseCost + shippingMarkup;
  const productLineTotal = unitPrice * qty;
  const estimatedDays = {
    min: toNumber(rate.minDays, cfg.estimatedImportDays?.min || 20),
    max: toNumber(rate.maxDays, cfg.estimatedImportDays?.max || 30),
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
    supplier: String(safeProduct.supplier?.platform || safeProduct.supplier?.name || 'CJ').toUpperCase().startsWith('CJ')
      ? 'CJ'
      : (safeProduct.supplier?.platform || safeProduct.supplier?.name || ''),
    supplierProductId: safeProduct.supplier?.productId || '',
    supplierRealPrice: toNumber(safeProduct.supplier?.supplierPrice, 0),
    currency: String(safeProduct.supplier?.supplierCurrency || 'XOF').toUpperCase(),
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
    const isAlibaba = isAlibabaManagedProduct(product);
    if (!isAlibaba && !(parseProductWeightKg(product) > 0)) {
      const error = new Error(`Poids manquant pour « ${product.name || product.title || 'un produit'} ».`);
      error.status = 422;
      error.code = 'IMPORT_PRODUCT_MEASUREMENTS_REQUIRED';
      throw error;
    }
    return calculateImportPricing(product, {
      quantity,
      config: cfg,
      includeShippingMarkup: false,
      unitPriceOverride: isAlibaba ? product.price : undefined,
    });
  });
  const itemsTotal = itemQuotes.reduce((sum, row) => sum + row.productLineTotal, 0);
  const totalWeightKg = roundKg(itemQuotes.reduce((sum, row) => sum + row.shipping.billedWeight, 0));
  const ratesPerKg = [...new Set(itemQuotes.map((row) => row.shipping.ratePerKg))];
  const ratePerKg = ratesPerKg.length === 1 ? ratesPerKg[0] : null;
  const shippingTransitCost = itemQuotes.reduce((sum, row) => sum + row.shippingBaseCost, 0);
  const localDeliveryFee = toNumber(cfg.localDeliveryFee, 2000);
  const shippingCost = shippingTransitCost + localDeliveryFee;
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
    shippingBaseCost: shippingTransitCost,
    shippingMarkup: 0,
    localDeliveryFee,
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
  isAlibabaManagedProduct,
};
