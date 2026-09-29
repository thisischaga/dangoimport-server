const Product = require('../../Models/Product');
const { cjConfig } = require('../../config/cj');
const { getCJProducts, getCJProductDetail, getCJCategories } = require('./cjProductService');
const { findExistingCjProduct, upsertCJProductFromListItem } = require('./cjImportService');
const { buildExternalSourceKey } = require('./cjMapper');
const { getCJInventoryByPid, parseCjStockAndShippingOrigin } = require('./cjInventoryService');
const {
  extractCjImages,
  pickCjTitle,
  pickCjDescription,
  pickCjCategory,
  convertUsdPriceToXof,
  normalizeCjImageUrl,
} = require('../../utils/cjCatalogHelpers');
const { applyProductMarkup, calculateMargin, toNumber } = require('../../utils/dropshippingCalculations');
const { calculateImportPricing } = require('../../utils/importPricing');
const { DEFAULT_IMPORT_PRICING } = require('../../config/importPricing');

const SEARCH_CACHE_TTL_MS = Math.max(15_000, Number(process.env.CJ_SEARCH_CACHE_TTL_MS) || 45_000);
const searchCache = new Map();

function searchCacheKey(params) {
  return JSON.stringify(params);
}

function getCachedSearch(key) {
  const hit = searchCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    searchCache.delete(key);
    return null;
  }
  return hit.value;
}

function setCachedSearch(key, value) {
  searchCache.set(key, { value, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
  if (searchCache.size > 80) {
    const first = searchCache.keys().next().value;
    searchCache.delete(first);
  }
}

function userFacingCjError(error) {
  const msg = 'Impossible de récupérer les produits CJ pour le moment. Veuillez réessayer.';
  const err = new Error(msg);
  err.status = error.status || 502;
  err.cause = error;
  return err;
}

async function mapImportedStatus(pids = []) {
  const ids = [...new Set(pids.map((p) => String(p).trim()).filter(Boolean))];
  if (!ids.length) return {};

  const rows = await Product.find({
    sourceType: 'DROPSHIPPING',
    'supplier.platform': cjConfig.platformKey,
    'supplier.productId': { $in: ids },
  })
    .select('_id name isPublished supplier.productId slug')
    .lean();

  const map = {};
  rows.forEach((row) => {
    const pid = String(row.supplier?.productId || '').trim();
    if (pid) {
      map[pid] = {
        productId: String(row._id),
        name: row.name,
        isPublished: Boolean(row.isPublished),
        slug: row.slug,
      };
    }
  });
  return map;
}

async function searchCJProducts(params = {}) {
  const normalized = {
    page: Math.max(1, toNumber(params.page, 1)),
    size: Math.min(100, Math.max(1, toNumber(params.size, 20))),
    keyword: params.keyword ? String(params.keyword).trim() : undefined,
    categoryId: params.categoryId ? String(params.categoryId).trim() : undefined,
    minPrice: params.minPrice != null && params.minPrice !== '' ? toNumber(params.minPrice) : undefined,
    maxPrice: params.maxPrice != null && params.maxPrice !== '' ? toNumber(params.maxPrice) : undefined,
    country: params.country ? String(params.country).trim() : undefined,
    sort: params.sort ? String(params.sort).trim() : undefined,
    orderBy: params.orderBy != null ? params.orderBy : undefined,
  };

  const cacheKey = searchCacheKey(normalized);
  const cached = getCachedSearch(cacheKey);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  try {
    const result = await getCJProducts(normalized);
    const pids = (result.products || []).map((p) => p.externalProductId);
    let imported = {};
    try {
      imported = await mapImportedStatus(pids);
    } catch (mapErr) {
      console.error('[cjExplorer] mapImportedStatus:', mapErr.message);
    }
    const payload = {
      products: (result.products || []).map((p) => ({
        ...p,
        imported: imported[p.externalProductId] || null,
      })),
      pagination: result.pagination,
    };
    if ((payload.products || []).length > 0) {
      setCachedSearch(cacheKey, payload);
    }
    return payload;
  } catch (error) {
    throw userFacingCjError(error);
  }
}

function parseVariantOptions(variants = []) {
  const groups = new Map();
  variants.forEach((variant) => {
    const vid = String(variant.vid || variant.variantSku || '').trim();
    const label = variant.variantNameEn || variant.variantKey || vid || 'Variante';
    const parts = String(variant.variantKey || label)
      .split(/[,;/|]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length <= 1) {
      const key = 'Option';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ id: vid, label, stock: toNumber(variant.variantInventory ?? variant.inventoryNum, 0) });
      return;
    }
    parts.forEach((part, index) => {
      const key = index === 0 ? 'Couleur' : index === 1 ? 'Taille' : `Option ${index + 1}`;
      if (!groups.has(key)) groups.set(key, []);
      const list = groups.get(key);
      if (!list.some((e) => e.label === part)) {
        list.push({ id: `${vid}:${part}`, label: part, variantId: vid });
      }
    });
  });
  return [...groups.entries()].map(([name, options]) => ({ name, options }));
}

function formatAdminProductDetail(pid, listItem, detail, inventoryPayload) {
  const logistics = parseCjStockAndShippingOrigin({ detail, listItem, inventoryPayload });
  const variantsRaw = Array.isArray(detail?.variants) ? detail.variants : [];
  const variants = variantsRaw.map((v, index) => ({
    externalVariantId: String(v.vid || v.variantSku || '').trim(),
    sku: v.variantSku || '',
    name: v.variantNameEn || v.variantKey || `Variante ${index + 1}`,
    variantKey: v.variantKey || '',
    supplierPriceUsd: toNumber(v.variantSellPrice ?? v.variantSugSellPrice),
    stock: toNumber(
      v.variantInventory ?? v.inventoryNum ?? v.cjInventoryNum ?? v.factoryInventory ?? v.totalInventory,
      0,
    ),
    image: normalizeCjImageUrl(v.variantImage || ''),
  }));

  const supplierPriceUsd = toNumber(
    listItem?.supplierPrice ?? detail?.sellPrice ?? detail?.nowPrice,
  );

  return {
    externalProductId: String(pid),
    source: cjConfig.platformKey,
    name: pickCjTitle(listItem || {}, detail),
    description: pickCjDescription(listItem || {}, detail),
    category: pickCjCategory(listItem || {}, detail),
    images: extractCjImages(listItem || {}, detail),
    supplierPriceUsd,
    currency: 'USD',
    stock: logistics.stock || variants.reduce((s, v) => s + v.stock, 0) || toNumber(listItem?.stock, 0),
    weight: detail?.productWeight != null ? String(detail.productWeight) : '',
    length: detail?.productLength != null ? String(detail.productLength) : '',
    width: detail?.productWidth != null ? String(detail.productWidth) : '',
    height: detail?.productHeight != null ? String(detail.productHeight) : '',
    sku: detail?.productSku || listItem?.sku || '',
    shipping: {
      deliveryCycle: detail?.deliveryCycle || listItem?.shipping?.deliveryCycle || '',
      shipFromCountryCode: logistics.shipFromCountryCode,
      shipFromCountryName: logistics.shipFromCountryName,
      shipFromWarehouseName: logistics.shipFromWarehouseName,
    },
    variants,
    variantOptionGroups: parseVariantOptions(variantsRaw),
    productUrl: detail?.productUrl || '',
    specifications: detail?.productProEnSet || [],
  };
}

async function getCJProductForAdmin(pid, { countryCode } = {}) {
  const id = String(pid || '').trim();
  if (!id) {
    const err = new Error('Identifiant produit CJ requis.');
    err.status = 400;
    throw err;
  }

  try {
    const [detail, inventory] = await Promise.all([
      getCJProductDetail(id, { countryCode }),
      getCJInventoryByPid(id).catch(() => null),
    ]);
    const listItem = { externalProductId: id, raw: detail };
    const formatted = formatAdminProductDetail(id, listItem, detail, inventory);
    const imported = await findExistingCjProduct(id, buildExternalSourceKey(id));
    formatted.imported = imported
      ? {
          productId: String(imported._id),
          isPublished: Boolean(imported.isPublished),
          name: imported.name,
        }
      : null;
    formatted.pricingPreview = buildPricingPreview({
      supplierPriceUsd: formatted.supplierPriceUsd,
      weight: formatted.weight || formatted.productWeight,
      name: formatted.name,
      category: formatted.category,
    });
    return formatted;
  } catch (error) {
    throw userFacingCjError(error);
  }
}

function buildPricingPreview({
  supplierPriceUsd,
  weight,
  name,
  category,
}) {
  const supplierUsd = toNumber(supplierPriceUsd);
  const convertedSupplierPriceFCFA = convertUsdPriceToXof(supplierUsd);
  const product = {
    name,
    category,
    weight,
    supplier: {
      supplierPrice: supplierUsd,
      supplierCurrency: 'USD',
      convertedSupplierPriceFCFA,
    },
    convertedSupplierPriceFCFA,
    productMarkupMultiplier: DEFAULT_IMPORT_PRICING.productMarkupMultiplier,
  };
  const pricing = calculateImportPricing(product);
  const margin = calculateMargin({
    sellingPrice: pricing.productPrice,
    supplierPrice: convertedSupplierPriceFCFA,
    supplierShippingCost: 0,
    otherCosts: 0,
  });
  return {
    supplierPriceUsd: supplierUsd,
    convertedSupplierPriceFCFA,
    productMarkupMultiplier: pricing.productMarkupMultiplier,
    sellingPriceXof: pricing.unitPrice,
    packPriceXof: pricing.packPrice,
    packSize: pricing.packSize,
    minimumOrderQuantity: pricing.minimumOrderQuantity,
    costPriceXof: convertedSupplierPriceFCFA,
    estimatedProfitXof: margin.estimatedProfit,
    shippingCategory: pricing.shippingCategory,
    weightKg: pricing.weight,
    checkoutShippingXof: pricing.shippingCost,
    checkoutTotalXof: pricing.total,
    estimatedDays: pricing.estimatedDays,
    ratePerKg: pricing.shipping.ratePerKg,
    shippingMarkup: 0,
  };
}

async function getImportStatus(pid) {
  const id = String(pid || '').trim();
  const existing = await findExistingCjProduct(id, buildExternalSourceKey(id));
  if (!existing) {
    return { imported: false };
  }
  return {
    imported: true,
    productId: String(existing._id),
    isPublished: Boolean(existing.isPublished),
    name: existing.name,
  };
}

async function importCJProductForAdmin(pid, options = {}, adminUser) {
  const id = String(pid || '').trim();
  if (!id) {
    const err = new Error('Identifiant produit CJ requis.');
    err.status = 400;
    throw err;
  }

  const existing = await findExistingCjProduct(id, buildExternalSourceKey(id));
  const forceUpdate = options.update === true;

  if (existing && !forceUpdate) {
    return {
      alreadyImported: true,
      action: 'exists',
      product: existing.toObject ? existing.toObject() : existing,
    };
  }

  const listItem = { externalProductId: id };
  const upsert = await upsertCJProductFromListItem(listItem, {
    fetchDetail: true,
    publish: options.publish === true,
    adminUser,
    selectedVariantIds: options.variantIds,
  });

  return {
    alreadyImported: false,
    action: upsert.action,
    product: upsert.product,
  };
}

module.exports = {
  searchCJProducts,
  getCJProductForAdmin,
  getImportStatus,
  importCJProductForAdmin,
  buildPricingPreview,
  mapImportedStatus,
};
