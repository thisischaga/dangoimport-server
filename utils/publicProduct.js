const { isDropshippingProduct, PLATFORM_VENDOR_NAME } = require('./dropshippingCalculations');
const {
  prepareDropshippingProductForPublic,
  isCjDropshippingProduct,
  isPrimarilyChinese,
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
    INTERNAL_FIELDS.forEach((field) => {
      delete publicDoc[field];
    });
    delete publicDoc.supplier;
  }

  return publicDoc;
}

async function translateCjPublicDoc(publicDoc, sourceDoc) {
  if (!publicDoc || !isCjDropshippingProduct(sourceDoc)) return publicDoc;
  if (publicDoc.name) {
    publicDoc.name = await maybeTranslateCatalogText(publicDoc.name);
    if (isPrimarilyChinese(publicDoc.name) && sourceDoc.supplier?.productNameEn) {
      publicDoc.name = await maybeTranslateCatalogText(sourceDoc.supplier.productNameEn);
    }
  }
  const descSource = String(publicDoc.description || '').trim();
  if (descSource.length > 2) {
    publicDoc.description = await maybeTranslateCatalogText(descSource);
  }
  const shortSource = String(publicDoc.shortDescription || '').trim();
  if (shortSource.length > 2 && shortSource !== descSource) {
    publicDoc.shortDescription = await maybeTranslateCatalogText(shortSource);
  }
  return publicDoc;
}

async function toPublicProductDetail(product) {
  let doc = typeof product.toObject === 'function' ? product.toObject() : { ...product };
  if (isDropshippingProduct(doc) && isCjDropshippingProduct(doc)) {
    const { repairCjSupplierPid } = require('../services/cj/catalogStockEnrichment');
    const { refreshCjProductForPublicView } = require('../services/cj/cjLiveProductRefresh');
    doc = repairCjSupplierPid(doc);
    doc = await refreshCjProductForPublicView(doc);
  }

  const publicDoc = toPublicProduct(doc);
  if (!publicDoc || !isDropshippingProduct(doc)) return publicDoc;

  return translateCjPublicDoc(publicDoc, doc);
}

async function toPublicProducts(products = []) {
  const list = products || [];
  const results = await Promise.all(
    list.map(async (product) => {
      const doc = typeof product.toObject === 'function' ? product.toObject() : { ...product };
      const publicDoc = toPublicProduct(doc);
      if (!publicDoc) return null;
      return translateCjPublicDoc(publicDoc, doc);
    }),
  );
  return results.filter(Boolean);
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
