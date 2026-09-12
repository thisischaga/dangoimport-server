const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Product = require('../Models/Product');
const Review = require('../Models/Review');
const verifyToken = require('../Middlewares/verifyTokens');

const escapeRegex = (str = '') => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GET /api/products/featured - Produits en vedette
router.get('/featured', async (req, res) => {
  try {
    const limitNum = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 12));

    // Rechercher d'abord les produits marqués isFeatured = true
    let products = await Product.find({
      isPublished: true,
      validationStatus: { $nin: ['rejected', 'disabled', 'draft', 'archived'] },
      isFeatured: true
    })
      .sort({ createdAt: -1 })
      .limit(limitNum)
      .lean();

    // Si pas assez de produits vedettes, compléter avec les plus récents
    if (products.length < limitNum) {
      const existingIds = products.map(p => p._id);
      const remaining = limitNum - products.length;
      const extra = await Product.find({
        _id: { $nin: existingIds },
        isPublished: true,
        validationStatus: { $nin: ['rejected', 'disabled', 'draft', 'archived'] }
      })
        .sort({ isBestSeller: -1, totalSales: -1, createdAt: -1 })
        .limit(remaining)
        .lean();

      products = [...products, ...extra];
    }

    return res.status(200).json({ success: true, data: products, count: products.length });
  } catch (error) {
    console.error('Erreur GET /api/products/featured :', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur lors de la récupération des produits en vedette' });
  }
});

// GET /api/products/similar/:id - Produits similaires
router.get('/similar/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const limitNum = Math.min(24, Math.max(1, parseInt(req.query.limit, 10) || 8));

    let product = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      product = await Product.findById(id).lean();
    }
    if (!product) {
      product = await Product.findOne({ slug: id }).lean();
    }

    if (!product) {
      return res.status(200).json({ success: true, data: [] });
    }

    const filter = {
      _id: { $ne: product._id },
      isPublished: true,
      validationStatus: { $nin: ['rejected', 'disabled', 'draft', 'archived'] },
    };

    if (product.category) {
      filter.category = product.category;
    }

    const similar = await Product.find(filter)
      .sort({ totalSales: -1, createdAt: -1 })
      .limit(limitNum)
      .lean();

    return res.status(200).json({ success: true, data: similar });
  } catch (error) {
    console.error('Erreur GET /api/products/similar/:id :', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/products/vendor/:vendorName - Produits par vendeur
router.get('/vendor/:vendorName', async (req, res) => {
  try {
    const vendorName = decodeURIComponent(req.params.vendorName || '').trim();
    if (!vendorName) {
      return res.status(200).json({ success: true, data: [] });
    }

    const products = await Product.find({
      vendorName: new RegExp(`^${escapeRegex(vendorName)}$`, 'i'),
      isPublished: true,
      validationStatus: { $nin: ['rejected', 'disabled', 'draft', 'archived'] }
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, data: products, count: products.length });
  } catch (error) {
    console.error('Erreur GET /api/products/vendor/:vendorName :', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/products - Catalogue public des produits avec filtres et pagination
router.get('/', async (req, res) => {
  try {
    const {
      search,
      category,
      brand,
      minPrice,
      maxPrice,
      promo,
      newArrival,
      bestSeller,
      sort,
      page = 1,
      limit = 200
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 200));
    const skip = (pageNum - 1) * limitNum;

    const filter = {
      isPublished: true,
      validationStatus: { $nin: ['rejected', 'disabled', 'draft', 'archived'] }
    };

    if (category && category !== 'Tous') {
      filter.category = category;
    }

    if (brand) {
      filter.brand = new RegExp(escapeRegex(brand), 'i');
    }

    if (promo === 'true') {
      filter.$or = [
        { isPromo: true },
        { salePrice: { $gt: 0 } }
      ];
    }

    if (newArrival === 'true') {
      filter.isNewArrival = true;
    }

    if (bestSeller === 'true') {
      filter.isBestSeller = true;
    }

    const min = parseFloat(minPrice);
    const max = parseFloat(maxPrice);
    if (!isNaN(min) || !isNaN(max)) {
      filter.price = {};
      if (!isNaN(min)) filter.price.$gte = min;
      if (!isNaN(max)) filter.price.$lte = max;
    }

    if (search && typeof search === 'string' && search.trim()) {
      const rx = new RegExp(escapeRegex(search.trim()), 'i');
      filter.$or = [
        { name: rx },
        { brand: rx },
        { category: rx },
        { tags: rx },
        { shortDescription: rx }
      ];
    }

    let sortOption = { createdAt: -1 };
    switch (sort) {
      case 'price_asc':
      case 'price-asc':
        sortOption = { price: 1, createdAt: -1 };
        break;
      case 'price_desc':
      case 'price-desc':
        sortOption = { price: -1, createdAt: -1 };
        break;
      case 'popular':
      case 'sales':
        sortOption = { totalSales: -1, createdAt: -1 };
        break;
      case 'name_asc':
        sortOption = { name: 1 };
        break;
      case 'name_desc':
        sortOption = { name: -1 };
        break;
      default:
        sortOption = { isFeatured: -1, createdAt: -1 };
    }

    const [products, total] = await Promise.all([
      Product.find(filter)
        .sort(sortOption)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Product.countDocuments(filter)
    ]);

    return res.status(200).json({
      success: true,
      data: products,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.max(1, Math.ceil(total / limitNum)),
        totalItems: total,
        itemsPerPage: limitNum
      }
    });
  } catch (error) {
    console.error('Erreur GET /api/products :', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur lors du chargement des produits' });
  }
});

// GET /api/products/:id/reviews - Avis d'un produit
router.get('/:id/reviews', async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(200).json({ success: true, data: [], pagination: { currentPage: 1, totalPages: 1, totalItems: 0 } });
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const [reviews, total] = await Promise.all([
      Review.find({ productId: id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Review.countDocuments({ productId: id })
    ]);

    return res.status(200).json({
      success: true,
      data: reviews,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.max(1, Math.ceil(total / limitNum)),
        totalItems: total
      }
    });
  } catch (error) {
    console.error('Erreur GET /api/products/:id/reviews :', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/products/:id/reviews - Ajouter un avis (auth requise)
router.post('/:id/reviews', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, title, comment } = req.body;
    const userId = req.user?.id || req.user?.userId;
    const userName = `${req.user?.userFirstname || ''} ${req.user?.userSurname || ''}`.trim()
      || req.user?.userEmail
      || 'Acheteur';

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'ID produit invalide' });
    }

    if (!rating || !comment) {
      return res.status(400).json({ message: 'Note et commentaire obligatoires' });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ message: 'Produit introuvable' });
    }

    const existing = await Review.findOne({ productId: id, userId });
    if (existing) {
      return res.status(400).json({ message: 'Vous avez déjà laissé un avis pour ce produit.' });
    }

    const newReview = new Review({
      productId: id,
      userId,
      userName,
      rating: Number(rating),
      title: title || 'Avis client',
      comment,
    });

    await newReview.save();

    // Recalculer la note moyenne du produit
    const reviews = await Review.find({ productId: id }).select('rating').lean();
    const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / (reviews.length || 1);

    product.rating = Math.round(avgRating * 10) / 10;
    product.totalReviews = reviews.length;
    await product.save();

    return res.status(201).json({ success: true, message: 'Avis enregistré avec succès', data: newReview });
  } catch (error) {
    console.error('Erreur POST /api/products/:id/reviews :', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/products/:id - Un seul produit par ID ou Slug
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let product = null;

    if (mongoose.Types.ObjectId.isValid(id)) {
      product = await Product.findById(id).lean();
    }

    if (!product) {
      product = await Product.findOne({ slug: id }).lean();
    }

    if (!product) {
      return res.status(404).json({ success: false, message: 'Produit introuvable' });
    }

    return res.status(200).json({ success: true, data: product, product });
  } catch (error) {
    console.error('Erreur GET /api/products/:id :', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur lors de la récupération du produit' });
  }
});

module.exports = router;
