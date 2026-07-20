const express = require('express');
const Product = require('../Models/Product');
const Review = require('../Models/Review');
const verifyToken = require('../Middlewares/verifyTokens');
const cache = require('../utils/cache');

const router = express.Router();

const LIST_FIELDS = [
  'name', 'salePrice', 'price', 'category', 'subcategory', 'images', 'image',
  'rating', 'totalReviews', 'isFeatured', 'isNewArrival', 'vendorName', 'stock',
  'createdAt', 'isPublished', 'brand', 'shortDescription', 'totalSales', 'date',
].join(' ');

const CACHE_TTL = 5 * 60 * 1000;

// GET - Tous les produits pour l'admin (y compris non publiés)
router.get('/admin/all', verifyToken, async (req, res) => {
  try {
    if (req.user?.role !== 'admin' && req.user?.role !== 'dev-admin') {
      return res.status(403).json({ success: false, message: 'Accès refusé' });
    }

    const products = await Product.find()
      .sort({ createdAt: -1 })
      .select(LIST_FIELDS)
      .lean();

    res.json({ success: true, data: products });
  } catch (error) {
    console.error('[productRoutes.js] Erreur capturée :', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function setPublicCache(res, maxAge = 300) {
  res.set('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=60`);
}

// GET - Catalogue paginé
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, category, search, sort, minPrice, maxPrice } = req.query;
    const cacheKey = `products:list:${JSON.stringify(req.query)}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      setPublicCache(res);
      return res.json(cached);
    }

    const filter = { isPublished: true };

    if (category) filter.category = category;
    if (minPrice || maxPrice) {
      filter.salePrice = {};
      if (minPrice) filter.salePrice.$gte = parseFloat(minPrice);
      if (maxPrice) filter.salePrice.$lte = parseFloat(maxPrice);
    }
    if (search) {
      filter.$text = { $search: search };
    }

    const sortOption = {};
    if (sort === 'price-asc') sortOption.salePrice = 1;
    else if (sort === 'price-desc') sortOption.salePrice = -1;
    else if (sort === 'popular') sortOption.totalSales = -1;
    else sortOption.createdAt = -1;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [products, total] = await Promise.all([
      Product.find(filter)
        .sort(sortOption)
        .skip(skip)
        .limit(limitNum)
        .select(LIST_FIELDS)
        .lean(),
      Product.countDocuments(filter),
    ]);

    const payload = {
      success: true,
      data: products,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: limitNum,
      },
    };

    cache.set(cacheKey, payload, CACHE_TTL);
    setPublicCache(res);
    res.json(payload);
  } catch (error) {
    console.error("[productRoutes.js] Erreur capturée :", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET - Produits en vedette
router.get('/featured', async (req, res) => {
  try {
    const cacheKey = 'products:featured';
    const cached = cache.get(cacheKey);
    if (cached) {
      setPublicCache(res, 600);
      return res.json(cached);
    }

    const products = await Product.find({ isFeatured: true, isPublished: true })
      .limit(12)
      .select(LIST_FIELDS)
      .lean();

    const payload = { success: true, data: products };
    cache.set(cacheKey, payload, CACHE_TTL);
    setPublicCache(res, 600);
    res.json(payload);
  } catch (error) {
    console.error("[productRoutes.js] Erreur capturée :", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET - Produits par vendeur
router.get('/vendor/:vendorName', async (req, res) => {
  try {
    const vendorName = decodeURIComponent(req.params.vendorName).trim();
    const cacheKey = `products:vendor:${vendorName.toLowerCase()}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      setPublicCache(res);
      return res.json(cached);
    }

    const products = await Product.find({
      vendorName: { $regex: new RegExp(`^${escapeRegex(vendorName)}$`, 'i') },
      isPublished: true,
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .select(LIST_FIELDS)
      .lean();

    const payload = { success: true, data: products };
    cache.set(cacheKey, payload, CACHE_TTL);
    setPublicCache(res);
    res.json(payload);
  } catch (error) {
    console.error("[productRoutes.js] Erreur capturée :", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET - Produits similaires
router.get('/similar/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).select('category').lean();
    if (!product) {
      return res.status(404).json({ success: false, message: 'Produit non trouvé' });
    }

    const similar = await Product.find({
      category: product.category,
      _id: { $ne: req.params.id },
      isPublished: true,
    })
      .limit(6)
      .select(LIST_FIELDS)
      .lean();

    setPublicCache(res);
    res.json({ success: true, data: similar });
  } catch (error) {
    console.error("[productRoutes.js] Erreur capturée :", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET - Détails du produit
router.get('/:id', async (req, res) => {
  try {
    const cacheKey = `products:detail:${req.params.id}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      setPublicCache(res, 120);
      return res.json(cached);
    }

    const product = await Product.findById(req.params.id).lean();

    if (!product) {
      return res.status(404).json({ success: false, message: 'Produit non trouvé' });
    }

    const payload = { success: true, data: product };
    cache.set(cacheKey, payload, 2 * 60 * 1000);
    setPublicCache(res, 120);
    res.json(payload);
  } catch (error) {
    console.error("[productRoutes.js] Erreur capturée :", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET - Avis du produit
router.get('/:id/reviews', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const [reviews, total] = await Promise.all([
      Review.find({ productId: req.params.id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Review.countDocuments({ productId: req.params.id }),
    ]);

    res.json({
      success: true,
      data: reviews,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
      },
    });
  } catch (error) {
    console.error("[productRoutes.js] Erreur capturée :", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST - Ajouter un avis
router.post('/:id/reviews', verifyToken, async (req, res) => {
  try {
    const { rating, title, comment, images } = req.body;

    const review = new Review({
      productId: req.params.id,
      userId: req.user.id,
      userName: req.user.userFirstname,
      rating,
      title,
      comment,
      images,
      verified: true,
    });

    await review.save();

    const stats = await Review.aggregate([
      { $match: { productId: review.productId } },
      {
        $group: {
          _id: '$productId',
          avgRating: { $avg: '$rating' },
          total: { $sum: 1 },
        },
      },
    ]);

    if (stats[0]) {
      await Product.findByIdAndUpdate(req.params.id, {
        rating: parseFloat(stats[0].avgRating.toFixed(1)),
        totalReviews: stats[0].total,
      });
    }

    cache.delPrefix('products:');
    res.json({ success: true, message: 'Avis ajouté', data: review });
  } catch (error) {
    console.error("[productRoutes.js] Erreur capturée :", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
