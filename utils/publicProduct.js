const { isDropshippingProduct, PLATFORM_VENDOR_NAME } = require('./dropshippingCalculations');
const {
  prepareDropshippingProductForPublic,
  isCjDropshippingProduct,
} = require('./cjCatalogHelpers');
const { maybeTranslateCatalogText } = require('../services/cj/cjLocalization');

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
];

function normalizePublicMedia(doc) {
  if (!doc) return doc;
  return doc;
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
    publicDoc.vendorId = undefined;
    publicDoc.fulfillmentType = doc.fulfillmentType || 'DANGO_IMPORT';
    delete publicDoc.supplier;
  }

  return publicDoc;
}

async function toPublicProductDetail(product) {
  const publicDoc = toPublicProduct(product);
  if (!publicDoc || !isDropshippingProduct(product)) return publicDoc;

  if (isCjDropshippingProduct(product)) {
    if (publicDoc.name) {
      publicDoc.name = await maybeTranslateCatalogText(publicDoc.name);
    }
    if (publicDoc.description) {
      publicDoc.description = await maybeTranslateCatalogText(publicDoc.description);
    }
    if (publicDoc.shortDescription) {
      publicDoc.shortDescription = await maybeTranslateCatalogText(publicDoc.shortDescription);
    }
  }

  return publicDoc;
}

function toPublicProducts(products = []) {
  return (products || []).map(toPublicProduct).filter(Boolean);
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
