const { isDropshippingProduct, PLATFORM_VENDOR_NAME } = require('./dropshippingCalculations');

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
];

function toPublicProduct(product) {
  if (!product) return null;

  const doc = typeof product.toObject === 'function' ? product.toObject() : { ...product };
  const publicDoc = { ...doc };

  INTERNAL_FIELDS.forEach((field) => {
    delete publicDoc[field];
  });

  delete publicDoc.supplier;

  if (isDropshippingProduct(doc)) {
    publicDoc.vendorName = PLATFORM_VENDOR_NAME;
    publicDoc.isVendorCertified = true;
    publicDoc.vendorId = undefined;
    publicDoc.fulfillmentType = doc.fulfillmentType || 'DANGO_IMPORT';

    if (doc.supplier?.estimatedDeliveryDays != null) {
      publicDoc.estimatedDeliveryDays = doc.supplier.estimatedDeliveryDays;
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
  toPublicProducts,
  toAdminDropshippingProduct,
  PLATFORM_VENDOR_NAME,
};
