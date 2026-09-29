const slugify = require('slugify');
const { cjConfig } = require('../../config/cj');
const { calculateMargin, toNumber } = require('../../utils/dropshippingCalculations');
const { applyProductMarkup, inferShippingCategory, parseWeightToKg } = require('../../utils/importPricing');
const { DEFAULT_IMPORT_PRICING } = require('../../config/importPricing');
const {
  extractCjImages,
  pickCjTitle,
  pickCjDescription,
  pickCjCategory,
  buildCjSpecifications,
  convertUsdPriceToXof,
  normalizeCjImageUrl,
  isInvalidTranslationText,
} = require('../../utils/cjCatalogHelpers');
const { translateCatalogTextForImport } = require('./cjLocalization');
const { parseCjStockAndShippingOrigin } = require('./cjInventoryService');

function buildExternalSourceKey(externalProductId) {
  return `${cjConfig.platformKey}:${String(externalProductId).trim()}`;
}

async function mapCjVariants(variants = [], marginPercent = cjConfig.defaultMarginPercent, { skipTranslation = false } = {}) {
  const mapped = [];
  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index];
    const nameRaw = variant.variantNameEn || variant.variantKey || variant.variantSku || `Variante ${index + 1}`;
    const name = skipTranslation ? nameRaw : await translateCatalogTextForImport(nameRaw);
    const supplierUsd = toNumber(variant.variantSellPrice ?? variant.variantSugSellPrice);
    const priceXof = applyProductMarkup(
      convertUsdPriceToXof(supplierUsd),
      DEFAULT_IMPORT_PRICING.productMarkupMultiplier,
      DEFAULT_IMPORT_PRICING.minimumProductPrice,
    );
    const stock = toNumber(
      variant.variantInventory
      ?? variant.inventoryNum
      ?? variant.cjInventoryNum
      ?? variant.factoryInventory
      ?? variant.totalInventory
      ?? variant.stock,
      0,
    );
    mapped.push({
      name,
      sku: variant.variantSku || variant.vid || '',
      price: priceXof,
      stock,
      image: normalizeCjImageUrl(variant.variantImage || ''),
      attributes: {
        externalVariantId: variant.vid || variant.variantSku || '',
        variantKey: variant.variantKey || '',
        supplierPriceUsd: supplierUsd,
      },
      isDefault: index === 0,
    });
  }
  return mapped;
}

async function mapCJProductToDangoProduct(cjProduct, detail = null, inventoryPayload = null, { skipTranslation = false } = {}) {
  const externalProductId = String(cjProduct.externalProductId || cjProduct.id || detail?.pid || '').trim();
  const supplierPriceUsd = toNumber(
    cjProduct.supplierPrice ?? cjProduct.nowPrice ?? cjProduct.sellPrice ?? detail?.sellPrice,
  );
  const shippingCost = 0;
  const otherCosts = 0;
  const costPriceXof = convertUsdPriceToXof(supplierPriceUsd);
  const sellingPrice = applyProductMarkup(
    costPriceXof,
    DEFAULT_IMPORT_PRICING.productMarkupMultiplier,
    DEFAULT_IMPORT_PRICING.minimumProductPrice,
  );
  const margin = calculateMargin({
    sellingPrice,
    supplierPrice: costPriceXof,
    supplierShippingCost: shippingCost,
    otherCosts,
  });

  const detailVariants = detail?.variants || cjProduct.raw?.variants;
  const variants = Array.isArray(detailVariants) && detailVariants.length
    ? await mapCjVariants(detailVariants, cjConfig.defaultMarginPercent, { skipTranslation })
    : [];

  const stockFromVariants = variants.reduce((sum, v) => sum + toNumber(v.stock, 0), 0);
  const logistics = parseCjStockAndShippingOrigin({
    detail,
    listItem: cjProduct,
    inventoryPayload,
  });
  const stock = logistics.stock || stockFromVariants || toNumber(cjProduct.stock, 0);

  const images = extractCjImages(cjProduct, detail);
  const primaryImage = images[0]?.url || normalizeCjImageUrl(cjProduct.image) || '';

  const nameEn = pickCjTitle(cjProduct, detail);
  let name = nameEn;
  let description = pickCjDescription(cjProduct, detail);
  if (!skipTranslation) {
    name = await translateCatalogTextForImport(nameEn);
    if (!String(name || '').trim() || isInvalidTranslationText(name)) {
      name = nameEn;
    }
    description = await translateCatalogTextForImport(description);
    if (isInvalidTranslationText(description)) {
      description = pickCjDescription(cjProduct, detail);
    }
  }

  const slug = `${slugify(name, { lower: true, strict: true }).slice(0, 80)}-${externalProductId.slice(0, 8).toLowerCase()}`;
  let category = pickCjCategory(cjProduct, detail);
  let subCategory = cjProduct.subCategory || detail?.twoCategoryName || '';
  let specifications = buildCjSpecifications(detail);
  if (!skipTranslation) {
    category = await translateCatalogTextForImport(category);
    subCategory = await translateCatalogTextForImport(subCategory);
    specifications = await Promise.all(specifications.map(async (row) => ({
      ...row,
      value: await translateCatalogTextForImport(row.value),
    })));
  }
  const deliveryDays = parseDeliveryDays(cjProduct.shipping?.deliveryCycle || detail?.deliveryCycle);
  const weightKg = parseWeightToKg(detail?.productWeight ?? cjProduct.productWeight ?? cjProduct.weight);
  const weightRaw = weightKg > 0 ? String(weightKg) : '';
  const shippingCategory = inferShippingCategory({
    name,
    category,
    subCategory,
    weight: weightRaw,
    supplier: { platform: cjConfig.platformKey, supplierPrice: supplierPriceUsd, supplierCurrency: 'USD' },
    convertedSupplierPriceFCFA: costPriceXof,
    productMarkupMultiplier: DEFAULT_IMPORT_PRICING.productMarkupMultiplier,
  });

  return {
    source: cjConfig.platformKey,
    externalProductId,
    externalSourceKey: buildExternalSourceKey(externalProductId),
    name,
    slug,
    description,
    shortDescription: description.slice(0, 220),
    category,
    subCategory,
    weight: weightRaw,
    length: detail?.productLength != null ? String(detail.productLength) : '',
    width: detail?.productWidth != null ? String(detail.productWidth) : '',
    height: detail?.productHeight != null ? String(detail.productHeight) : '',
    images,
    image: primaryImage,
    variants,
    specifications,
    brand: detail?.supplierName || detail?.brandName || 'CJdropshipping',
    shippingInfo: 'Frais d\'importation calculés au checkout',
    convertedSupplierPriceFCFA: costPriceXof,
    productMarkupMultiplier: DEFAULT_IMPORT_PRICING.productMarkupMultiplier,
    minimumProductPrice: DEFAULT_IMPORT_PRICING.minimumProductPrice,
    minimumOrderQuantity: 1,
    quantityIncrement: 1,
    shippingCategory,
    estimatedImportDays: { min: 20, max: 30 },
    supplier: {
      name: logistics.manufacturerName || detail?.supplierName || cjConfig.supplierName,
      platform: cjConfig.platformKey,
      productId: externalProductId,
      productUrl: detail?.productUrl || '',
      supplierPrice: supplierPriceUsd,
      supplierCurrency: 'USD',
      shippingCost,
      estimatedDeliveryDays: deliveryDays,
      lastSyncedAt: new Date(),
      shipFromCountryCode: logistics.shipFromCountryCode,
      shipFromCountryName: logistics.shipFromCountryName,
      shipFromWarehouseName: logistics.shipFromWarehouseName,
      manufacturerName: logistics.manufacturerName,
      warehouseInventories: logistics.warehouseInventories,
      productNameEn: detail?.productNameEn || cjProduct.raw?.productNameEn || '',
      cjProductProps: Array.isArray(detail?.productProEnSet)
        ? detail.productProEnSet.map(String)
        : (detail?.productProEnSet ? [String(detail.productProEnSet)] : ['COMMON']),
      convertedSupplierPriceFCFA: costPriceXof,
    },
    pricing: {
      supplierPrice: supplierPriceUsd,
      sellingPrice,
      currency: 'XOF',
      marginPercent: margin.marginPercent,
      estimatedProfit: margin.estimatedProfit,
    },
    stock,
    status: stock > 0 ? 'active' : 'inactive',
    shipping: cjProduct.shipping || {},
    importedAt: new Date(),
    updatedAt: new Date(),
    syncStatus: 'success',
  };
}

function parseDeliveryDays(value) {
  if (!value) return 0;
  const match = String(value).match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function mapToDropshippingPayload(mapped, { publish = false } = {}) {
  return {
    name: mapped.name,
    slug: mapped.slug,
    description: mapped.description,
    shortDescription: mapped.shortDescription,
    category: mapped.category,
    subCategory: mapped.subCategory,
    price: mapped.pricing.sellingPrice,
    costPrice: convertUsdPriceToXof(mapped.supplier?.supplierPrice ?? mapped.pricing?.supplierPrice),
    stock: mapped.stock,
    weight: mapped.weight || '',
    length: mapped.length || '',
    width: mapped.width || '',
    height: mapped.height || '',
    image: mapped.image,
    images: mapped.images,
    variants: mapped.variants,
    specifications: mapped.specifications,
    brand: mapped.brand,
    shippingInfo: mapped.shippingInfo,
    importSourceType: 'CJ_API',
    isPublished: publish,
    isDropshippingActive: true,
    otherCosts: 0,
    estimatedProfit: mapped.pricing.estimatedProfit,
    marginPercent: mapped.pricing.marginPercent,
    convertedSupplierPriceFCFA: mapped.convertedSupplierPriceFCFA,
    productMarkupMultiplier: mapped.productMarkupMultiplier || DEFAULT_IMPORT_PRICING.productMarkupMultiplier,
    shippingCategory: mapped.shippingCategory || 'normal',
    estimatedImportDays: mapped.estimatedImportDays,
    supplier: mapped.supplier,
    externalSourceKey: mapped.externalSourceKey,
    syncStatus: mapped.syncStatus,
  };
}

module.exports = {
  buildExternalSourceKey,
  mapCJProductToDangoProduct,
  mapToDropshippingPayload,
  mapCjVariants,
};
