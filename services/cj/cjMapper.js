const slugify = require('slugify');
const { cjConfig } = require('../../config/cj');
const { calculateMargin, calculateSellingPrice, toNumber } = require('../../utils/dropshippingCalculations');

function buildExternalSourceKey(externalProductId) {
  return `${cjConfig.platformKey}:${String(externalProductId).trim()}`;
}

function mapCjVariants(variants = []) {
  return variants.map((variant, index) => {
    const name = variant.variantNameEn || variant.variantKey || variant.variantSku || `Variante ${index + 1}`;
    const price = toNumber(variant.variantSellPrice ?? variant.variantSugSellPrice);
    const stock = toNumber(variant.variantInventory ?? variant.inventoryNum ?? variant.stock, 0);
    return {
      name,
      sku: variant.variantSku || variant.vid || '',
      price,
      stock,
      image: variant.variantImage || '',
      attributes: {
        externalVariantId: variant.vid || variant.variantSku || '',
        variantKey: variant.variantKey || '',
      },
      isDefault: index === 0,
    };
  });
}

function mapCJProductToDangoProduct(cjProduct, detail = null) {
  const externalProductId = String(cjProduct.externalProductId || cjProduct.id || detail?.pid || '').trim();
  const supplierPrice = toNumber(
    cjProduct.supplierPrice ?? cjProduct.nowPrice ?? cjProduct.sellPrice ?? detail?.sellPrice,
  );
  const shippingCost = 0;
  const otherCosts = 0;
  const sellingPrice = calculateSellingPrice({
    supplierPrice,
    shippingCost,
    marginPercent: cjConfig.defaultMarginPercent,
    otherCosts,
  });
  const margin = calculateMargin({
    sellingPrice,
    supplierPrice,
    supplierShippingCost: shippingCost,
    otherCosts,
  });

  const detailVariants = detail?.variants || cjProduct.raw?.variants;
  const variants = Array.isArray(detailVariants) && detailVariants.length
    ? mapCjVariants(detailVariants)
    : [];

  const stockFromVariants = variants.reduce((sum, v) => sum + toNumber(v.stock, 0), 0);
  const stock = stockFromVariants || toNumber(cjProduct.stock, 0);

  const images = Array.isArray(cjProduct.images) && cjProduct.images.length
    ? cjProduct.images
    : (detail?.productImageSet || []).map((url, idx) => ({ url, isPrimary: idx === 0 }));

  const name = String(cjProduct.name || detail?.productNameEn || 'Produit CJ').trim();
  const slug = `${slugify(name, { lower: true, strict: true }).slice(0, 80)}-${externalProductId.slice(0, 8).toLowerCase()}`;

  return {
    source: cjConfig.platformKey,
    externalProductId,
    externalSourceKey: buildExternalSourceKey(externalProductId),
    name,
    slug,
    description: String(cjProduct.description || detail?.description || name).trim(),
    shortDescription: String(cjProduct.description || name).slice(0, 180),
    category: cjProduct.category || detail?.categoryName || 'Général',
    subCategory: cjProduct.subCategory || '',
    images,
    image: cjProduct.image || images[0]?.url || '',
    variants,
    supplier: {
      name: cjConfig.supplierName,
      platform: cjConfig.platformKey,
      productId: externalProductId,
      productUrl: detail?.productUrl || '',
      supplierPrice,
      supplierCurrency: 'USD',
      shippingCost,
      estimatedDeliveryDays: parseDeliveryDays(cjProduct.shipping?.deliveryCycle || detail?.deliveryCycle),
      lastSyncedAt: new Date(),
    },
    pricing: {
      supplierPrice,
      sellingPrice,
      currency: 'USD',
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
    costPrice: mapped.pricing.supplierPrice,
    stock: mapped.stock,
    image: mapped.image,
    images: mapped.images,
    variants: mapped.variants,
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
