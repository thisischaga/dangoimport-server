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
];

function normalizePublicMedia(doc) {
  if (!doc) return doc;
  return doc;
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
    publicDoc.price = pricing.productPrice;
    publicDoc.salePrice = 0;
    publicDoc.importFeesAtCheckout = true;
    publicDoc.estimatedImportDays = pricing.estimatedDays;
    INTERNAL_FIELDS.forEach((field) => {
      delete publicDoc[field];
    });
    delete publicDoc.supplier;
  } else {
    publicDoc.originLabel = resolveLocalOriginLabel(doc);
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

function toPublicProductDetail(product) {
  let doc = typeof product.toObject === 'function' ? product.toObject() : { ...product };
  const publicDoc = toPublicProduct(doc);
  if (!publicDoc || !isDropshippingProduct(doc)) return publicDoc;
  return sanitizeStoredCjPublicDoc(publicDoc, doc);
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
