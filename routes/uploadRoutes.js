const express = require('express');
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

router.post('/product-image', verifyAdmin, (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message || 'Fichier image invalide.' });
    }
    next();
  });
}, async (req, res) => {
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
    res.status(500).json({ message: 'Erreur lors de l\'upload de l\'image.', error: error.message });
  }
});

module.exports = router;
