const slugify = require('slugify');
const { alibabaConfig, convertCnyToUsd } = require('../../config/alibaba');
const { calculateMargin, toNumber, applyProductMarkup } = require('../../utils/dropshippingCalculations');
const { DEFAULT_IMPORT_PRICING } = require('../../config/importPricing');
const { inferShippingCategory, parseWeightToKg } = require('../../utils/importPricing');
const { convertUsdPriceToXof, isInvalidTranslationText, mapCjCategoryToDangoStore } = require('../../utils/cjCatalogHelpers');
const { translateCatalogTextForImport } = require('../cj/cjLocalization');
const { extractImages, extractAlibabaSpecifications } = require('./alibabaProductService');

const ATTR_TRANSLATIONS = {
  color: 'Couleur',
  colour: 'Couleur',
  capacity: 'Capacité',
  volume: 'Volume',
  material: 'Matériau',
  materials: 'Matériaux',
  size: 'Taille',
  dimensions: 'Dimensions',
  dimension: 'Dimensions',
  weight: 'Poids',
  brand: 'Marque',
  brand_name: 'Marque',
  model: 'Modèle',
  model_number: 'Numéro de modèle',
  feature: 'Fonctionnalité',
  features: 'Fonctionnalités',
  function: 'Fonction',
  certification: 'Certification',
  certifications: 'Certifications',
  origin: 'Origine',
  place_of_origin: "Lieu d'origine",
  package: 'Emballage',
  packaging: 'Emballage',
  warranty: 'Garantie',
  gender: 'Genre',
  style: 'Style',
  type: 'Type',
  usage: 'Utilisation',
  application: 'Application',
  pattern: 'Motif',
  season: 'Saison',
  shape: 'Forme',
  drinkware_type: 'Type de récipient',
  plastic_type: 'Type de plastique',
  thermal_insulation_performance: 'Isolation thermique',
  water_flowing_method: "Mode d'écoulement",
  boiling_water: 'Eau bouillante',
  anti_corrosion_coating: 'Revêtement anti-corrosion',
  outdoor_activity: 'Activité de plein air',
};

function buildExternalSourceKey(externalProductId) {
  return `${alibabaConfig.platformKey}:${String(externalProductId).trim()}`;
}

function parseCnyPrice(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  const match = String(value).replace(',', '.').match(/(\d+(\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

async function mapAlibabaVariants(skuInfos = [], { skipTranslation = false } = {}) {
  const list = Array.isArray(skuInfos) ? skuInfos : [];
  const results = [];
  for (let index = 0; index < list.length; index++) {
    const sku = list[index];
    // Ladder price : prendre le min (premier palier quantité 1)
    const ladderPriceArr = Array.isArray(sku.ladder_price) ? sku.ladder_price : [];
    const ladderMinPrice = ladderPriceArr.length
      ? Math.min(...ladderPriceArr.map((t) => Number(t.price) || 0).filter((p) => p > 0))
      : 0;
    const ladderCurrency = ladderPriceArr[0]?.currency || 'USD';
    // Prix brut : ladder_price > price direct
    const rawPriceValue = Number(sku.price || sku.consignPrice || sku.retailPrice || sku.unit_price || 0) || ladderMinPrice;
    const rawCurrency = sku.currency || ladderCurrency;
    const supplierUsd = String(rawCurrency).toUpperCase() === 'CNY'
      ? convertCnyToUsd(rawPriceValue)
      : rawPriceValue;
    const priceXof = applyProductMarkup(convertUsdPriceToXof(supplierUsd), DEFAULT_IMPORT_PRICING.productMarkupMultiplier);
    // Nom : depuis sku_attr_list (format Alibaba description API)
    let skuName = sku.name || sku.skuName || sku.attributes?.[0]?.attributeValue || '';
    if (!skuName && Array.isArray(sku.sku_attr_list) && sku.sku_attr_list.length) {
      skuName = sku.sku_attr_list
        .map((a) => `${a.attr_name_desc || ''}: ${a.attr_value_desc || ''}`.trim())
        .filter(Boolean).join(' / ');
    }
    if (!skuName) skuName = `Variante ${index + 1}`;
    if (!skipTranslation && skuName) {
      try {
        const translated = await translateCatalogTextForImport(skuName);
        if (translated && !isInvalidTranslationText(translated)) {
          skuName = translated;
        }
      } catch (_e) { /* fallback original */ }
    }

    const rawStock = toNumber(sku.amountOnSale ?? sku.canBookCount ?? sku.stock ?? sku.inventory ?? sku.quantity, 0);
    const stock = rawStock > 0 ? rawStock : (alibabaConfig.defaultPublicStock || 50);

    results.push({
      name: skuName,
      sku: String(sku.skuId || sku.sku_id || sku.specId || ''),
      price: priceXof,
      stock,
      image: sku.skuImageUrl || sku.imageUrl || sku.image || '',
      attributes: {
        externalVariantId: String(sku.skuId || sku.sku_id || sku.specId || ''),
        supplierPriceCny: String(rawCurrency).toUpperCase() === 'CNY' ? rawPriceValue : 0,
        supplierPriceUsd: supplierUsd,
      },
      isDefault: index === 0,
    });
  }
  return results;
}

async function mapAlibabaProductToDango(listItem = {}, detail = null, { skipTranslation = false } = {}) {
  const source = detail || listItem;
  const externalProductId = String(source.externalProductId || source.offerId || listItem.externalProductId || '').trim();
  const rawCurrency = String(source.currency || source.raw?.price?.currency || source.raw?.currency || 'USD').toUpperCase();
  const rawPrice = parseCnyPrice(source.supplierPrice ?? source.price ?? source.raw?.price?.amount ?? source.raw?.price);
  // Si prix toujours 0, tenter le min des skuInfos (ladder_price)
  const skuLadderMin = (() => {
    const skus = source.skuInfos || source.raw?.skuInfos || [];
    const prices = (Array.isArray(skus) ? skus : []).flatMap((sku) => {
      if (Array.isArray(sku.ladder_price)) return sku.ladder_price.map((t) => Number(t.price) || 0);
      return [Number(sku.price || sku.consignPrice || sku.retailPrice || sku.unit_price) || 0];
    }).filter((p) => p > 0);
    return prices.length ? Math.min(...prices) : 0;
  })();
  const effectiveRawPrice = rawPrice || skuLadderMin;
  const supplierUsd = rawCurrency === 'CNY' ? convertCnyToUsd(effectiveRawPrice) : effectiveRawPrice;
  const priceCny = rawCurrency === 'CNY' ? effectiveRawPrice : 0;
  const costPriceXof = convertUsdPriceToXof(supplierUsd);
  const sellingPrice = applyProductMarkup(costPriceXof, DEFAULT_IMPORT_PRICING.productMarkupMultiplier);
  const margin = calculateMargin({
    sellingPrice,
    supplierPrice: costPriceXof,
    supplierShippingCost: 0,
    otherCosts: 0,
  });
  const variants = await mapAlibabaVariants(source.skuInfos || source.raw?.skuInfos, { skipTranslation });
  const stockFromVariants = variants.reduce((sum, v) => sum + toNumber(v.stock, 0), 0);
  const listedStock = toNumber(source.stock, 0);
  const stock = stockFromVariants || listedStock || alibabaConfig.defaultPublicStock;
  const images = extractImages(source.raw || source).length
    ? extractImages(source.raw || source)
    : (source.images || []).map((img) => (typeof img === 'string' ? { url: img } : img));
  const primaryImage = images[0]?.url || source.image || '';
  let name = String(source.name || source.subject || `Produit Alibaba ${externalProductId}`).trim();
  let description = String(source.description || name).replace(/<[^>]+>/g, ' ').slice(0, 4000).trim() || name;

  if (!skipTranslation) {
    try {
      const translatedName = await translateCatalogTextForImport(name);
      if (translatedName && !isInvalidTranslationText(translatedName)) {
        name = translatedName;
      }
    } catch (_e) { /* fallback */ }
    try {
      const translatedDesc = await translateCatalogTextForImport(description);
      if (translatedDesc && !isInvalidTranslationText(translatedDesc)) {
        description = translatedDesc;
      }
    } catch (_e) { /* fallback */ }
  }

  const weightKg = parseWeightToKg(source.weight || source.raw?.productShippingInfo?.weight);
  const weightRaw = weightKg > 0 ? String(weightKg) : '';
  const category = mapCjCategoryToDangoStore(source.category || 'Général');

  let specifications = extractAlibabaSpecifications(source);
  if (!skipTranslation && specifications.length) {
    specifications = await Promise.all(specifications.map(async (row) => {
      let key = row.key;
      let value = row.value;
      const lowerKey = key.toLowerCase().replace(/[\s-]+/g, '_');
      if (ATTR_TRANSLATIONS[lowerKey]) {
        key = ATTR_TRANSLATIONS[lowerKey];
      } else {
        try {
          const tKey = await translateCatalogTextForImport(key);
          if (tKey && !isInvalidTranslationText(tKey)) key = tKey;
        } catch (_e) {}
      }
      try {
        const tVal = await translateCatalogTextForImport(value);
        if (tVal && !isInvalidTranslationText(tVal)) value = tVal;
      } catch (_e) {}
      return { key, value };
    }));
  }

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
    specifications,
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
      productUrl: source.productUrl || `https://www.alibaba.com/product-detail/${externalProductId}.html`,
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
