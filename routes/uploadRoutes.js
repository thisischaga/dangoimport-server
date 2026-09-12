const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const verifyToken = require('../Middlewares/verifyTokens');
const { verifyAdmin } = require('../Middlewares/verifyTokens');
const { uploadLimiter } = require('../Middlewares/rateLimiters');
const { uploadBuffer } = require('../utils/cloudinaryUpload');
const { isCloudinaryConfigured } = require('../config/cloudinary');
const { validateImageUpload } = require('../utils/uploadValidation');
const { sendServerError } = require('../utils/apiError');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype?.startsWith('image/')) {
      return cb(new Error('Seules les images sont acceptées.'));
    }
    cb(null, true);
  },
});

async function saveLocalUpload(file, folder = 'sourcing') {
  const uploadDir = path.join(__dirname, '../public/uploads', folder);
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  const ext = path.extname(file.originalname || '') || '.jpg';
  const filename = `${folder}_${Date.now()}${ext.replace(/[^a-zA-Z0-9.]/g, '')}`;
  fs.writeFileSync(path.join(uploadDir, filename), file.buffer);
  const apiBase = (process.env.API_BASE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
  if (apiBase) {
    return `${apiBase}/uploads/${folder}/${filename}`;
  }
  return `/uploads/${folder}/${filename}`;
}

function handleMulter(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message || 'Fichier image invalide.' });
    }
    next();
  });
}

function validateUploadedFile(req, res, next) {
  if (!req.file) {
    return res.status(400).json({ message: 'Fichier image requis (champ "image").' });
  }
  const validation = validateImageUpload(req.file);
  if (!validation.ok) {
    return res.status(400).json({ message: validation.message });
  }
  next();
}

router.post('/', uploadLimiter, verifyToken, handleMulter, validateUploadedFile, async (req, res) => {
  try {
    if (isCloudinaryConfigured) {
      const result = await uploadBuffer(req.file.buffer, {
        public_id: `upload_${Date.now()}`,
        folder: 'dangoimport/uploads',
      });
      return res.json({
        url: result.secure_url,
        publicId: result.public_id,
      });
    }

    const url = await saveLocalUpload(req.file, 'uploads');
    return res.json({ url });
  } catch (error) {
    console.error('Erreur upload /api/upload:', error);
    return sendServerError(res, error, "Erreur lors de l'upload de l'image.");
  }
});

router.post('/product-image', uploadLimiter, verifyAdmin, handleMulter, validateUploadedFile, async (req, res) => {
  if (!isCloudinaryConfigured) {
    return res.status(503).json({ message: 'Cloudinary non configuré sur le serveur.' });
  }

  try {
    const result = await uploadBuffer(req.file.buffer, {
      public_id: `product_${Date.now()}`,
    });
    res.json({
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
    });
  } catch (error) {
    console.error('Erreur upload Cloudinary:', error);
    return sendServerError(res, error, "Erreur lors de l'upload de l'image.");
  }
});

module.exports = router;
