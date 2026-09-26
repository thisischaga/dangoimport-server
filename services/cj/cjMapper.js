const slugify = require('slugify');
const { cjConfig } = require('../../config/cj');
const { calculateMargin, calculateSellingPrice, toNumber } = require('../../utils/dropshippingCalculations');
const {
  extractCjImages,
  pickCjTitle,
  pickCjDescription,
  pickCjCategory,
  buildCjSpecifications,
  convertUsdPriceToXof,
  normalizeCjImageUrl,
} = require('../../utils/cjCatalogHelpers');
const { maybeTranslateCatalogText } = require('./cjLocalization');

function buildExternalSourceKey(externalProductId) {
  return `${cjConfig.platformKey}:${String(externalProductId).trim()}`;
}

async function mapCjVariants(variants = [], marginPercent = cjConfig.defaultMarginPercent) {
  const mapped = [];
  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index];
    const nameRaw = variant.variantNameEn || variant.variantKey || variant.variantSku || `Variante ${index + 1}`;
    const name = await maybeTranslateCatalogText(nameRaw);
    const supplierUsd = toNumber(variant.variantSellPrice ?? variant.variantSugSellPrice);
    const priceXof = convertUsdPriceToXof(
      calculateSellingPrice({
        supplierPrice: supplierUsd,
        shippingCost: 0,
        marginPercent,
        otherCosts: 0,
      }),
    );
    const stock = toNumber(variant.variantInventory ?? variant.inventoryNum ?? variant.stock, 0);
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

async function mapCJProductToDangoProduct(cjProduct, detail = null) {
  const externalProductId = String(cjProduct.externalProductId || cjProduct.id || detail?.pid || '').trim();
  const supplierPriceUsd = toNumber(
    cjProduct.supplierPrice ?? cjProduct.nowPrice ?? cjProduct.sellPrice ?? detail?.sellPrice,
  );
  const shippingCost = 0;
  const otherCosts = 0;
  const sellingPriceUsd = calculateSellingPrice({
    supplierPrice: supplierPriceUsd,
    shippingCost,
    marginPercent: cjConfig.defaultMarginPercent,
    otherCosts,
  });
  const sellingPrice = convertUsdPriceToXof(sellingPriceUsd);
  const costPriceXof = convertUsdPriceToXof(supplierPriceUsd);
  const margin = calculateMargin({
    sellingPrice,
    supplierPrice: costPriceXof,
    supplierShippingCost: shippingCost,
    otherCosts,
  });

  const detailVariants = detail?.variants || cjProduct.raw?.variants;
  const variants = Array.isArray(detailVariants) && detailVariants.length
    ? await mapCjVariants(detailVariants)
    : [];

  const stockFromVariants = variants.reduce((sum, v) => sum + toNumber(v.stock, 0), 0);
  const stock = stockFromVariants || toNumber(cjProduct.stock, 0);

  const images = extractCjImages(cjProduct, detail);
  const primaryImage = images[0]?.url || normalizeCjImageUrl(cjProduct.image) || '';

  let name = pickCjTitle(cjProduct, detail);
  let description = pickCjDescription(cjProduct, detail);
  name = await maybeTranslateCatalogText(name);
  description = await maybeTranslateCatalogText(description);

  const slug = `${slugify(name, { lower: true, strict: true }).slice(0, 80)}-${externalProductId.slice(0, 8).toLowerCase()}`;
  const category = pickCjCategory(cjProduct, detail);
  const specifications = buildCjSpecifications(detail);
  const deliveryDays = parseDeliveryDays(cjProduct.shipping?.deliveryCycle || detail?.deliveryCycle);

  return {
    source: cjConfig.platformKey,
    externalProductId,
    externalSourceKey: buildExternalSourceKey(externalProductId),
    name,
    slug,
    description,
    shortDescription: description.slice(0, 220),
    category,
    subCategory: cjProduct.subCategory || detail?.twoCategoryName || '',
    images,
    image: primaryImage,
    variants,
    specifications,
    brand: detail?.supplierName || detail?.brandName || 'CJdropshipping',
    shippingInfo: deliveryDays
      ? `Expédition dropshipping estimée : ${deliveryDays} jour(s) ouvrés`
      : 'Expédition dropshipping internationale',
    supplier: {
      name: cjConfig.supplierName,
      platform: cjConfig.platformKey,
      productId: externalProductId,
      productUrl: detail?.productUrl || '',
      supplierPrice: supplierPriceUsd,
      supplierCurrency: 'USD',
      shippingCost,
      estimatedDeliveryDays: deliveryDays,
      lastSyncedAt: new Date(),
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
    image: mapped.image,
    images: mapped.images,
    variants: mapped.variants,
    specifications: mapped.specifications,
    brand: mapped.brand,
    shippingInfo: mapped.shippingInfo,
    importSourceType: 'CJ_API',
    isPublished: publish,
    isDropshippingActive: mapped.stock > 0,
    otherCosts: 0,
    estimatedProfit: mapped.pricing.estimatedProfit,
    marginPercent: mapped.pricing.marginPercent,
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
