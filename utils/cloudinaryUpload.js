const cloudinary = require('../config/cloudinary');
const { isCloudinaryConfigured } = require('../config/cloudinary');

const FOLDER = 'dangoimport/products';
const REMOTE_FETCH_TIMEOUT_MS = Math.max(5000, Number(process.env.CLOUDINARY_REMOTE_TIMEOUT_MS) || 25000);

function ensureConfigured() {
  if (!isCloudinaryConfigured) {
    throw new Error('Cloudinary non configuré (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET).');
  }
}

function describeCloudinaryError(error) {
  if (!error) return 'erreur inconnue';
  if (typeof error === 'string') return error;
  const nested = error.error?.message || error.error?.error?.message;
  const parts = [
    error.message,
    nested,
    error.http_code != null ? `http_code=${error.http_code}` : null,
    error.name && error.name !== 'Error' ? error.name : null,
  ].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  try {
    return JSON.stringify(error).slice(0, 240);
  } catch {
    return String(error);
  }
}

async function fetchImageBuffer(remoteUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(remoteUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        Accept: 'image/*,*/*;q=0.8',
        'User-Agent': 'DangoImport-CJ-Mirror/1.0',
      },
    });
    if (!response.ok) {
      throw new Error(`Téléchargement image HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType && !contentType.startsWith('image/') && !contentType.includes('octet-stream')) {
      throw new Error(`Type MIME inattendu: ${contentType}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.length) {
      throw new Error('Image distante vide');
    }
    if (buffer.length > 12 * 1024 * 1024) {
      throw new Error('Image distante trop volumineuse (>12 Mo)');
    }
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

function uploadBuffer(buffer, options = {}) {
  ensureConfigured();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: FOLDER,
        resource_type: 'image',
        ...options,
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    stream.end(buffer);
  });
}

async function uploadDataUrl(dataUrl, options = {}) {
  ensureConfigured();
  const result = await cloudinary.uploader.upload(dataUrl, {
    folder: FOLDER,
    resource_type: 'image',
    ...options,
  });
  return result.secure_url;
}

async function uploadRemoteUrl(remoteUrl, options = {}) {
  ensureConfigured();
  const uploadOptions = {
    folder: options.folder || FOLDER,
    resource_type: 'image',
    fetch_format: 'auto',
    quality: 'auto',
    ...options,
  };

  let lastError = null;
  try {
    const result = await cloudinary.uploader.upload(remoteUrl, uploadOptions);
    if (result?.secure_url) return result.secure_url;
    lastError = new Error('Réponse Cloudinary sans secure_url');
  } catch (error) {
    lastError = error;
  }

  try {
    const buffer = await fetchImageBuffer(remoteUrl);
    const streamed = await uploadBuffer(buffer, uploadOptions);
    if (streamed?.secure_url) return streamed.secure_url;
    throw new Error('Upload buffer Cloudinary sans secure_url');
  } catch (fallbackError) {
    const primary = describeCloudinaryError(lastError);
    const secondary = describeCloudinaryError(fallbackError);
    const err = new Error(`Cloudinary mirror: ${primary} | fallback: ${secondary}`);
    err.cause = fallbackError;
    throw err;
  }
}

module.exports = {
  uploadBuffer,
  uploadDataUrl,
  uploadRemoteUrl,
  describeCloudinaryError,
  FOLDER,
};
