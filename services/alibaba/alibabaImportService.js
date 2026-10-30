const Product = require('../../Models/Product');
const AlibabaProduct = require('../../Models/AlibabaProduct');
const { alibabaConfig } = require('../../config/alibaba');
const { getAlibabaProductDetail } = require('./alibabaProductService');
const { normalizeAlibabaProductSnapshot } = require('./alibabaProductNormalizer');
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
  const idStr = String(externalProductId || '').trim();
  const key = buildExternalSourceKey(idStr);
  return Product.findOne({
    sourceType: 'DROPSHIPPING',
    $or: [
      { externalSourceKey: key },
      { 'supplier.platform': alibabaConfig.platformKey, 'supplier.productId': idStr },
      { source: 'ALIBABA', sourceProductId: idStr },
    ],
  });
}

function validateProductQualityForPublication(product) {
  const errors = [];
  const warnings = [];

  // 1. Nom commercial
  const name = String(product?.name || '').trim();
  if (!name || name.length < 3) {
    errors.push({ code: 'INVALID_NAME', message: 'Nom commercial absent ou trop court (min 3 caractères).', field: 'name' });
  } else if (/^Produit( Alibaba)? \d+$/i.test(name)) {
    warnings.push({ code: 'GENERIC_NAME', message: 'Le nom du produit est un nom générique temporaire.', field: 'name' });
  }

  // 2. Images exploitables
  const images = Array.isArray(product?.images) ? product.images : [];
  const hasImage = Boolean(product?.image) || images.some((img) => img && (img.url || typeof img === 'string'));
  if (!hasImage) {
    errors.push({ code: 'MISSING_IMAGES', message: 'Au moins une image exploitable est obligatoire.', field: 'images' });
  }

  // 3. Prix de vente
  const price = Number(product?.price || 0);
  if (!Number.isFinite(price) || price <= 0) {
    errors.push({ code: 'INVALID_SELLING_PRICE', message: 'Prix de vente Dango import invalide (doit être > 0).', field: 'price' });
  }

  // 4. Catégorie
  const category = String(product?.category || '').trim();
  if (!category || category === 'Général') {
    warnings.push({ code: 'DEFAULT_CATEGORY', message: 'Catégorie définie par défaut sur Général : attribuez une catégorie précise.', field: 'category' });
  }

  // 5. Variantes
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  if (variants.length > 0) {
    const invalidVariants = variants.filter((v) => !v || !v.name || Number(v.price) <= 0);
    if (invalidVariants.length > 0) {
      errors.push({ code: 'INVALID_VARIANTS', message: `${invalidVariants.length} variante(s) sans nom ou avec prix nul.`, field: 'variants' });
    }
  }

  // 6. Disponibilité & stock
  const rawStock = Number(product?.stock ?? product?.sourceInventory?.rawStock ?? 0);
  if (rawStock >= 2147483647) {
    warnings.push({ code: 'UNVERIFIED_STOCK', message: 'Stock déclaré 2147483647 suspect (plafond technique Integer.MAX_VALUE) : quantité marquée non vérifiée.', field: 'stock' });
  }

  // 7. Minimum de commande (MOQ)
  const moq = Number(product?.minimumOrderQuantity || 1);
  const tiers = Array.isArray(product?.sourcePriceTiers) ? product.sourcePriceTiers : [];
  if (moq > 1 && tiers.length > 0 && Number(tiers[0].minQty) < moq) {
    warnings.push({
      code: 'MOQ_PRICE_TIER_CONFLICT',
      message: `Conflit MOQ : Minimum de commande déclaré (${moq} paires) supérieur au 1er palier de prix (${tiers[0].minQty} paire). Une décision explicite est requise.`,
      field: 'minimumOrderQuantity',
    });
  }

  return {
    canPublish: errors.length === 0,
    errors,
    warnings,
  };
}

function buildAlibabaProductRecord(rawPayload = {}, mapped = {}) {
  const raw = rawPayload && Object.keys(rawPayload).length ? rawPayload : mapped?.rawAlibabaData || mapped || {};
  return normalizeAlibabaProductSnapshot(raw, mapped);
}

async function upsertAlibabaProduct(externalProductId, {
  publish = false,
  update = false,
  overwriteCommercial = false,
  variantIds,
  adminUser,
} = {}) {
  const id = String(externalProductId || '').trim();
  if (!id) {
    const err = new Error('Identifiant produit Alibaba requis.');
    err.status = 400;
    throw err;
  }

  const existing = await findExistingAlibabaProduct(id);
  if (existing && !update) {
    const existingObj = existing.toObject ? existing.toObject() : existing;
    return {
      success: true,
      alreadyImported: true,
      action: 'exists',
      product: existingObj,
      warnings: existingObj.importWarnings || [],
      errors: existingObj.importErrors || [],
    };
  }

  const detail = await getAlibabaProductDetail(id);
  const mapped = await mapAlibabaProductToDango(detail, detail);
  const rawSource = detail?.raw || detail?.rawAlibabaData || detail || {};
  const alibabaSnapshot = buildAlibabaProductRecord(rawSource, mapped);
  const alibabaProduct = await AlibabaProduct.findOneAndUpdate(
    { source: 'ALIBABA', sourceProductId: alibabaSnapshot.sourceProductId },
    { $set: alibabaSnapshot },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  if (!(mapped?.pricing?.supplierPrice > 0)) {
    const err = new Error('Prix fournisseur introuvable : import refusé.');
    err.status = 422;
    err.code = 'SUPPLIER_PRICE_REQUIRED';
    throw err;
  }

  if (Array.isArray(variantIds) && variantIds.length) {
    const allowed = new Set(variantIds.map((v) => String(v).trim()));
    mapped.variants = (mapped.variants || []).filter((v) => allowed.has(String(v.attributes?.externalVariantId || v.sku || '')));
    mapped.stock = mapped.variants.reduce((sum, v) => sum + toNumber(v.stock, 0), 0);
  }

  const payload = mapToDropshippingPayload(mapped, { publish });

  if (existing) {
    // Synchronisation idempotente : mise à jour des données fournisseur tout en préservant
    // strictement les modifications commerciales manuelles de l'administrateur
    if (!overwriteCommercial) {
      payload.name = existing.name || payload.name;
      payload.description = existing.description || payload.description;
      payload.shortDescription = existing.shortDescription || payload.shortDescription;
      payload.category = existing.category || payload.category;
      payload.price = existing.price || payload.price;
      payload.marginPercent = existing.marginPercent ?? payload.marginPercent;
      payload.isPublished = existing.isPublished;
      payload.publicationStatus = existing.publicationStatus || (existing.isPublished ? 'published' : 'draft');
      payload.shippingInfo = existing.shippingInfo || payload.shippingInfo;
      if (Array.isArray(existing.images) && existing.images.length > 0) {
        payload.images = existing.images;
        payload.image = existing.image || existing.images[0].url;
      }
    }

    const quality = validateProductQualityForPublication(payload);
    payload.importWarnings = quality.warnings;
    payload.importErrors = quality.errors;
    payload.importStatus = quality.errors.length > 0
      ? 'SYNC_ERROR'
      : quality.warnings.length > 0
        ? 'TO_VERIFY'
        : (payload.isPublished ? 'PUBLISHED' : 'READY_TO_PUBLISH');

    const historyEntry = {
      action: 'Synchronisation Alibaba',
      comment: `Synchronisation fournisseur (id ${id}). Données source et paliers mis à jour.`,
      performedBy: adminUser?.email || 'admin',
      role: 'admin',
      date: new Date(),
    };
    payload.history = [...(existing.history || []), historyEntry];

    const updated = await updateDropshippingProduct(existing._id, {
      ...payload,
      alibabaProductId: existing.alibabaProductId || alibabaProduct._id,
    }, adminUser);
    const updatedObj = updated.toObject ? updated.toObject() : updated;
    await AlibabaProduct.findByIdAndUpdate(alibabaProduct._id, {
      $set: {
        publishedProductId: updatedObj._id || existing._id,
        isPublished: Boolean(updatedObj.isPublished),
        status: updatedObj.importStatus || 'SYNCED',
      },
    });
    return {
      success: true,
      alreadyImported: false,
      action: 'updated',
      product: updatedObj,
      warnings: payload.importWarnings,
      errors: payload.importErrors,
    };
  }

  // Nouvel import
  const quality = validateProductQualityForPublication(payload);
  payload.importWarnings = quality.warnings;
  payload.importErrors = quality.errors;
  payload.importStatus = quality.errors.length > 0
    ? 'SYNC_ERROR'
    : quality.warnings.length > 0
      ? 'TO_VERIFY'
      : (payload.isPublished ? 'PUBLISHED' : 'IMPORTED');

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
  stamped.alibabaProductId = alibabaProduct._id;
  const created = await Product.create(stamped);
  await AlibabaProduct.findByIdAndUpdate(alibabaProduct._id, {
    $set: {
      publishedProductId: created._id,
      isPublished: Boolean(created.isPublished),
      status: created.importStatus || 'IMPORTED',
    },
  });
  const createdObj = created.toObject ? created.toObject() : created;
  return {
    success: true,
    alreadyImported: false,
    action: 'created',
    product: createdObj,
    warnings: stamped.importWarnings || [],
    errors: stamped.importErrors || [],
  };
}

module.exports = {
  buildAlibabaProductRecord,
  findExistingAlibabaProduct,
  upsertAlibabaProduct,
  validateProductQualityForPublication,
};
