const { isDropshippingProduct, PLATFORM_VENDOR_NAME } = require('./dropshippingCalculations');
const { calculateImportPricing } = require('./importPricing');
const { getImportPricingConfigSync } = require('../services/importPricingService');
const {
  prepareDropshippingProductForPublic,
  isCjDropshippingProduct,
  isInvalidTranslationText,
  pickBestStoredProductName,
  sanitizePublicVariants,
} = require('./cjCatalogHelpers');

const INTERNAL_FIELDS = [
  'costPrice',
  'otherCosts',
  'estimatedProfit',
  'marginPercent',
  'syncError',
  'lastSyncErrorAt',
  'sourceType',
  'importSourceType',
  'externalSourceKey',
  'pickupAddress',
  'sellerAddress',
  'history',
  'rejectionReason',
  'changeRequestComment',
  'reviews',
  'dropshipStockEstimated',
  'convertedSupplierPriceFCFA',
  'productMarkupMultiplier',
  'shippingCategory',
  'rawAlibabaData',
  'sourceInventory',
  'sourcePriceTiers',
  'importErrors',
  'importWarnings',
];

function computePublicPriceTiers(doc = {}) {
  const tiers = Array.isArray(doc.sourcePriceTiers) && doc.sourcePriceTiers.length > 0
    ? doc.sourcePriceTiers
    : (Array.isArray(doc.rawAlibabaData?.ladderPrices) ? doc.rawAlibabaData.ladderPrices : []);

  if (!tiers.length) return [];

  const multiplier = Math.max(1, Number(doc.productMarkupMultiplier) || 1.3);
  const minUnitPrice = Math.max(0, Math.round(Number(doc.minimumProductPrice) || 0));

  return tiers.map((tier) => {
    const rawTierPrice = Number(tier.price) || 0;
    const currency = String(tier.currency || doc.currency || 'USD').toUpperCase();
    let priceXof = 0;
    if (currency === 'USD') {
      priceXof = Math.round(rawTierPrice * 610);
    } else if (currency === 'CNY') {
      priceXof = Math.round(rawTierPrice * 85);
    } else {
      priceXof = Math.round(rawTierPrice);
    }
    const publicUnitPrice = Math.max(minUnitPrice, Math.round(priceXof * multiplier));
    return {
      minQuantity: Math.max(1, Math.round(Number(tier.minQty ?? tier.minQuantity ?? tier.min_quantity) || 1)),
      maxQuantity: (tier.maxQty || tier.maxQuantity || tier.max_quantity)
        ? Math.round(Number(tier.maxQty || tier.maxQuantity || tier.max_quantity))
        : null,
      unitPrice: publicUnitPrice,
      currency: 'XOF',
    };
  }).filter((t) => t.unitPrice > 0).sort((a, b) => a.minQuantity - b.minQuantity);
}

function sanitizePublicVariantList(variants = []) {
  if (!Array.isArray(variants)) return [];
  return variants.map((v) => {
    const copy = { ...v };
    delete copy.sourcePrice;
    delete copy.sourceStock;
    delete copy.supplierPriceUsd;
    delete copy.supplierPriceCny;
    delete copy.sourceSkuId;
    return copy;
  });
}

function resolveLocalOriginLabel(doc = {}) {
  const zones = Array.isArray(doc.deliveryZones) ? doc.deliveryZones : [];
  const parts = [
    doc.country,
    doc.origin,
    doc.vendorCountry,
    doc.sellerCountry,
    doc.shippingOrigin?.countryName,
    doc.shippingOrigin?.countryCode,
    ...zones.map((zone) => zone?.country),
    doc.pickupAddress,
    doc.sellerAddress,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (/\btogo\b|\btg\b/.test(parts)) return 'Togo';
  if (/\bbenin\b|\bbj\b/.test(parts)) return 'Bénin';
  return '';
}

function toPublicProduct(product) {
  if (!product) return null;

  const doc = typeof product.toObject === 'function' ? product.toObject() : { ...product };
  let publicDoc = { ...doc };

  INTERNAL_FIELDS.forEach((field) => {
    delete publicDoc[field];
  });

  delete publicDoc.supplier;

  if (isDropshippingProduct(doc)) {
    publicDoc = prepareDropshippingProductForPublic(doc);
    publicDoc.vendorName = PLATFORM_VENDOR_NAME;
    publicDoc.isVendorCertified = true;
    publicDoc.originLabel = 'Chine';
    publicDoc.vendorId = undefined;
    publicDoc.fulfillmentType = doc.fulfillmentType || 'DANGO_IMPORT';
    const pricing = calculateImportPricing(doc, { config: getImportPricingConfigSync() });
    publicDoc.price = pricing.unitPrice;
    publicDoc.salePrice = 0;
    publicDoc.unitPrice = pricing.unitPrice;
    publicDoc.packPrice = pricing.packPrice;
    publicDoc.packSize = pricing.packSize;
    publicDoc.minimumOrderQuantity = pricing.minimumOrderQuantity;
    publicDoc.quantityIncrement = pricing.quantityIncrement;
    publicDoc.soldAsLot = pricing.soldAsLot;
    publicDoc.importFeesAtCheckout = true;
    publicDoc.estimatedImportDays = pricing.estimatedDays;
    INTERNAL_FIELDS.forEach((field) => {
      delete publicDoc[field];
    });
    delete publicDoc.supplier;
  } else {
    publicDoc.originLabel = resolveLocalOriginLabel(doc);
  }

  const isAlibaba = Boolean(
    doc.isAlibaba === true ||
    doc.importSourceType === 'ALIBABA_API' ||
    doc.supplier?.platform === 'alibaba' ||
    /^alibaba:/i.test(String(doc.externalSourceKey || ''))
  );
  if (isAlibaba) {
    publicDoc.isAlibaba = true;
    publicDoc.fulfillmentPlatform = 'Alibaba';
  }

  if (Array.isArray(publicDoc.variants)) {
    publicDoc.variants = sanitizePublicVariantList(publicDoc.variants);
  }

  return publicDoc;
}

function sanitizeStoredCjPublicDoc(publicDoc, sourceDoc) {
  if (!publicDoc || !isCjDropshippingProduct(sourceDoc)) return publicDoc;

  if (isInvalidTranslationText(publicDoc.name) || !String(publicDoc.name || '').trim()) {
    publicDoc.name = pickBestStoredProductName(sourceDoc) || 'Article Dango Import';
  }
  if (isInvalidTranslationText(publicDoc.description)) {
    publicDoc.description = publicDoc.name || '';
  }
  if (isInvalidTranslationText(publicDoc.shortDescription)) {
    publicDoc.shortDescription = String(publicDoc.description || publicDoc.name || '').slice(0, 220);
  }
  if (Array.isArray(publicDoc.variants)) {
    publicDoc.variants = sanitizePublicVariants(publicDoc.variants);
  }
  return publicDoc;
}

function normalizeAlibabaImageList(images) {
  if (!Array.isArray(images)) return [];

  const seen = new Set();
  const collected = [];

  for (const item of images) {
    const url = typeof item === 'string' ? item : item?.url;
    const cleaned = String(url || '').trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    collected.push(cleaned);
  }

  return collected;
}

function extractAlibabaKeyAttributes(doc = {}) {
  const candidates = [
    doc.normalized?.keyAttributes,
    doc.rawAlibabaData?.keyAttributes,
    doc.rawPayload?.keyAttributes,
    doc.rawSections?.keyAttributes,
    doc.keyAttributes,
  ];

  const groups = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (Array.isArray(candidate.attributes)) {
      groups.push(...candidate.attributes);
    } else if (Array.isArray(candidate)) {
      groups.push(...candidate);
    }
  }

  return groups
    .map((group) => {
      const attributes = Array.isArray(group?.attributes) ? group.attributes : [];
      return {
        type: group?.type || 'Alibaba attribute',
        attributes: attributes
          .map((attribute) => {
            const values = Array.isArray(attribute?.values)
              ? attribute.values
                  .map((value) => (typeof value === 'string' ? value : value?.value))
                  .filter(Boolean)
              : [];
            const value = attribute?.value || values[0] || '';
            return {
              name: attribute?.name || '',
              value,
              values,
            };
          })
          .filter((attribute) => attribute.name && (attribute.value || attribute.values.length)),
      };
    })
    .filter((group) => Array.isArray(group.attributes) && group.attributes.length > 0);
}

function extractAlibabaInventory(doc = {}) {
  const candidates = [
    doc.normalized?.inventory,
    doc.rawAlibabaData?.inventory,
    doc.rawPayload?.inventory,
    doc.rawSections?.inventory,
    doc.inventory?.raw,
    doc.inventory,
  ];

  const extracted = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (Array.isArray(candidate)) {
      extracted.push(...candidate);
    } else if (typeof candidate === 'object') {
      extracted.push(candidate);
    }
  }

  return extracted
    .map((entry) => {
      if (Array.isArray(entry?.inventory_list)) {
        return {
          shippingFrom: entry.shipping_from || entry.shippingFrom || '',
          inventoryList: entry.inventory_list.map((item) => ({
            inventoryUnit: item.inventory_unit || item.inventoryUnit || '',
            inventoryCount: item.inventory_count ?? item.inventoryCount ?? null,
            productId: item.product_id ?? item.productId ?? null,
            skuId: item.sku_id ?? item.skuId ?? null,
          })),
        };
      }

      if (entry && typeof entry === 'object') {
        const base = { ...entry };
        delete base.raw;
        delete base.quantityRaw;
        if (base.shippingFrom || base.shipping_from || base.availability || base.quantityVerified !== undefined) {
          return base;
        }
      }

      return null;
    })
    .filter(Boolean);
}

function resolveAlibabaWeightValue(doc = {}) {
  const candidates = [
    doc.normalized?.logistics?.weight,
    doc.normalized?.weight,
    doc.rawAlibabaData?.logistics?.weight,
    doc.rawAlibabaData?.productShippingInfo?.weight,
    doc.rawPayload?.logistics?.weight,
    doc.rawPayload?.productShippingInfo?.weight,
    doc.rawSections?.product?.weight,
    doc.rawSections?.product?.gross_weight,
    doc.rawSections?.product?.net_weight,
    doc.wholesaleTrade?.weight,
    doc.weight,
  ];

  for (const value of candidates) {
    if (value == null || value === '') continue;
    if (typeof value === 'object') {
      const nested = value.value ?? value.amount ?? value.weight ?? value.kg ?? value.valueText;
      if (nested != null && nested !== '') {
        const decimal = String(nested).trim();
        if (decimal && decimal !== '0') return decimal.replace(',', '.');
      }
      continue;
    }

    const raw = String(value).trim();
    if (!raw || raw === '0' || raw.toLowerCase() === '0kg') continue;
    const match = raw.match(/([0-9]+(?:[.,][0-9]+)?)/);
    if (match) return match[1].replace(',', '.');
  }

  return '';
}

function buildAlibabaPublicDetail(doc = {}) {
  const normalized = doc.normalized || {};
  const sourceProductId = doc.sourceProductId || normalized.sourceProductId || doc.externalProductId || normalized.externalProductId || String(doc.externalSourceKey || '').replace(/^alibaba:/i, '') || null;
  const sourceUrl = doc.sourceUrl || normalized.sourceUrl || doc.rawAlibabaData?.detail_url || doc.rawPayload?.detail_url || doc.rawSections?.product?.detail_url || doc.detail_url || null;
  const galleryImages = normalizeAlibabaImageList(
    doc.images || normalized.images || doc.rawAlibabaData?.images || doc.rawPayload?.images || doc.rawSections?.product?.images,
  );
  const supplierInfo = {
    ...(normalized.supplier || {}),
    ...(doc.supplier || {}),
    ...(doc.rawAlibabaData?.supplier || {}),
    ...(doc.rawPayload?.supplier || {}),
  };
  const rawCountry = supplierInfo.country || supplierInfo.countryName || supplierInfo.country_name || supplierInfo.shipFromCountryName || supplierInfo.ship_from_country_name || doc.shippingOrigin?.countryName || doc.shippingOrigin?.country || doc.rawAlibabaData?.country || doc.rawPayload?.country || null;
  const supplierSummary = {
    name: supplierInfo.companyName || supplierInfo.company_name || supplierInfo.name || supplierInfo.raw || doc.vendorName || 'Alibaba',
    platform: supplierInfo.platform || 'Alibaba',
    productId: supplierInfo.productId || supplierInfo.product_id || sourceProductId || null,
    country: rawCountry || null,
    countryName: supplierInfo.countryName || supplierInfo.country_name || rawCountry || null,
    url: supplierInfo.productUrl || supplierInfo.url || sourceUrl || null,
  };
  const weightValue = resolveAlibabaWeightValue(doc);

  return {
    sourceProductId,
    sourceUrl,
    source: 'ALIBABA',
    weight: weightValue,
    weightUnit: doc.normalized?.logistics?.weightUnit || doc.rawAlibabaData?.logistics?.weightUnit || doc.rawPayload?.logistics?.weightUnit || 'kg',
    galleryImages,
    mainImage: doc.mainImage || doc.images?.[0]?.url || normalized.image || normalized.images?.[0]?.url || doc.rawAlibabaData?.main_image || doc.rawPayload?.main_image || galleryImages[0] || '',
    supplierSummary,
    alibaba: {
      platform: 'Alibaba',
      sourceProductId,
      sourceUrl,
      source: 'ALIBABA',
      supplier: supplierSummary,
      keyAttributes: extractAlibabaKeyAttributes(doc),
      inventory: extractAlibabaInventory(doc),
      shippingOrigin: normalized.shippingOrigin || doc.shippingOrigin || null,
      weight: weightValue,
      weightUnit: doc.normalized?.logistics?.weightUnit || doc.rawAlibabaData?.logistics?.weightUnit || doc.rawPayload?.logistics?.weightUnit || 'kg',
      priceTiers: computePublicPriceTiers(doc),
      pricing: normalized.pricing || doc.pricing || null,
      variantCount: Array.isArray(doc.variants) ? doc.variants.length : Array.isArray(normalized.variants) ? normalized.variants.length : 0,
    },
  };
}

async function toPublicProductDetail(product) {
  let doc = typeof product.toObject === 'function' ? product.toObject() : { ...product };
  const publicDoc = toPublicProduct(doc);
  if (!publicDoc) return null;

  const isAlibaba = Boolean(
    doc.isAlibaba === true ||
    doc.importSourceType === 'ALIBABA_API' ||
    doc.supplier?.platform === 'alibaba' ||
    /^alibaba:/i.test(String(doc.externalSourceKey || ''))
  );

  // 1. Paliers de prix publics en FCFA
  const priceTiers = computePublicPriceTiers(doc);
  if (priceTiers.length > 0) {
    publicDoc.publicPriceTiers = priceTiers;
  }

  // 2. Conditionnement & Vente en gros
  const wt = doc.wholesaleTrade || doc.rawAlibabaData?.wholesaleTrade || doc.rawAlibabaData?.wholesale_trade || {};
  const resolvedWeight = isAlibaba ? (buildAlibabaPublicDetail(doc).weight || doc.weight || wt.weight || '') : (doc.weight || wt.weight || '');
  publicDoc.packaging = {
    weight: resolvedWeight,
    dimensions: doc.dimensions || null,
    packageSize: doc.packageSize || wt.package_size || wt.packageSize || '',
    unit: doc.unit || wt.unit_type || wt.unitType || 'Pièce',
    supplyCapacity: doc.supplyCapacity || '',
  };

  publicDoc.wholesale = {
    minOrderQuantity: Number(doc.minimumOrderQuantity || wt.min_order_quantity || wt.minOrderQuantity || 1),
    unitType: doc.unit || wt.unit_type || wt.unitType || 'Pièce',
    handlingTimeDays: Number(wt.handling_time || wt.handlingTime || 0) || null,
    deliverPeriods: Array.isArray(wt.deliver_periods || wt.deliverPeriods)
      ? (wt.deliver_periods || wt.deliverPeriods).map((p) => ({
          quantity: p.quantity,
          processPeriodDays: p.process_period || p.processPeriod,
        }))
      : [],
  };

  // 3. Spécifications fusionnées
  const specMap = new Map();
  (Array.isArray(doc.specifications) ? doc.specifications : []).forEach((s) => {
    if (s && s.key && s.value) specMap.set(String(s.key).trim(), String(s.value).trim());
  });
  if (doc.brand && !specMap.has('Marque') && !/generic|cj\s*drop/i.test(doc.brand)) {
    specMap.set('Marque', doc.brand);
  }
  if (doc.modelNumber && !specMap.has('Modèle')) {
    specMap.set('Modèle', doc.modelNumber);
  }
  if (doc.material && !specMap.has('Matériau')) {
    specMap.set('Matériau', doc.material);
  }
  if (doc.condition && !specMap.has('État')) {
    specMap.set('État', doc.condition);
  }
  if (doc.warranty && !specMap.has('Garantie')) {
    specMap.set('Garantie', doc.warranty);
  }
  if (doc.weight && !specMap.has('Poids')) {
    specMap.set('Poids', `${doc.weight} kg`);
  }
  if (doc.packageSize && !specMap.has('Dimensions colis')) {
    specMap.set('Dimensions colis', doc.packageSize);
  }
  publicDoc.specifications = Array.from(specMap.entries()).map(([key, value]) => ({ key, value }));

  if (isAlibaba) {
    const alibabaDetails = buildAlibabaPublicDetail(doc);
    publicDoc.sourceProductId = alibabaDetails.sourceProductId;
    publicDoc.sourceUrl = alibabaDetails.sourceUrl;
    publicDoc.source = alibabaDetails.source;
    publicDoc.weight = alibabaDetails.weight || publicDoc.weight;
    publicDoc.weightUnit = alibabaDetails.weightUnit || publicDoc.weightUnit || 'kg';
    publicDoc.galleryImages = alibabaDetails.galleryImages;
    publicDoc.mainImage = alibabaDetails.mainImage || publicDoc.mainImage;
    publicDoc.supplierSummary = alibabaDetails.supplierSummary;
    publicDoc.alibaba = alibabaDetails.alibaba;
  }

  if (isDropshippingProduct(doc)) {
    return sanitizeStoredCjPublicDoc(publicDoc, doc);
  }
  return publicDoc;
}

function toPublicProducts(products = []) {
  return (products || [])
    .map((product) => {
      const doc = typeof product.toObject === 'function' ? product.toObject() : { ...product };
      const publicDoc = toPublicProduct(doc);
      if (!publicDoc) return null;
      return sanitizeStoredCjPublicDoc(publicDoc, doc);
    })
    .filter(Boolean);
}

function toAdminDropshippingProduct(product) {
  if (!product) return null;
  const doc = typeof product.toObject === 'function' ? product.toObject() : { ...product };
  return doc;
}

module.exports = {
  toPublicProduct,
  toPublicProductDetail,
  toPublicProducts,
  toAdminDropshippingProduct,
  PLATFORM_VENDOR_NAME,
};
