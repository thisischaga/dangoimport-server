const cloudinary = require('../config/cloudinary');
const { isCloudinaryConfigured } = require('../config/cloudinary');

const FOLDER = 'dangoimport/products';

function ensureConfigured() {
  if (!isCloudinaryConfigured) {
    throw new Error('Cloudinary non configuré (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET).');
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

module.exports = { uploadBuffer, uploadDataUrl, FOLDER };
