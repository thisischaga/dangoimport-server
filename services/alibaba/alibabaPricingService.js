const AlibabaConfig = require('../../Models/AlibabaConfig');
const AlibabaProduct = require('../../Models/AlibabaProduct');

const DEFAULT_ALIBABA_CONFIG = Object.freeze({
  sourceCurrency: 'USD',
  saleCurrency: 'XOF',
  usdToXofRate: 655,
  cnyToUsdRate: 7.2,
  rateSafetyMarginPercent: 0,
  rateProvider: 'manual',
  generalMarginPercent: 30,
  categoryMargins: {},
  minimumSalePrice: 0,
  enableMinimumSalePrice: true,
  roundingMode: 'nearest',
  roundingIncrement: 1,
  enableRounding: true,
  additionalFeesXof: 0,
});

let cachedConfig = { ...DEFAULT_ALIBABA_CONFIG };
let cacheLoadedAt = 0;
const CACHE_MS = 15_000;

function finiteNumber(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    const error = new Error(`${field} doit être compris entre ${min} et ${max}.`);
    error.status = 400;
    throw error;
  }
  return number;
}

function normalizeAlibabaConfig(input = {}, { partial = false } = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const base = partial ? {} : DEFAULT_ALIBABA_CONFIG;
  const next = { ...base };

  ['sourceCurrency', 'saleCurrency', 'rateProvider', 'roundingMode'].forEach((key) => {
    if (source[key] !== undefined) next[key] = String(source[key]).trim();
  });
  if (next.sourceCurrency && !['USD', 'CNY'].includes(next.sourceCurrency)) {
    const error = new Error('La devise d’origine doit être USD ou CNY.');
    error.status = 400;
    throw error;
  }
  if (next.saleCurrency && !['XOF', 'XAF'].includes(next.saleCurrency)) {
    const error = new Error('La devise de vente doit être XOF ou XAF.');
    error.status = 400;
    throw error;
  }
  if (next.rateProvider && !['manual', 'automatic'].includes(next.rateProvider)) {
    const error = new Error('Source de taux invalide.');
    error.status = 400;
    throw error;
  }
  if (next.roundingMode && !['none', 'nearest', 'up', 'down'].includes(next.roundingMode)) {
    const error = new Error('Règle d’arrondi invalide.');
    error.status = 400;
    throw error;
  }

  const numericRules = {
    usdToXofRate: { min: 1 },
    cnyToUsdRate: { min: 0.01 },
    rateSafetyMarginPercent: { min: 0, max: 100 },
    generalMarginPercent: { min: 0, max: 500 },
    minimumSalePrice: { min: 0 },
    roundingIncrement: { min: 1 },
    additionalFeesXof: { min: 0 },
  };
  Object.entries(numericRules).forEach(([key, bounds]) => {
    if (source[key] !== undefined || !partial) {
      next[key] = finiteNumber(source[key] === undefined ? base[key] : source[key], key, bounds);
    }
  });
  ['enableMinimumSalePrice', 'enableRounding'].forEach((key) => {
    if (source[key] !== undefined || !partial) {
      if (typeof (source[key] === undefined ? base[key] : source[key]) !== 'boolean') {
        const error = new Error(`${key} doit être un booléen.`);
        error.status = 400;
        throw error;
      }
      next[key] = source[key] === undefined ? base[key] : source[key];
    }
  });
  if (source.categoryMargins !== undefined || !partial) {
    const margins = source.categoryMargins || {};
    if (!margins || typeof margins !== 'object' || Array.isArray(margins)) {
      const error = new Error('Les marges par catégorie doivent être un objet.');
      error.status = 400;
      throw error;
    }
    next.categoryMargins = Object.fromEntries(
      Object.entries(margins)
        .map(([category, value]) => [String(category).trim(), finiteNumber(value, `Marge ${category}`, { min: 0, max: 500 })])
        .filter(([category]) => category),
    );
  }
  return next;
}

function resolveConfigDoc(doc) {
  const plain = doc?.toObject ? doc.toObject() : doc || {};
  const categoryMargins = plain.categoryMargins instanceof Map
    ? Object.fromEntries(plain.categoryMargins)
    : plain.categoryMargins || {};
  return normalizeAlibabaConfig({ ...plain, categoryMargins });
}

async function getAlibabaConfig({ forceRefresh = false } = {}) {
  if (!forceRefresh && cacheLoadedAt && Date.now() - cacheLoadedAt < CACHE_MS) {
    return { ...cachedConfig, categoryMargins: { ...cachedConfig.categoryMargins } };
  }
  const doc = await AlibabaConfig.findOneAndUpdate(
    { key: 'default' },
    { $setOnInsert: { key: 'default', ...DEFAULT_ALIBABA_CONFIG } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  cachedConfig = resolveConfigDoc(doc);
  cacheLoadedAt = Date.now();
  return { ...cachedConfig, categoryMargins: { ...cachedConfig.categoryMargins } };
}

async function updateAlibabaConfig(payload, changedBy = 'admin') {
  const current = await getAlibabaConfig({ forceRefresh: true });
  const next = normalizeAlibabaConfig({ ...current, ...payload, categoryMargins: payload.categoryMargins ?? current.categoryMargins });
  if (next.rateProvider !== 'manual') {
    const error = new Error('La mise à jour automatique du taux n’est pas encore disponible.');
    error.status = 400;
    throw error;
  }
  const changedFields = Object.keys(next).filter((key) => JSON.stringify(next[key]) !== JSON.stringify(current[key]));
  const historyEntry = {
    changedAt: new Date(),
    changedBy: String(changedBy || 'admin'),
    changedFields,
  };
  const doc = await AlibabaConfig.findOneAndUpdate(
    { key: 'default' },
    {
      $set: { ...next, key: 'default', updatedBy: historyEntry.changedBy, updatedAt: new Date() },
      $push: { changeHistory: { $each: [historyEntry], $slice: -100 } },
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );
  cachedConfig = resolveConfigDoc(doc);
  cacheLoadedAt = Date.now();
  return { config: cachedConfig, changedFields };
}

async function repriceAlibabaCatalog(config = cachedConfig, changedBy = 'admin') {
  const operations = [];
  let updated = 0;
  const skipped = [];
  const cursor = AlibabaProduct.find({
    $or: [{ source: 'ALIBABA' }, { isAlibaba: true }],
  }).select('_id category pricing supplier normalized minimumOrderQuantity sourcePriceTiers adminHistory').lean().cursor();

  for await (const product of cursor) {
    const moq = product.minimumOrderQuantity
      ?? product.normalized?.minimumOrderQuantity
      ?? product.pricing?.minOrderQuantity
      ?? product.normalized?.pricing?.minOrderQuantity
      ?? 1;
    const sourceTiers = product.sourcePriceTiers
      || product.normalized?.sourcePriceTiers
      || product.pricing?.tiers
      || product.normalized?.pricing?.tiers
      || [];
    const priceTier = selectAlibabaPriceTier(sourceTiers, moq);
    if (sourceTiers.length && !priceTier) {
      skipped.push({
        productId: String(product._id),
        reason: `Aucun palier fournisseur ne couvre le MOQ de ${moq} unités.`,
      });
      continue;
    }
    const sourcePrice = priceTier?.price ?? product.pricing?.sourcePrice ?? product.supplier?.supplierPrice;
    if (sourcePrice == null || Number(sourcePrice) <= 0) continue;
    const sourceCurrency = priceTier?.currency
      || product.pricing?.currency
      || product.supplier?.supplierCurrency
      || config.sourceCurrency;
    let pricing;
    try {
      pricing = calculateAlibabaPrice({
        sourcePrice,
        currency: sourceCurrency,
        category: product.category,
        productMarginPercent: product.pricing?.marginPercentOverride,
        manualSalePrice: product.pricing?.manualSalePrice,
        config,
      });
    } catch (error) {
      skipped.push({ productId: String(product._id), reason: error.message });
      continue;
    }
    const calculation = {
      exchangeRate: pricing.exchangeRate,
      convertedSupplierPrice: pricing.convertedSupplierPrice,
      marginPercent: pricing.marginPercent,
      marginSource: pricing.marginSource,
      additionalFeesXof: pricing.additionalFeesXof,
      salePrice: pricing.salePrice,
      saleCurrency: pricing.saleCurrency,
      calculatedAt: new Date(),
    };
    operations.push({
      updateOne: {
        filter: { _id: product._id },
        update: {
          $set: {
            price: pricing.salePrice,
            costPrice: pricing.convertedSupplierPrice,
            convertedSupplierPriceFCFA: pricing.convertedSupplierPrice,
            marginPercent: pricing.marginPercent,
            'pricing.calculation': calculation,
            'pricing.sourcePrice': sourcePrice,
            'pricing.currency': sourceCurrency,
            'normalized.pricing.sellingPrice': pricing.salePrice,
            'normalized.pricing.sourcePrice': sourcePrice,
            'normalized.pricing.currency': sourceCurrency,
            'normalized.pricing.calculation': calculation,
          },
          $push: {
            adminHistory: {
              $each: [{
                changedAt: new Date(),
                changedBy: String(changedBy || 'admin'),
                changedFields: ['price', 'pricing.calculation'],
                action: 'reprice',
              }],
              $slice: -100,
            },
          },
        },
      },
    });
    if (operations.length >= 250) {
      await AlibabaProduct.bulkWrite(operations, { ordered: true });
      updated += operations.length;
      operations.length = 0;
    }
  }
  if (operations.length) {
    await AlibabaProduct.bulkWrite(operations, { ordered: true });
    updated += operations.length;
  }
  return { updated, skipped };
}

function roundSalePrice(value, mode, increment) {
  const step = Math.max(1, Number(increment) || 1);
  const ratio = value / step;
  if (mode === 'up') return Math.ceil(ratio) * step;
  if (mode === 'down') return Math.floor(ratio) * step;
  return Math.round(ratio) * step;
}

function selectAlibabaPriceTier(tiers = [], quantity = 1) {
  const qty = Math.max(1, Number(quantity) || 1);
  const candidates = (Array.isArray(tiers) ? tiers : [])
    .map((tier) => ({
      tier,
      minQuantity: Math.max(1, Number(tier.minQty ?? tier.minQuantity ?? tier.min_quantity) || 1),
      maxQuantity: Number(tier.maxQty ?? tier.maxQuantity ?? tier.max_quantity) || null,
    }))
    .filter(({ tier }) => Number(tier.price) > 0)
    .sort((a, b) => a.minQuantity - b.minQuantity);
  const applicable = candidates.filter(({ minQuantity, maxQuantity }) => (
    minQuantity <= qty && (maxQuantity === null || maxQuantity >= qty)
  ));
  return applicable.length ? applicable[applicable.length - 1].tier : null;
}

function calculateAlibabaPrice({
  sourcePrice,
  currency,
  category,
  productMarginPercent,
  manualSalePrice,
  config = DEFAULT_ALIBABA_CONFIG,
}) {
  const settings = normalizeAlibabaConfig(config);
  const amount = finiteNumber(sourcePrice, 'Prix fournisseur', { min: 0 });
  const sourceCurrency = String(currency || settings.sourceCurrency).toUpperCase();
  if (!['USD', 'CNY'].includes(sourceCurrency)) {
    const error = new Error(`Devise fournisseur non prise en charge : ${sourceCurrency}.`);
    error.status = 422;
    throw error;
  }
  const supplierPriceUsd = sourceCurrency === 'CNY' ? amount / settings.cnyToUsdRate : amount;
  const exchangeRate = settings.usdToXofRate * (1 + settings.rateSafetyMarginPercent / 100);
  const convertedSupplierPrice = Math.round(supplierPriceUsd * exchangeRate);
  const categoryMargin = settings.categoryMargins[String(category || '').trim()];
  const hasProductMargin = productMarginPercent !== undefined && productMarginPercent !== null && productMarginPercent !== '';
  const marginPercent = hasProductMargin
    ? finiteNumber(productMarginPercent, 'Marge produit', { min: 0, max: 500 })
    : categoryMargin !== undefined
      ? categoryMargin
      : settings.generalMarginPercent;
  const marginSource = hasProductMargin ? 'product' : categoryMargin !== undefined ? 'category' : 'general';
  const manual = manualSalePrice !== undefined && manualSalePrice !== null && manualSalePrice !== '';
  let salePrice = manual
    ? finiteNumber(manualSalePrice, 'Prix de vente manuel', { min: 1 })
    : convertedSupplierPrice * (1 + marginPercent / 100) + settings.additionalFeesXof;

  if (!manual && settings.enableMinimumSalePrice) {
    salePrice = Math.max(salePrice, settings.minimumSalePrice);
  }
  if (!manual && settings.enableRounding && settings.roundingMode !== 'none') {
    salePrice = roundSalePrice(salePrice, settings.roundingMode, settings.roundingIncrement);
  }
  return {
    sourcePrice: amount,
    sourceCurrency,
    supplierPriceUsd: Number(supplierPriceUsd.toFixed(4)),
    exchangeRate: Number(exchangeRate.toFixed(4)),
    convertedSupplierPrice: Math.round(convertedSupplierPrice),
    marginPercent,
    marginSource: manual ? 'manual' : marginSource,
    additionalFeesXof: manual ? 0 : settings.additionalFeesXof,
    salePrice: Math.round(salePrice),
    manualSalePrice: manual ? Math.round(salePrice) : null,
    saleCurrency: settings.saleCurrency,
  };
}

function calculateAlibabaVolumeCm3({ length, width, height, unit = 'cm' } = {}) {
  const dimensions = [length, width, height].map(Number);
  if (dimensions.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  const multiplier = String(unit).toLowerCase() === 'mm' ? 0.1 : String(unit).toLowerCase() === 'm' ? 100 : 1;
  return Number((dimensions[0] * dimensions[1] * dimensions[2] * multiplier ** 3).toFixed(2));
}

module.exports = {
  DEFAULT_ALIBABA_CONFIG,
  normalizeAlibabaConfig,
  getAlibabaConfig,
  updateAlibabaConfig,
  repriceAlibabaCatalog,
  selectAlibabaPriceTier,
  calculateAlibabaPrice,
  calculateAlibabaVolumeCm3,
};
