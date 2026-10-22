const Product = require('../../Models/Product');
const { alibabaConfig } = require('../../config/alibaba');
const { getAlibabaProductDetail } = require('./alibabaProductService');
const { mapAlibabaProductToDango, mapToDropshippingPayload, buildExternalSourceKey } = require('./alibabaMapper');
const {
  normalizeDropshippingInput,
  validateDropshippingPayload,
  updateDropshippingProduct,
  stampOfficialImportPricing,
} = require('../dropshippingService');
const { resolveSkuForCreate } = require('../../utils/productIdentifiers');
const { toNumber } = require('../../utils/dropshippingCalculations');

async function findExistingAlibabaProduct(externalProductId) {
  const key = buildExternalSourceKey(externalProductId);
  return Product.findOne({
    sourceType: 'DROPSHIPPING',
    $or: [
      { externalSourceKey: key },
      { 'supplier.platform': alibabaConfig.platformKey, 'supplier.productId': String(externalProductId) },
    ],
  });
}

async function upsertAlibabaProduct(externalProductId, { publish = false, update = false, variantIds, adminUser } = {}) {
  const id = String(externalProductId || '').trim();
  if (!id) {
    const err = new Error('Identifiant produit Alibaba requis.');
    err.status = 400;
    throw err;
  }

  const existing = await findExistingAlibabaProduct(id);
  if (existing && !update) {
    return { alreadyImported: true, action: 'exists', product: existing.toObject ? existing.toObject() : existing };
  }

  const detail = await getAlibabaProductDetail(id);
  const mapped = mapAlibabaProductToDango(detail, detail);
  if (!(mapped?.pricing?.supplierPrice > 0)) {
    const err = new Error('Prix fournisseur introuvable : import refusé.');
    err.status = 422;
    err.code = 'SUPPLIER_PRICE_REQUIRED';
    throw err;
  }
  if (Array.isArray(variantIds) && variantIds.length) {
    const allowed = new Set(variantIds.map((v) => String(v).trim()));
    mapped.variants = (mapped.variants || []).filter((v) => allowed.has(String(v.attributes?.externalVariantId || '')));
    mapped.stock = mapped.variants.reduce((sum, v) => sum + toNumber(v.stock, 0), 0);
  }
  const payload = mapToDropshippingPayload(mapped, { publish });

  if (existing) {
    const updated = await updateDropshippingProduct(existing._id, payload, adminUser);
    return { alreadyImported: false, action: 'updated', product: updated };
  }

  const stamped = await stampOfficialImportPricing(normalizeDropshippingInput(payload));
  const errors = validateDropshippingPayload(stamped);
  if (errors.length) {
    const err = new Error(errors.join(' '));
    err.status = 400;
    throw err;
  }
  stamped.sku = await resolveSkuForCreate(stamped.sku);
  stamped.history = [{
    action: 'Import Alibaba',
    comment: `Produit importé depuis Alibaba.com (id ${id}).`,
    performedBy: adminUser?.email || 'admin',
    role: 'admin',
    date: new Date(),
  }];
  const created = await Product.create(stamped);
  return { alreadyImported: false, action: 'created', product: created.toObject() };
}

module.exports = {
  findExistingAlibabaProduct,
  upsertAlibabaProduct,
};
