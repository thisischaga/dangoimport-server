const { uploadDataUrl } = require('./cloudinaryUpload');

const isBlobUrl = (url) => typeof url === 'string' && url.startsWith('blob:');
const isRemoteUrl = (url) =>
  typeof url === 'string' &&
  (url.startsWith('http://') || url.startsWith('https://'));

function getExistingImages(existingProduct) {
  if (!existingProduct) return [];
  if (Array.isArray(existingProduct.images) && existingProduct.images.length > 0) {
    return existingProduct.images
      .map((img) => ({
        url: typeof img === 'string' ? img : img?.url,
        alt: typeof img === 'object' ? img.alt : undefined,
        isPrimary: typeof img === 'object' ? Boolean(img.isPrimary) : false,
      }))
      .filter((img) => isRemoteUrl(img.url));
  }
  if (isRemoteUrl(existingProduct.image)) {
    return [{ url: existingProduct.image, alt: existingProduct.name, isPrimary: true }];
  }
  return [];
}

const fs = require('fs');
const path = require('path');
const { isCloudinaryConfigured } = require('../config/cloudinary');

async function persistImageUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed || isBlobUrl(trimmed)) return null;
  if (isRemoteUrl(trimmed)) return trimmed;
  if (trimmed.startsWith('data:image')) {
    if (isCloudinaryConfigured) {
      return uploadDataUrl(trimmed);
    } else {
      const matches = trimmed.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        throw new Error('Invalid base64 string');
      }
      const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
      const buffer = Buffer.from(matches[2], 'base64');
      const filename = `product_${Date.now()}_${Math.round(Math.random() * 1e9)}.${ext}`;
      const uploadDir = path.join(__dirname, '../public/uploads/products');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      fs.writeFileSync(path.join(uploadDir, filename), buffer);
      
      const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000';
      return `${API_BASE}/uploads/products/${filename}`;
    }
  }
  return trimmed;
}

function mergeWithExistingImages(productData, existingProduct) {
  const existingImages = getExistingImages(existingProduct);
  const name = productData.name || existingProduct?.name || 'Produit';
  const incoming = Array.isArray(productData.images) ? productData.images : [];
  const merged = [];

  incoming.forEach((img, index) => {
    const entry = typeof img === 'string' ? { url: img } : img;
    if (!entry?.url) return;

    if (isBlobUrl(entry.url)) {
      const fallback = existingImages[index] || existingImages[0];
      if (fallback?.url) {
        merged.push({
          url: fallback.url,
          alt: entry.alt || fallback.alt || name,
          isPrimary: Boolean(entry.isPrimary),
        });
      }
      return;
    }

    merged.push({
      url: entry.url,
      alt: entry.alt || name,
      isPrimary: Boolean(entry.isPrimary),
    });
  });

  if (merged.length === 0 && existingImages.length > 0) {
    return existingImages.map((img) => ({
      url: img.url,
      alt: img.alt || name,
      isPrimary: Boolean(img.isPrimary),
    }));
  }

  let image = productData.image;
  if (!image || isBlobUrl(image)) {
    const primary = merged.find((img) => img.isPrimary) || merged[0];
    image = primary?.url || existingImages[0]?.url || '';
  }

  return { ...productData, image, images: merged };
}

async function normalizeProductImages(productData, { existingProduct } = {}) {
  const name = productData.name || existingProduct?.name || 'Produit';
  let data = mergeWithExistingImages(productData, existingProduct);
  const rawImages = Array.isArray(data.images) ? data.images : [];

  const normalized = [];
  for (const img of rawImages) {
    const entry = typeof img === 'string' ? { url: img } : img;
    if (!entry?.url) continue;

    const url = await persistImageUrl(entry.url);
    if (!url) continue;

    normalized.push({
      url,
      alt: entry.alt || name,
      isPrimary: Boolean(entry.isPrimary),
    });
  }

  if (normalized.length === 0 && data.image) {
    const url = await persistImageUrl(data.image);
    if (url) {
      normalized.push({ url, alt: name, isPrimary: true });
    }
  }

  if (normalized.length === 0 && !existingProduct) {
    throw new Error(
      'Image produit requise. Uploadez une image via le panneau admin (URL https Cloudinary ou base64). ' +
      'Vérifiez aussi CLOUDINARY_* sur le serveur Render.'
    );
  }

  if (normalized.length === 0 && existingProduct) {
    const fallback = getExistingImages(existingProduct);
    if (fallback.length > 0) {
      return {
        ...data,
        images: fallback.map((img) => ({
          url: img.url,
          alt: img.alt || name,
          isPrimary: Boolean(img.isPrimary),
        })),
        image: fallback.find((img) => img.isPrimary)?.url || fallback[0].url,
      };
    }
  }

  const primary = normalized.find((img) => img.isPrimary) || normalized[0];

  return {
    ...data,
    images: normalized,
    image: primary?.url || '',
  };
}

module.exports = { persistImageUrl, normalizeProductImages, isBlobUrl };
