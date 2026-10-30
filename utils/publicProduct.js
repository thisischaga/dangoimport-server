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
  'importSourceType',
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
  publicDoc.packaging = {
    weight: doc.weight || wt.weight || '',
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
