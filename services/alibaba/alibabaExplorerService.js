const AlibabaProduct = require('../../Models/AlibabaProduct');
const { searchAlibabaProducts, getAlibabaProductDetail, getAlibabaRawProduct } = require('./alibabaProductService');
const { calculateImportPricing } = require('../../utils/importPricing');
const { calculateMargin, toNumber } = require('../../utils/dropshippingCalculations');
const { getAlibabaConfig, calculateAlibabaPrice } = require('./alibabaPricingService');
const { findExistingAlibabaProduct, upsertAlibabaProduct } = require('./alibabaImportService');
const {
  buildExternalSourceKey,
  mapAlibabaCategoryToDangoStore,
  extractPriceTiers,
  extractPackageDimensions,
  detectSuspiciousStock,
  detectMoqConflict,
  extractOriginAndPort,
  extractSupplyCapacity,
  extractBrand,
} = require('./alibabaMapper');

async function mapImportedStatus(ids = []) {
  const list = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
  if (!list.length) return {};

  const rows = await AlibabaProduct.find({
    source: 'ALIBABA',
    sourceProductId: { $in: list },
  }).select('_id sourceProductId name isPublished publishedProductId').lean();

  const map = {};
  rows.forEach((row) => {
    const pid = String(row.sourceProductId || '');
    if (!pid) return;
    map[pid] = {
      productId: row.publishedProductId ? String(row.publishedProductId) : String(row._id),
      name: row.name,
      isPublished: Boolean(row.isPublished),
      alibabaProductId: String(row._id),
      publishedProductId: row.publishedProductId ? String(row.publishedProductId) : null,
    };
  });
  return map;
}

// Convertit un montant vers USD selon sa devise (USD par défaut sur Alibaba.com).
async function toUsd(amount, currency) {
  const config = await getAlibabaConfig();
  const code = String(currency || config.sourceCurrency).toUpperCase();
  if (code === 'CNY') {
    return Number((toNumber(amount) / config.cnyToUsdRate).toFixed(4));
  }
  return toNumber(amount);
}

async function buildPricingPreview({
  supplierPrice,
  supplierPriceCny,
  supplierPriceUsd,
  currency,
  weight,
  name,
  category,
}) {
  const config = await getAlibabaConfig();
  const sourcePrice = supplierPriceCny != null
    ? toNumber(supplierPriceCny)
    : supplierPrice != null
      ? toNumber(supplierPrice)
      : toNumber(supplierPriceUsd);
  const sourceCurrency = supplierPriceCny != null ? 'CNY' : String(currency || config.sourceCurrency).toUpperCase();
  const unitPricing = calculateAlibabaPrice({
    sourcePrice,
    currency: sourceCurrency,
    category,
    config,
  });
  const convertedSupplierPriceFCFA = unitPricing.convertedSupplierPrice;
  const product = {
    name,
    category,
    weight,
    supplier: { supplierPrice: unitPricing.supplierPriceUsd, supplierCurrency: 'USD', convertedSupplierPriceFCFA },
    convertedSupplierPriceFCFA,
    productMarkupMultiplier: 1,
  };
  const shippingQuote = calculateImportPricing(product);
  const margin = calculateMargin({
    sellingPrice: unitPricing.salePrice,
    supplierPrice: convertedSupplierPriceFCFA,
    supplierShippingCost: 0,
    otherCosts: 0,
  });
  return {
    supplierPriceCny: sourceCurrency === 'CNY' ? sourcePrice : null,
    supplierPriceUsd: unitPricing.supplierPriceUsd,
    convertedSupplierPriceFCFA,
    exchangeRate: unitPricing.exchangeRate,
    marginPercent: unitPricing.marginPercent,
    marginSource: unitPricing.marginSource,
    additionalFeesXof: unitPricing.additionalFeesXof,
    sellingPriceXof: unitPricing.salePrice,
    packSize: shippingQuote.packSize,
    packPriceXof: unitPricing.salePrice * shippingQuote.packSize,
    minimumOrderQuantity: shippingQuote.minimumOrderQuantity,
    weightKg: shippingQuote.weight,
    shippingCategory: shippingQuote.shippingCategory,
    checkoutShippingXof: shippingQuote.shippingCost,
    estimatedDays: shippingQuote.estimatedDays,
    ratePerKg: shippingQuote.shipping?.ratePerKg,
    estimatedProfitXof: margin.estimatedProfit,
  };
}

async function searchAlibabaForAdmin(params = {}) {
  const result = await searchAlibabaProducts(params);
  const imported = await mapImportedStatus((result.products || []).map((p) => p.externalProductId));
  const products = await Promise.all((result.products || []).map(async ({ raw, skuInfos, ...p }) => ({
    ...p,
    supplierPriceUsd: await toUsd(p.supplierPrice, p.currency),
    stock: 0,
    stockKnown: false,
    sourceMinimumOrderQuantity: p.sourceMinimumOrderQuantity ?? null,
    imported: imported[p.externalProductId] || null,
  })));
  return {
    products,
    pagination: result.pagination,
  };
}

async function getAlibabaProductForAdmin(pid) {
  const detail = await getAlibabaProductDetail(pid);
  const existing = await findExistingAlibabaProduct(detail.externalProductId);
  const pricingConfig = await getAlibabaConfig();
  const currency = String(detail.currency || pricingConfig.sourceCurrency).toUpperCase();

  // Ne pas répartir le stock produit entre les SKU ni remplacer une valeur absente par un stock estimé.
  const skuList = detail.skuInfos || [];

  const variants = skuList.map((sku, index) => {
    const variantCurrency = String(sku.currency || currency).toUpperCase();
    const price = toNumber(sku.price || sku.consignPrice || sku.sale_price || sku.unit_price);
    return {
      externalVariantId: String(sku.skuId || sku.sku_id || sku.specId || index),
      name: sku.name || sku.skuName || sku.sku_name || `Variante ${index + 1}`,
      sku: sku.skuId || sku.sku_id || '',
      supplierPriceCny: variantCurrency === 'CNY' ? price : null,
      supplierPriceUsd: variantCurrency === 'CNY' ? Number((price / pricingConfig.cnyToUsdRate).toFixed(4)) : price,
      stock: 0,
      stockKnown: false,
      availability: 'UNKNOWN',
      status: sku.status || null,
      raw: sku,
      image: sku.skuImageUrl || sku.image || '',
    };
  });

  const category = mapAlibabaCategoryToDangoStore(detail.category, detail.name);
  const supplierPriceUsd = await toUsd(detail.supplierPrice, currency);
  const images = (detail.images && detail.images.length)
    ? detail.images
    : (detail.image ? [{ url: detail.image }] : []);

  const priceTiers = extractPriceTiers(detail);
  const dimensions = extractPackageDimensions(detail);
  const originInfo = extractOriginAndPort(detail);
  const supplyCapacity = extractSupplyCapacity(detail);
  const brand = extractBrand(detail);
  const declaredMoq = Math.max(1, toNumber(detail.minOrderQuantity || detail.wholesaleTrade?.min_order_quantity, 1));
  const moqConflict = detectMoqConflict(declaredMoq, priceTiers);
  const stockAnalysis = detectSuspiciousStock(detail.stock);

  const warnings = [];
  if (stockAnalysis.isSuspicious) {
    warnings.push({ code: 'SUSPICIOUS_STOCK_MAX_INT', message: stockAnalysis.reason, field: 'stock' });
  }
  if (moqConflict.hasConflict) {
    warnings.push({ code: 'MOQ_PRICE_TIER_CONFLICT', message: moqConflict.message, field: 'minimumOrderQuantity' });
  }

  let pricingPreview = null;
  try {
    pricingPreview = await buildPricingPreview({
      supplierPrice: detail.supplierPrice,
      supplierPriceCny: currency === 'CNY' ? detail.supplierPrice : undefined,
      supplierPriceUsd,
      currency,
      weight: detail.weight,
      name: detail.name,
      category,
    });
  } catch (error) {
    // L'aperçu prix ne doit jamais bloquer l'affichage du produit.
    console.warn('[alibaba] pricingPreview failed:', error.message);
  }

  return {
    externalProductId: detail.externalProductId,
    source: 'ALIBABA',
    name: detail.name,
    description: String(detail.description || '').replace(/\s+/g, ' ').trim().slice(0, 4000),
    category,
    image: detail.image || images[0]?.url || '',
    images,
    brand,
    supplierPrice: detail.supplierPrice,
    supplierPriceCny: currency === 'CNY' ? detail.supplierPrice : null,
    supplierPriceUsd,
    currency,
    // Alibaba products are made to order and do not use storefront stock.
    stock: 0,
    stockKnown: false,
    sourceInventory: {
      rawStock: detail.stock,
      verifiedStock: stockAnalysis.verifiedStock,
      isSuspicious: stockAnalysis.isSuspicious,
      unit: detail.unit || detail.wholesaleTrade?.unit_type || 'paire',
      supplyCapacity,
    },
    minOrderQuantity: declaredMoq,
    sourceMinimumOrderQuantity: detail.sourceMinimumOrderQuantity ?? null,
    sourcePriceTiers: priceTiers,
    dimensions,
    packageSize: dimensions.formatted || detail.packageSize || '',
    shippingOrigin: originInfo,
    supplyCapacity,
    weight: detail.weight != null ? String(detail.weight) : '',
    sku: detail.skuInfos?.[0]?.skuId || detail.skuInfos?.[0]?.sku_id || '',
    productUrl: detail.productUrl,
    variants,
    specifications: detail.specifications || [],
    warnings,
    rawAlibabaData: detail.raw || detail.rawAlibabaData || detail,
    imported: existing
      ? {
          productId: String(existing._id),
          isPublished: Boolean(existing.isPublished),
          name: existing.name,
          price: existing.price,
          importStatus: existing.importStatus || 'IMPORTED',
          lastSyncedAt: existing.lastSyncedAt,
        }
      : null,
    pricingPreview,
  };
}

async function getImportStatus(pid) {
  const existing = await AlibabaProduct.findOne({
    source: 'ALIBABA',
    $or: [
      { sourceProductId: pid },
      { externalProductId: pid },
      { 'supplier.productId': pid },
    ],
  }).select('_id sourceProductId externalProductId name isPublished publishedProductId').lean();

  if (!existing) {
    const fallback = await findExistingAlibabaProduct(pid);
    if (!fallback) return { imported: false };
    return {
      imported: true,
      productId: String(fallback._id),
      isPublished: Boolean(fallback.isPublished),
      name: fallback.name,
    };
  }

  return {
    imported: true,
    productId: existing.publishedProductId ? String(existing.publishedProductId) : String(existing._id),
    isPublished: Boolean(existing.isPublished),
    name: existing.name,
    alibabaProductId: String(existing._id),
    publishedProductId: existing.publishedProductId ? String(existing.publishedProductId) : null,
  };
}

async function importAlibabaProductForAdmin(pid, options = {}, adminUser) {
  return upsertAlibabaProduct(pid, { ...options, adminUser });
}

module.exports = {
  searchAlibabaForAdmin,
  getAlibabaProductForAdmin,
  getAlibabaRawProduct,
  getImportStatus,
  importAlibabaProductForAdmin,
  buildPricingPreview,
  buildExternalSourceKey,
};