const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const MAGIC_SIGNATURES = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] },
];

function matchesMagicBytes(buffer, signature) {
  if (!buffer || buffer.length < signature.bytes.length) return false;
  return signature.bytes.every((byte, index) => buffer[index] === byte);
}

function detectImageMime(buffer) {
  if (!buffer || !buffer.length) return null;
  for (const signature of MAGIC_SIGNATURES) {
    if (matchesMagicBytes(buffer, signature)) {
      if (signature.mime === 'image/webp') {
        const webpHeader = buffer.slice(8, 12).toString('ascii');
        if (webpHeader !== 'WEBP') return null;
      }
      return signature.mime;
    }
  }
  return null;
}

function validateImageUpload(file) {
  if (!file?.buffer?.length) {
    return { ok: false, message: 'Fichier image requis.' };
  }

  const declaredMime = String(file.mimetype || '').toLowerCase();
  if (!ALLOWED_IMAGE_MIMES.has(declaredMime)) {
    return { ok: false, message: 'Type de fichier non autorisé.' };
  }

  const detectedMime = detectImageMime(file.buffer);
  if (!detectedMime) {
    return { ok: false, message: 'Contenu du fichier image invalide.' };
  }

  if (declaredMime === 'image/jpg' && detectedMime === 'image/jpeg') {
    return { ok: true, mime: detectedMime };
  }

  if (declaredMime !== detectedMime) {
    return { ok: false, message: 'Le contenu du fichier ne correspond pas au type déclaré.' };
  }

  return { ok: true, mime: detectedMime };
}

module.exports = {
  ALLOWED_IMAGE_MIMES,
  validateImageUpload,
};
