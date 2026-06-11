const Product = require('../Models/Product');

function duplicateFieldMessage(keyPattern = {}) {
  if (keyPattern.sku) return 'Ce SKU est déjà utilisé par un autre produit. Choisissez un code unique ou laissez le champ vide.';
  if (keyPattern.slug) return 'Un produit avec ce nom (slug) existe déjà. Modifiez le nom du produit.';
  if (keyPattern.barcode) return 'Ce code-barres est déjà utilisé par un autre produit.';
  return 'Une valeur unique est déjà utilisée en base de données.';
}

function isDuplicateKeyError(error) {
  return error?.code === 11000 || error?.name === 'MongoServerError' && error?.code === 11000;
}

async function generateUniqueSku() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `DG-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
    const exists = await Product.exists({ sku: candidate });
    if (!exists) return candidate;
  }
  throw new Error('Impossible de générer un SKU unique. Réessayez.');
}

async function resolveSkuForCreate(rawSku) {
  const trimmed = rawSku?.trim();
  if (!trimmed) return generateUniqueSku();

  const exists = await Product.exists({ sku: trimmed });
  if (exists) {
    throw Object.assign(new Error(duplicateFieldMessage({ sku: 1 })), { statusCode: 409 });
  }
  return trimmed;
}

async function resolveSkuForUpdate(rawSku, productId, existingSku) {
  const trimmed = rawSku?.trim();
  if (!trimmed) return existingSku || undefined;
  if (trimmed === existingSku) return trimmed;

  const exists = await Product.exists({ sku: trimmed, _id: { $ne: productId } });
  if (exists) {
    throw Object.assign(new Error(duplicateFieldMessage({ sku: 1 })), { statusCode: 409 });
  }
  return trimmed;
}

module.exports = {
  resolveSkuForCreate,
  resolveSkuForUpdate,
  isDuplicateKeyError,
  duplicateFieldMessage,
};
