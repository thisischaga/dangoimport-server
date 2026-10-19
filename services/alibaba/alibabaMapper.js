const slugify = require('slugify');
const { alibabaConfig, convertCnyToUsd } = require('../../config/alibaba');
const { calculateMargin, toNumber, applyProductMarkup } = require('../../utils/dropshippingCalculations');
const { DEFAULT_IMPORT_PRICING, inferShippingCategory, parseWeightToKg } = require('../../utils/importPricing');
const { convertUsdPriceToXof } = require('../../utils/cjCatalogHelpers');
const { extractImages } = require('./alibabaProductService');

function buildExternalSourceKey(externalProductId) {
  return `${alibabaConfig.platformKey}:${String(externalProductId).trim()}`;
}

function parseCnyPrice(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  const match = String(value).replace(',', '.').match(/(\d+(\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

function mapAlibabaVariants(skuInfos = []) {
  return (Array.isArray(skuInfos) ? skuInfos : []).map((sku, index) => {
    const priceCny = parseCnyPrice(sku.price || sku.consignPrice || sku.retailPrice);
    const supplierUsd = convertCnyToUsd(priceCny);
    const priceXof = applyProductMarkup(convertUsdPriceToXof(supplierUsd), DEFAULT_IMPORT_PRICING.productMarkupMultiplier);
    return {
      name: sku.skuName || sku.name || sku.attributes?.[0]?.attributeValue || `Variante ${index + 1}`,
      sku: String(sku.skuId || sku.specId || ''),
      price: priceXof,
      stock: toNumber(sku.amountOnSale ?? sku.canBookCount ?? sku.stock, 0),
      image: sku.skuImageUrl || sku.imageUrl || '',
      attributes: {
        externalVariantId: String(sku.skuId || sku.specId || ''),
        supplierPriceCny: priceCny,
        supplierPriceUsd: supplierUsd,
      },
      isDefault: index === 0,
    };
  });
}

function mapAlibabaProductToDango(listItem = {}, detail = null) {
  const source = detail || listItem;
  const externalProductId = String(source.externalProductId || source.offerId || listItem.externalProductId || '').trim();
  const priceCny = parseCnyPrice(source.supplierPrice ?? source.price ?? source.raw?.price);
  const supplierUsd = convertCnyToUsd(priceCny);
  const costPriceXof = convertUsdPriceToXof(supplierUsd);
  const sellingPrice = applyProductMarkup(costPriceXof, DEFAULT_IMPORT_PRICING.productMarkupMultiplier);
  const margin = calculateMargin({
    sellingPrice,
    supplierPrice: costPriceXof,
    supplierShippingCost: 0,
    otherCosts: 0,
  });
  const variants = mapAlibabaVariants(source.skuInfos || source.raw?.skuInfos);
  const stockFromVariants = variants.reduce((sum, v) => sum + toNumber(v.stock, 0), 0);
  const stock = stockFromVariants || toNumber(source.stock, alibabaConfig.defaultPublicStock);
  const images = extractImages(source.raw || source).length
    ? extractImages(source.raw || source)
    : (source.images || []).map((img) => (typeof img === 'string' ? { url: img } : img));
  const primaryImage = images[0]?.url || source.image || '';
  const name = String(source.name || source.subject || `Produit Alibaba ${externalProductId}`).trim();
  const description = String(source.description || name).replace(/<[^>]+>/g, ' ').slice(0, 4000).trim() || name;
  const weightKg = parseWeightToKg(source.weight || source.raw?.productShippingInfo?.weight);
  const weightRaw = weightKg > 0 ? String(weightKg) : '';
  const category = String(source.category || 'Général').trim() || 'Général';

  return {
    source: alibabaConfig.platformKey,
    externalProductId,
    externalSourceKey: buildExternalSourceKey(externalProductId),
    name,
    slug: `${slugify(name, { lower: true, strict: true }).slice(0, 80)}-${externalProductId.slice(0, 8)}`,
    description,
    shortDescription: description.slice(0, 220),
    category,
    subCategory: '',
    weight: weightRaw,
    images,
    image: primaryImage,
    variants,
    specifications: [],
    brand: source.raw?.sellerLoginId || alibabaConfig.supplierName,
    shippingInfo: 'Frais d\'importation calculés au checkout',
    convertedSupplierPriceFCFA: costPriceXof,
    productMarkupMultiplier: DEFAULT_IMPORT_PRICING.productMarkupMultiplier,
    minimumOrderQuantity: Math.max(1, toNumber(source.minOrderQuantity, 1)),
    quantityIncrement: 1,
    shippingCategory: inferShippingCategory({ name, category, weight: weightRaw }),
    estimatedImportDays: { min: 20, max: 30 },
    supplier: {
      name: source.raw?.sellerLoginId || alibabaConfig.supplierName,
      platform: alibabaConfig.platformKey,
      productId: externalProductId,
      productUrl: source.productUrl || `https://detail.1688.com/offer/${externalProductId}.html`,
      supplierPrice: supplierUsd,
      supplierCurrency: 'USD',
      shippingCost: 0,
      estimatedDeliveryDays: 25,
      lastSyncedAt: new Date(),
      convertedSupplierPriceFCFA: costPriceXof,
      alibabaPriceCny: priceCny,
    },
    pricing: {
      supplierPrice: supplierUsd,
      supplierPriceCny: priceCny,
      sellingPrice,
      currency: 'XOF',
      marginPercent: margin.marginPercent,
      estimatedProfit: margin.estimatedProfit,
    },
    stock,
    importSourceType: 'ALIBABA_API',
  };
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
    costPrice: mapped.convertedSupplierPriceFCFA,
    stock: mapped.stock,
    weight: mapped.weight || '',
    image: mapped.image,
    images: mapped.images,
    variants: mapped.variants,
    specifications: mapped.specifications,
    brand: mapped.brand,
    shippingInfo: mapped.shippingInfo,
    importSourceType: 'ALIBABA_API',
    isPublished: Boolean(publish) && Number(mapped?.pricing?.sellingPrice || 0) > 0,
    isDropshippingActive: true,
    otherCosts: 0,
    estimatedProfit: mapped.pricing.estimatedProfit,
    marginPercent: mapped.pricing.marginPercent,
    convertedSupplierPriceFCFA: mapped.convertedSupplierPriceFCFA,
    productMarkupMultiplier: mapped.productMarkupMultiplier,
    shippingCategory: mapped.shippingCategory || 'normal',
    estimatedImportDays: mapped.estimatedImportDays,
    minimumOrderQuantity: mapped.minimumOrderQuantity,
    quantityIncrement: mapped.quantityIncrement,
    supplier: mapped.supplier,
    externalSourceKey: mapped.externalSourceKey,
    syncStatus: 'success',
  };
}

module.exports = {
  buildExternalSourceKey,
  mapAlibabaProductToDango,
  mapToDropshippingPayload,
};
