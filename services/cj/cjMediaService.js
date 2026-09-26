const { isCloudinaryConfigured } = require('../../config/cloudinary');
const { uploadRemoteUrl } = require('../../utils/cloudinaryUpload');
const { normalizeCjImageUrl } = require('../../utils/cjCatalogHelpers');

async function mirrorOne(url) {
  const normalized = normalizeCjImageUrl(url);
  if (!normalized) return '';
  if (!isCloudinaryConfigured) return normalized;
  try {
    return await uploadRemoteUrl(normalized, { folder: 'dangoimport/cj' });
  } catch (error) {
    console.warn('[cjMediaService] Cloudinary mirror failed:', error.message);
    return normalized;
  }
}

async function hydrateCjPayloadMedia(payload = {}) {
  const images = Array.isArray(payload.images) ? payload.images : [];
  const mirroredImages = [];
  for (const img of images.slice(0, 8)) {
    const source = typeof img === 'string' ? img : img?.url;
    const url = await mirrorOne(source);
    if (!url) continue;
    mirroredImages.push({
      url,
      alt: typeof img === 'object' ? img.alt : payload.name,
      isPrimary: Boolean(typeof img === 'object' ? img.isPrimary : mirroredImages.length === 0),
    });
  }

  const variants = Array.isArray(payload.variants) ? payload.variants : [];
  const mirroredVariants = [];
  for (const variant of variants) {
    const vUrl = variant.image ? await mirrorOne(variant.image) : '';
    mirroredVariants.push({ ...variant, image: vUrl || variant.image || '' });
  }

  const primary = mirroredImages.find((i) => i.isPrimary) || mirroredImages[0];

  return {
    ...payload,
    images: mirroredImages,
    image: primary?.url || (payload.image ? await mirrorOne(payload.image) : ''),
    variants: mirroredVariants,
  };
}

module.exports = {
  hydrateCjPayloadMedia,
  mirrorOne,
};
