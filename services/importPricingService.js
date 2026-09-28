const ImportPricingConfig = require('../Models/ImportPricingConfig');
const { cloneImportPricingDefaults, hasLegacyTransitRates } = require('../config/importPricing');
const { mergeImportPricingConfig, calculateImportPricing, calculateImportQuote } = require('../utils/importPricing');

let cachedConfig = mergeImportPricingConfig();
let cacheLoadedAt = 0;
const CACHE_MS = 15_000;

function getImportPricingConfigSync() {
  return cachedConfig;
}

async function getImportPricingConfigDoc() {
  let doc = await ImportPricingConfig.findOne({ key: 'default' });
  if (!doc) {
    doc = await ImportPricingConfig.create({
      key: 'default',
      ...cloneImportPricingDefaults(),
    });
    return doc;
  }
  if (hasLegacyTransitRates(doc.toObject())) {
    const next = cloneImportPricingDefaults();
    doc.productMarkupMultiplier = doc.productMarkupMultiplier || next.productMarkupMultiplier;
    doc.shippingMarkup = next.shippingMarkup;
    doc.shippingRates = next.shippingRates;
    await doc.save();
  }
  return doc;
}

async function getImportPricingConfig() {
  if (Date.now() - cacheLoadedAt < CACHE_MS && cacheLoadedAt) {
    return cachedConfig;
  }
  const doc = await getImportPricingConfigDoc();
  cachedConfig = mergeImportPricingConfig(doc.toObject());
  cacheLoadedAt = Date.now();
  return cachedConfig;
}

async function updateImportPricingConfig(payload = {}) {
  const next = mergeImportPricingConfig(payload);
  const doc = await ImportPricingConfig.findOneAndUpdate(
    { key: 'default' },
    { $set: { ...next, key: 'default', updatedAt: new Date() } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  cachedConfig = mergeImportPricingConfig(doc.toObject());
  cacheLoadedAt = Date.now();
  return cachedConfig;
}

async function calculateImportPricingForProduct(product, options = {}) {
  const config = options.config || await getImportPricingConfig();
  return calculateImportPricing(product, { ...options, config });
}

async function calculateImportQuoteForProducts(lines, options = {}) {
  const config = options.config || await getImportPricingConfig();
  return calculateImportQuote(lines, config);
}

module.exports = {
  getImportPricingConfig,
  getImportPricingConfigSync,
  updateImportPricingConfig,
  calculateImportPricingForProduct,
  calculateImportQuoteForProducts,
};
