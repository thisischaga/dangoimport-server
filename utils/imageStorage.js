const { uploadDataUrl } = require('./cloudinaryUpload');

async function persistImageUrl(url) {
  if (!url || typeof url !== 'string') return url;
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('blob:')) {
    throw new Error('URL blob non supportée. Uploadez l\'image via le panneau admin.');
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  if (trimmed.startsWith('data:image')) {
    return uploadDataUrl(trimmed);
  }
  return trimmed;
}

async function normalizeProductImages(productData) {
  const name = productData.name || 'Produit';
  const rawImages = Array.isArray(productData.images) ? productData.images : [];

  const normalized = [];
  for (const img of rawImages) {
    const entry = typeof img === 'string' ? { url: img } : img;
    if (!entry?.url) continue;

    const url = await persistImageUrl(entry.url);
    normalized.push({
      url,
      alt: entry.alt || name,
      isPrimary: Boolean(entry.isPrimary),
    });
  }

  if (normalized.length === 0 && productData.image) {
    const url = await persistImageUrl(productData.image);
    normalized.push({ url, alt: name, isPrimary: true });
  }

  const primary = normalized.find((img) => img.isPrimary) || normalized[0];

  return {
    ...productData,
    images: normalized,
    image: primary?.url || (productData.image ? await persistImageUrl(productData.image) : ''),
  };
}

module.exports = { persistImageUrl, normalizeProductImages };
