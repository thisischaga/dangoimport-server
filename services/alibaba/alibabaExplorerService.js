const Product = require('../../Models/Product');
const { alibabaConfig, convertCnyToUsd } = require('../../config/alibaba');
const { searchAlibabaProducts, getAlibabaProductDetail } = require('./alibabaProductService');
const { calculateImportPricing } = require('../../utils/importPricing');
const { calculateMargin, toNumber } = require('../../utils/dropshippingCalculations');
const { convertUsdPriceToXof } = require('../../utils/cjCatalogHelpers');
const { DEFAULT_IMPORT_PRICING } = require('../../config/importPricing');
const { findExistingAlibabaProduct, upsertAlibabaProduct } = require('./alibabaImportService');
const { buildExternalSourceKey } = require('./alibabaMapper');

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
    products: (result.products || []).map((p) => ({
      ...p,
      supplierPriceUsd: convertCnyToUsd(p.supplierPrice),
      imported: imported[p.externalProductId] || null,
    })),
    pagination: result.pagination,
  };
}

async function getAlibabaProductForAdmin(pid) {
  const detail = await getAlibabaProductDetail(pid);
  const existing = await findExistingAlibabaProduct(detail.externalProductId);
  const variants = (detail.skuInfos || []).map((sku, index) => {
    const priceCny = toNumber(sku.price || sku.consignPrice);
    return {
      externalVariantId: String(sku.skuId || sku.specId || index),
      name: sku.skuName || sku.name || `Variante ${index + 1}`,
      sku: sku.skuId || '',
      supplierPriceCny: priceCny,
      supplierPriceUsd: convertCnyToUsd(priceCny),
      stock: toNumber(sku.amountOnSale ?? sku.canBookCount, 0),
      image: sku.skuImageUrl || '',
    };
  });
  return {
    externalProductId: detail.externalProductId,
    source: alibabaConfig.platformKey,
    name: detail.name,
    description: String(detail.description || '').replace(/<[^>]+>/g, ' ').slice(0, 4000),
    category: detail.category,
    images: detail.images,
    supplierPriceCny: detail.supplierPrice,
    supplierPriceUsd: convertCnyToUsd(detail.supplierPrice),
    currency: 'CNY',
    stock: detail.stock,
    weight: detail.weight != null ? String(detail.weight) : '',
    sku: detail.raw?.productSkuInfos?.[0]?.skuId || '',
    productUrl: detail.productUrl,
    variants,
    imported: existing
      ? { productId: String(existing._id), isPublished: Boolean(existing.isPublished), name: existing.name }
      : null,
    pricingPreview: buildPricingPreview({
      supplierPriceCny: detail.supplierPrice,
      weight: detail.weight,
      name: detail.name,
      category: detail.category,
    }),
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
