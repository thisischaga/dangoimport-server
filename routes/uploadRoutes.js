const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { verifyAdmin } = require('../Middlewares/verifyTokens');
const { uploadBuffer } = require('../utils/cloudinaryUpload');
const { isCloudinaryConfigured } = require('../config/cloudinary');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
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
  const filename = `${folder}_${Date.now()}${ext}`;
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

/** Upload public (sourcing client) — POST /api/upload */
router.post('/', handleMulter, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Fichier image requis (champ "image").' });
  }

  try {
    if (isCloudinaryConfigured) {
      const result = await uploadBuffer(req.file.buffer, {
        public_id: `sourcing_${Date.now()}`,
        folder: 'dangoimport/sourcing',
      });
      return res.json({
        url: result.secure_url,
        publicId: result.public_id,
      });
    }

    const url = await saveLocalUpload(req.file, 'sourcing');
    return res.json({ url });
  } catch (error) {
    console.error('Erreur upload /api/upload:', error);
    return res.status(500).json({
      message: "Erreur lors de l'upload de l'image.",
      error: error.message,
    });
  }
});

/** Upload admin produits — POST /api/upload/product-image */
router.post('/product-image', verifyAdmin, handleMulter, async (req, res) => {
  if (!isCloudinaryConfigured) {
    return res.status(503).json({ message: 'Cloudinary non configuré sur le serveur.' });
  }
  if (!req.file) {
    return res.status(400).json({ message: 'Fichier image requis (champ "image").' });
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
    res.status(500).json({ message: "Erreur lors de l'upload de l'image.", error: error.message });
  }
});

module.exports = router;
