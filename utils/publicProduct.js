
'use strict';

const PLATFORM_VENDOR_NAME = 'DANGO IMPORT';

function toPlainObject(value) {
  if (!value) return {};
  if (typeof value.toObject === 'function') {
    return value.toObject({ virtuals: false });
  }
  if (typeof value !== 'object') return {};
  return value;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return null;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toFiniteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeImageUrl(value) {
  if (typeof value !== 'string') return null;

  const url = value.trim();
  if (!url) return null;

  if (url.startsWith('//')) return `https:${url}`;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeImages(product) {
  const candidates = [
    ...toArray(product.images),
    product.image,
    product.mainImage,
    product.thumbnail,
    ...toArray(product.gallery),
  ];

  return [...new Set(candidates.map(normalizeImageUrl).filter(Boolean))];
}

function isAlibabaProduct(product = {}) {
  const source = String(
    product.sourceType ||
    product.source ||
    product.vendorType ||
    ''
  ).toUpperCase();

  return (
    source.includes('ALIBABA') ||
    Boolean(product.sourceProductId) ||
    Boolean(product.externalProductId) ||
    Boolean(product.alibabaProductId)
  );
}

function isDropshippingProduct(product = {}) {
  const source = String(
    product.sourceType ||
    product.vendorType ||
    ''
  ).toUpperCase();

  return (
    source === 'DROPSHIPPING' ||
    source === 'ALIBABA' ||
    isAlibabaProduct(product)
  );
}

function getDisplayVendorName(product = {}) {
  if (isAlibabaProduct(product) || isDropshippingProduct(product)) {
    return PLATFORM_VENDOR_NAME;
  }

  return (
    product.vendorName ||
    product.sellerName ||
    product.storeName ||
    PLATFORM_VENDOR_NAME
  );
}

function extractAlibabaData(alibaba = {}) {
  const normalized = toPlainObject(alibaba.normalized);
  const pricing = toPlainObject(alibaba.pricing);
  const inventory = toPlainObject(alibaba.inventory);
  const logistics = toPlainObject(alibaba.logistics);
  const supplier = toPlainObject(alibaba.supplier);

  const variants = toArray(alibaba.variants).map((variant) => {
    const item = toPlainObject(variant);
    const attrs = toArray(item.attributes).map((attr) => ({
      name: String(attr.name || ''),
      value: String(attr.value || ''),
      image: normalizeImageUrl(attr.image),
    })).filter((attr) => attr.name && attr.value);

    return {
      // Identifiant externe informatif uniquement.
      // Le backend de commande doit le valider avant de l'accepter.
      externalVariantId: item.skuId
        ? String(item.skuId)
        : item.externalVariantId
          ? String(item.externalVariantId)
          : null,
      attributes: attrs,
      image: normalizeImageUrl(item.image),
      unit: item.unit || null,
      pricing: toArray(item.pricing)
        .map((tier) => ({
          minQuantity: toFiniteNumber(tier.minQuantity, 1),
          maxQuantity: toFiniteNumber(tier.maxQuantity),
          price: toFiniteNumber(tier.price),
          currency: tier.currency || null,
        }))
        .filter((tier) => tier.price !== null && tier.price > 0),
      // Ne jamais déclarer le stock disponible par défaut.
      quantityVerified: item.inventory?.quantityVerified === true,
      availability: item.inventory?.availability || 'UNKNOWN',
    };
  });

  const availability = inventory.availability || 'UNKNOWN';
  const quantityVerified = inventory.quantityVerified === true;

  let availabilityLabel = 'Disponibilité à confirmer auprès du fournisseur';

  if (availability === 'UNAVAILABLE') {
    availabilityLabel = 'Actuellement indisponible';
  } else if (availability === 'AVAILABLE' && quantityVerified) {
    availabilityLabel = 'Disponibilité confirmée';
  } else if (availability === 'CHECK_REQUIRED') {
    availabilityLabel = 'Vérification nécessaire avant commande';
  }

  return {
    sourceProductId: firstNonEmpty(
      alibaba.sourceProductId,
      alibaba.externalProductId,
      normalized.sourceProductId
    ),
    sourceUrl: firstNonEmpty(alibaba.sourceUrl, normalized.sourceUrl),
    category: firstNonEmpty(normalized.category, alibaba.category),
    videoUrl: normalizeImageUrl(firstNonEmpty(
      normalized.videoUrl,
      alibaba.videoUrl
    )),
    variants,
    availability,
    quantityVerified,
    availabilityLabel,
    minimumOrderQuantity: toFiniteNumber(firstNonEmpty(
      normalized.minimumOrderQuantity,
      pricing.minimumOrderQuantity
    ), 1),
    currency: firstNonEmpty(pricing.currency, normalized.currency),
    unit: firstNonEmpty(pricing.unit, normalized.unit),
    shipFrom: firstNonEmpty(
      logistics.shipFrom,
      logistics.shippingFrom,
      normalized.shipFrom
    ),
    specifications: toArray(normalized.specifications)
      .map((spec) => ({
        name: String(spec.name || spec.key || '').trim(),
        value: String(spec.value ?? '').trim(),
      }))
      .filter((spec) => spec.name && spec.value),
    certifications: toArray(normalized.certifications)
      .map((cert) => typeof cert === 'string'
        ? cert
        : cert?.name || cert?.certificateName || '')
      .filter(Boolean),
    supplierDisplayName: supplier.name
      ? String(supplier.name)
      : PLATFORM_VENDOR_NAME,
  };
}

function sanitizeProductForDisplay(input = {}, alibabaRecord = null) {
  const product = toPlainObject(input);
  const alibaba = alibabaRecord
    ? extractAlibabaData(toPlainObject(alibabaRecord))
    : null;

  const images = normalizeImages(product);
  const isAlibaba = isAlibabaProduct(product) || Boolean(alibabaRecord);

  // Le prix public doit déjà avoir été calculé et enregistré
  // par le backend. Ne jamais utiliser le coût fournisseur ici.
  const publicPrice = toFiniteNumber(firstNonEmpty(
    product.salePrice,
    product.price
  ), 0);

  const minOrder = Math.max(
    1,
    toFiniteNumber(firstNonEmpty(
      product.minimumOrderQuantity,
      alibaba?.minimumOrderQuantity
    ), 1)
  );

  const rawVariants = toArray(product.variants);
  const publicVariants = rawVariants.map((variant) => {
    const item = toPlainObject(variant);

    return {
      _id: item._id ? String(item._id) : null,
      name: item.name || item.title || '',
      attributes: toArray(item.attributes),
      image: normalizeImageUrl(item.image),
      price: toFiniteNumber(item.salePrice ?? item.price, null),
      // Seul un stock réel explicitement vérifié est exposé.
      stock: item.quantityVerified === true
        ? toFiniteNumber(item.stock, 0)
        : null,
      quantityVerified: item.quantityVerified === true,
      availability: item.availability || 'UNKNOWN',
    };
  });

  const result = {
    _id: product._id ? String(product._id) : null,
    slug: product.slug || null,
    name: String(product.name || product.title || ''),
    title: String(product.title || product.name || ''),
    description: String(product.description || ''),
    category: firstNonEmpty(product.category, alibaba?.category),
    price: Math.max(1000, publicPrice),
    salePrice: Math.max(1000, publicPrice),
    currency: 'XOF',
    images,
    image: images[0] || null,
    variants: publicVariants,
    minimumOrderQuantity: minOrder,
    sourceType: isAlibaba
      ? 'DROPSHIPPING'
      : product.sourceType || 'LOCAL_SELLER',
    vendorName: getDisplayVendorName(product),
    isAlibaba,
    isDropshipping: isDropshippingProduct(product) || isAlibaba,
    availability: alibaba?.availability || product.availability || 'UNKNOWN',
    quantityVerified: alibaba?.quantityVerified === true,
    availabilityLabel: alibaba?.availabilityLabel ||
      'Disponibilité à confirmer',
    specifications: alibaba?.specifications ||
      toArray(product.specifications),
    certifications: alibaba?.certifications || [],
    shipFrom: alibaba?.shipFrom || null,
    videoUrl: alibaba?.videoUrl || null,
    sourceProductId: alibaba?.sourceProductId || null,
    sourceUrl: alibaba?.sourceUrl || null,
    createdAt: product.createdAt || null,
    updatedAt: product.updatedAt || null,
  };

  // Ne pas transmettre les champs bruts du fournisseur.
  return result;
}

async function toPublicProductDetail(product, alibabaRecord = null) {
  if (!product) return null;

  return sanitizeProductForDisplay(product, alibabaRecord);
}

module.exports = {
  PLATFORM_VENDOR_NAME,
  isAlibabaProduct,
  isDropshippingProduct,
  getDisplayVendorName,
  extractAlibabaData,
  sanitizeProductForDisplay,
  toPublicProductDetail,
};
