const Product = require('../../Models/Product');
const { alibabaConfig, convertCnyToUsd } = require('../../config/alibaba');
const { searchAlibabaProducts, getAlibabaProductDetail } = require('./alibabaProductService');
const { calculateImportPricing } = require('../../utils/importPricing');
const { calculateMargin, toNumber } = require('../../utils/dropshippingCalculations');
const { DEFAULT_IMPORT_PRICING } = require('../../config/importPricing');
const { findExistingAlibabaProduct, upsertAlibabaProduct } = require('./alibabaImportService');
const { buildExternalSourceKey, mapAlibabaCategoryToDangoStore, convertUsdPriceToXof } = require('./alibabaMapper');

async function mapImportedStatus(ids = []) {
  const list = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
  if (!list.length) return {};
  const rows = await Product.find({
    sourceType: 'DROPSHIPPING',
    'supplier.platform': alibabaConfig.platformKey,
    'supplier.productId': { $in: list },
  }).select('_id name isPublished supplier.productId').lean();
  const map = {};
  rows.forEach((row) => {
    const pid = String(row.supplier?.productId || '');
    if (pid) map[pid] = { productId: String(row._id), name: row.name, isPublished: Boolean(row.isPublished) };
  });
  return map;
}

// Convertit un montant vers USD selon sa devise (USD par défaut sur Alibaba.com).
function toUsd(amount, currency) {
  const code = String(currency || 'USD').toUpperCase();
  if (code === 'CNY') return convertCnyToUsd(amount);
  return toNumber(amount);
}

function buildPricingPreview({ supplierPriceCny, supplierPriceUsd, weight, name, category }) {
  const usd = supplierPriceUsd != null
    ? toNumber(supplierPriceUsd)
    : convertCnyToUsd(supplierPriceCny);
  const convertedSupplierPriceFCFA = convertUsdPriceToXof(usd);
  const product = {
    name,
    category,
    weight,
    supplier: { supplierPrice: usd, supplierCurrency: 'USD', convertedSupplierPriceFCFA },
    convertedSupplierPriceFCFA,
    productMarkupMultiplier: DEFAULT_IMPORT_PRICING.productMarkupMultiplier,
  };
  const pricing = calculateImportPricing(product);
  const margin = calculateMargin({
    sellingPrice: pricing.productPrice || pricing.unitPrice,
    supplierPrice: convertedSupplierPriceFCFA,
    supplierShippingCost: 0,
    otherCosts: 0,
  });
  return {
    supplierPriceCny: toNumber(supplierPriceCny),
    supplierPriceUsd: usd,
    convertedSupplierPriceFCFA,
    productMarkupMultiplier: pricing.productMarkupMultiplier,
    sellingPriceXof: pricing.unitPrice,
    packSize: pricing.packSize,
    packPriceXof: pricing.packPrice,
    minimumOrderQuantity: pricing.minimumOrderQuantity,
    weightKg: pricing.weight,
    shippingCategory: pricing.shippingCategory,
    checkoutShippingXof: pricing.shippingCost,
    estimatedDays: pricing.estimatedDays,
    ratePerKg: pricing.shipping?.ratePerKg,
    estimatedProfitXof: margin.estimatedProfit,
  };
}

async function searchAlibabaForAdmin(params = {}) {
  const result = await searchAlibabaProducts(params);
  const imported = await mapImportedStatus((result.products || []).map((p) => p.externalProductId));
  return {
    products: (result.products || []).map(({ raw, skuInfos, ...p }) => ({
      ...p,
      supplierPriceUsd: toUsd(p.supplierPrice, p.currency),
      // Si l'API search ne renvoie pas de stock unitaire explicite, laisser null (affiché 'Sur commande')
      stock: (p.stock && p.stock > 0) ? p.stock : null,
      imported: imported[p.externalProductId] || null,
    })),
    pagination: result.pagination,
  };
}

async function getAlibabaProductForAdmin(pid) {
  const detail = await getAlibabaProductDetail(pid);
  const existing = await findExistingAlibabaProduct(detail.externalProductId);
  const currency = String(detail.currency || 'USD').toUpperCase();

  const totalStock = detail.stock || alibabaConfig.defaultPublicStock;
  const skuList = detail.skuInfos || [];
  const hasPerSkuStock = skuList.some((s) => toNumber(s.stock, 0) > 0 && s.stock !== alibabaConfig.defaultPublicStock);
  const perVariantStock = Math.max(1, Math.floor(totalStock / (skuList.length || 1)));

  const variants = skuList.map((sku, index) => {
    const variantCurrency = String(sku.currency || currency).toUpperCase();
    const price = toNumber(sku.price || sku.consignPrice || sku.sale_price || sku.unit_price);
    const rawStock = toNumber(sku.stock ?? sku.amountOnSale ?? sku.canBookCount, 0);
    const variantStock = hasPerSkuStock ? (rawStock > 0 ? rawStock : perVariantStock) : perVariantStock;
    return {
      externalVariantId: String(sku.skuId || sku.sku_id || sku.specId || index),
      name: sku.name || sku.skuName || sku.sku_name || `Variante ${index + 1}`,
      sku: sku.skuId || sku.sku_id || '',
      supplierPriceCny: variantCurrency === 'CNY' ? price : null,
      supplierPriceUsd: toUsd(price, variantCurrency),
      stock: variantStock,
      image: sku.skuImageUrl || sku.image || '',
    };
  });

  const category = mapAlibabaCategoryToDangoStore(detail.category, detail.name);
  const supplierPriceUsd = toUsd(detail.supplierPrice, currency);
  const images = (detail.images && detail.images.length)
    ? detail.images
    : (detail.image ? [{ url: detail.image }] : []);

  let pricingPreview = null;
  try {
    pricingPreview = buildPricingPreview({
      supplierPriceCny: currency === 'CNY' ? detail.supplierPrice : undefined,
      supplierPriceUsd,
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
    source: alibabaConfig.platformKey,
    name: detail.name,
    description: String(detail.description || '').replace(/\s+/g, ' ').trim().slice(0, 4000),
    category,
    image: detail.image || images[0]?.url || '',
    images,
    supplierPrice: detail.supplierPrice,
    supplierPriceCny: currency === 'CNY' ? detail.supplierPrice : null,
    supplierPriceUsd,
    currency,
    stock: detail.stock || alibabaConfig.defaultPublicStock,
    minOrderQuantity: detail.minOrderQuantity,
    weight: detail.weight != null ? String(detail.weight) : '',
    sku: detail.skuInfos?.[0]?.skuId || detail.skuInfos?.[0]?.sku_id || '',
    productUrl: detail.productUrl,
    variants,
    specifications: detail.specifications || [],
    imported: existing
      ? { productId: String(existing._id), isPublished: Boolean(existing.isPublished), name: existing.name }
      : null,
    pricingPreview,
  };
}

async function getImportStatus(pid) {
  const existing = await findExistingAlibabaProduct(pid);
  if (!existing) return { imported: false };
  return {
    imported: true,
    productId: String(existing._id),
    isPublished: Boolean(existing.isPublished),
    name: existing.name,
  };
}

async function importAlibabaProductForAdmin(pid, options = {}, adminUser) {
  return upsertAlibabaProduct(pid, { ...options, adminUser });
}

module.exports = {
  searchAlibabaForAdmin,
  getAlibabaProductForAdmin,
  getImportStatus,
  importAlibabaProductForAdmin,
  buildPricingPreview,
  buildExternalSourceKey,
};