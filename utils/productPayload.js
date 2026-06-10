const slugify = require('slugify');

const toNumber = (val, fallback = undefined) => {
  if (val === '' || val === null || val === undefined) return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
};

const toStringList = (val) => {
  if (Array.isArray(val)) return val.map((s) => String(s).trim()).filter(Boolean);
  if (typeof val === 'string') {
    return val.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
};

const normalizeSpecifications = (specs) => {
  if (!Array.isArray(specs)) return [];
  return specs
    .filter((s) => s && (s.key || s.value))
    .map((s) => ({ key: String(s.key || '').trim(), value: String(s.value || '').trim() }))
    .filter((s) => s.key && s.value);
};

const normalizeImages = (body) => {
  const { image, name, images } = body;
  if (Array.isArray(images) && images.length > 0) return images;
  if (image) return [{ url: image, alt: name || 'Produit', isPrimary: true }];
  return [];
};

function buildProductPayload(body, { existingProduct } = {}) {
  const name = body.name?.trim();
  const image = body.image || existingProduct?.image;
  const images = normalizeImages({ ...body, name: name || existingProduct?.name });

  const payload = {
    name,
    sku: body.sku?.trim() || undefined,
    barcode: body.barcode?.trim() || undefined,
    brand: body.brand?.trim() || '',
    category: body.category?.trim(),
    subCategory: body.subCategory?.trim() || undefined,
    tags: toStringList(body.tags),
    price: toNumber(body.price, existingProduct?.price ?? 0),
    salePrice: toNumber(body.salePrice),
    costPrice: toNumber(body.costPrice),
    stock: toNumber(body.stock, 0),
    minStock: toNumber(body.minStock, 10),
    weight: body.weight?.trim() || undefined,
    length: body.length?.trim() || undefined,
    width: body.width?.trim() || undefined,
    height: body.height?.trim() || undefined,
    material: body.material?.trim() || undefined,
    color: toStringList(body.color),
    size: toStringList(body.size),
    shortDescription: body.shortDescription?.trim() || undefined,
    description: body.description?.trim() || '',
    specifications: normalizeSpecifications(body.specifications),
    features: toStringList(body.features),
    shippingInfo: body.shippingInfo?.trim() || undefined,
    warranty: body.warranty?.trim() || undefined,
    image,
    images,
    videos: toStringList(body.videos),
    documents: toStringList(body.documents),
    condition: body.condition || 'Neuf',
    isFeatured: Boolean(body.isFeatured),
    isBestSeller: Boolean(body.isBestSeller),
    isNewArrival: Boolean(body.isNewArrival),
    isPublished: body.isPublished !== false && body.isPublished !== 'false',
    seoTitle: body.seoTitle?.trim() || undefined,
    seoDescription: body.seoDescription?.trim() || undefined,
    seoKeywords: toStringList(body.seoKeywords),
    isCustomizable: Boolean(body.isCustomizable),
    parameters: Array.isArray(body.parameters) ? body.parameters : [],
    vendorName: body.vendorName?.trim() || 'Vendeur Indépendant',
    updatedAt: new Date(),
  };

  if (name && (!existingProduct || name !== existingProduct.name)) {
    payload.slug = slugify(name, { lower: true, strict: true });
  }

  return payload;
}

module.exports = { buildProductPayload };
