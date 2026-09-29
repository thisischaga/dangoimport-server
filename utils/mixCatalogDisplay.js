const STOP_WORDS = new Set([
  'de', 'du', 'des', 'la', 'le', 'les', 'un', 'une', 'et', 'en', 'au', 'aux',
  'the', 'and', 'for', 'with', 'from', 'lot', 'pcs', 'piece', 'pieces',
  'pack', 'set', 'new', 'mode', 'femme', 'homme', 'women', 'men', 'kids',
]);

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function productId(product) {
  return String(product?._id || product?.id || product?.sku || product?.name || '');
}

function hashString(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sourceBucket(product) {
  const source = String(product?.sourceType || '').toUpperCase();
  if (source === 'DROPSHIPPING' || product?.importFeesAtCheckout || product?.isDropshipping) {
    return 'import';
  }
  return 'local';
}

function nameFamily(product) {
  const words = normalizeText(product?.name || product?.title)
    .split(' ')
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
  if (!words.length) return 'misc';
  return words[words.length - 1].slice(0, 12);
}

function catalogMixKey(product) {
  const category = normalizeText(product?.subCategory || product?.category || 'autre').split(' ')[0] || 'autre';
  return `${sourceBucket(product)}:${category}:${nameFamily(product)}`;
}

function tooSimilar(a, b) {
  if (!a || !b) return false;
  if (catalogMixKey(a) === catalogMixKey(b)) return true;
  const sameSource = sourceBucket(a) === sourceBucket(b);
  const sameCategory = normalizeText(a.category) === normalizeText(b.category) && Boolean(a.category);
  const sameFamily = nameFamily(a) === nameFamily(b);
  return sameSource && sameCategory && sameFamily;
}

function stableShuffle(list) {
  return [...list].sort((a, b) => {
    const delta = hashString(productId(a)) - hashString(productId(b));
    if (delta !== 0) return delta;
    return productId(a).localeCompare(productId(b));
  });
}

function mixProductsForDisplay(products = []) {
  const items = Array.isArray(products) ? products.filter(Boolean) : [];
  if (items.length < 3) return items;

  const queue = stableShuffle(items);
  const mixed = [];

  while (queue.length) {
    const previous = mixed[mixed.length - 1];
    let index = queue.findIndex((candidate) => !tooSimilar(candidate, previous));
    if (index < 0) index = 0;
    mixed.push(queue.splice(index, 1)[0]);
  }

  return mixed;
}

function shouldMixCatalogSort(sort) {
  const key = String(sort || '').toLowerCase();
  return !key || ['relevance', 'mix', 'mixed', 'default', 'featured'].includes(key);
}

module.exports = {
  mixProductsForDisplay,
  catalogMixKey,
  shouldMixCatalogSort,
};
