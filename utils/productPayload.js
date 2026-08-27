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

const normalizeDeliveryZones = (zones) => {
  if (!Array.isArray(zones)) return [];

  return zones.flatMap((zone) => {
    const country = String(zone?.country ?? '').trim();
    const region = String(zone?.region ?? zone?.area ?? '').trim();
    const fallbackDeliveryTime = '2-5 jours';

    const quartierEntries = Array.isArray(zone?.quartiers) ? zone.quartiers : [];
    if (quartierEntries.length > 0) {
      return quartierEntries
        .map((quartier) => {
          const locality = String(quartier?.name ?? quartier?.locality ?? quartier?.city ?? '').trim();
          const price = toNumber(quartier?.price ?? zone?.price, Boolean(zone?.freeShipping || quartier?.freeShipping) ? 0 : 0) ?? 0;
          const freeShipping = Boolean(zone?.freeShipping || quartier?.freeShipping || price === 0);
          const zoneName = String(quartier?.zoneName ?? locality || region || country || 'Zone').trim();
          const deliveryTime = String(quartier?.deliveryTime ?? zone?.deliveryTime ?? zone?.estimatedDelivery ?? fallbackDeliveryTime).trim() || fallbackDeliveryTime;

          return {
            country,
            area: region,
            locality,
            city: locality,
            zoneName,
            price,
            deliveryTime,
            freeShipping,
          };
        })
        .filter((item) => Boolean(item.country || item.area || item.locality || item.zoneName));
    }

    const locality = String(zone?.locality ?? zone?.city ?? '').trim();
    const area = String(zone?.area ?? region).trim();
    const zoneName = String(zone?.zoneName ?? locality || area || country || 'Zone').trim();
    const price = toNumber(zone?.price, Boolean(zone?.freeShipping) ? 0 : 0) ?? 0;
    const deliveryTime = String(zone?.deliveryTime ?? zone?.estimatedDelivery ?? fallbackDeliveryTime).trim() || fallbackDeliveryTime;
    const freeShipping = Boolean(zone?.freeShipping || price === 0);

    return [{
      country,
      area,
      locality,
      city: locality,
      zoneName,
      price,
      deliveryTime,
      freeShipping,
    }].filter((item) => Boolean(item.country || item.area || item.locality || item.zoneName));
  });
};

const isBlobUrl = (url) => typeof url === 'string' && url.startsWith('blob:');
const isPersistableUrl = (url) =>
  typeof url === 'string' &&
  !isBlobUrl(url) &&
  (url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('data:image') ||
    url.trim().length > 0);

const normalizeImages = (body) => {
  const { image, name, images } = body;
  if (Array.isArray(images) && images.length > 0) {
    return images
      .map((img) => (typeof img === 'string' ? { url: img } : img))
      .filter((img) => img?.url && isPersistableUrl(img.url));
  }
  if (image && isPersistableUrl(image)) {
    return [{ url: image, alt: name || 'Produit', isPrimary: true }];
  }
  return [];
};

function buildProductPayload(body, { existingProduct } = {}) {
  const name = body.name?.trim();
  const image = (!isBlobUrl(body.image) && body.image) || existingProduct?.image;
  const images = normalizeImages({ ...body, name: name || existingProduct?.name });

  const payload = {
    name,
    sku: body.sku?.trim() || existingProduct?.sku || undefined,
    barcode: body.barcode?.trim() || existingProduct?.barcode || undefined,
    brand: body.brand?.trim() || '',
    category: body.category?.trim(),
    subCategory: body.subCategory?.trim() || undefined,
    tags: toStringList(body.tags),
    price: toNumber(body.price, existingProduct?.price ?? 0),
    salePrice: toNumber(body.salePrice ?? body.promoPrice),
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
    deliveryZones: normalizeDeliveryZones(body.shipping?.deliveryZones || body.deliveryZones),
    warranty: body.warranty?.trim() || undefined,
    image,
    images,
    videos: toStringList(body.videos),
    documents: toStringList(body.documents),
    condition: body.condition || 'Neuf',
    isFeatured: Boolean(body.isFeatured),
    isBestSeller: Boolean(body.isBestSeller),
    isNewArrival: Boolean(body.isNewArrival),
    isPromo: Boolean(body.isPromo || body.promoPrice || body.salePrice),
    isPublished: body.isPublished !== false && body.isPublished !== 'false',
    seoTitle: body.seoTitle?.trim() || undefined,
    seoDescription: body.seoDescription?.trim() || undefined,
    seoKeywords: toStringList(body.seoKeywords),
    isCustomizable: Boolean(body.isCustomizable),
    parameters: Array.isArray(body.parameters) ? body.parameters : [],
    variants: (Array.isArray(body.variants) ? body.variants : []).map(v => ({
      name: v.name,
      sku: v.sku,
      price: toNumber(v.price),
      stock: toNumber(v.stock, 0),
      image: v.image,
      parameters: Array.isArray(v.parameters) ? v.parameters : [],
    })),
    vendorName: body.vendorName?.trim() || 'Vendeur Indépendant',
    updatedAt: new Date(),
  };

  if (name && (!existingProduct || name !== existingProduct.name)) {
    payload.slug = slugify(name, { lower: true, strict: true });
  }

  return payload;
}

module.exports = { buildProductPayload };
