const express = require('express');
const Store = require('../Models/Store');
const User = require('../Models/User');
const Product = require('../Models/Product');
const Review = require('../Models/Review');
const cache = require('../utils/cache');

const router = express.Router();

function setPublicCache(res, maxAge = 300) {
  res.set('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=60`);
}

// GET /api/stores/:slug - store info + aggregated stats
router.get('/:slug', async (req, res) => {
  try {
    const slug = req.params.slug.trim();
    const cacheKey = `store:info:${slug}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      setPublicCache(res, 120);
      return res.json(cached);
    }

    let store = await Store.findOne({ slug }).lean();
    // Fallback: try matching by decoded name or vendorName if slug not found
    if (!store) {
      const decoded = decodeURIComponent(slug).replace(/[-_]+/g, ' ').trim();
      store = await Store.findOne({ slug: decoded }).lean() || await Store.findOne({ name: new RegExp(`^${decoded}$`, 'i') }).lean();
    }
    if (!store) {
      // Try to find a user/vendor by vendorName and resolve their store
      const vendor = await User.findOne({ vendorName: new RegExp(`^${decodeURIComponent(slug)}$`, 'i') }).lean();
      if (vendor) store = await Store.findOne({ userId: vendor._id }).lean();
    }

    if (!store) return res.status(404).json({ success: false, message: 'Boutique introuvable' });

    const user = await User.findById(store.userId).lean();

    // Aggregate product stats for this store
    const prodFilter = { vendorId: store.userId, isPublished: true, validationStatus: 'approved' };

    const [productCount, totalSalesAgg, ratingAgg, categories] = await Promise.all([
      Product.countDocuments(prodFilter),
      Product.aggregate([
        { $match: prodFilter },
        { $group: { _id: null, totalSales: { $sum: '$totalSales' } } }
      ]),
      Product.aggregate([
        { $match: prodFilter },
        { $group: { _id: null, avgRating: { $avg: '$rating' }, totalReviews: { $sum: '$totalReviews' } } }
      ]),
      Product.distinct('category', prodFilter),
    ]);

    const payload = {
      success: true,
      data: {
        store,
        seller: user ? {
          id: user._id,
          name: user.vendorName || `${user.userFirstname} ${user.userSurname}`.trim(),
          email: user.userEmail,
          phone: user.userPhone,
          profileImage: user.profileImage || user.vendorLogo,
          isVerified: user.isVerified,
          createdAt: user.date,
        } : null,
        stats: {
          productCount: productCount || 0,
          totalSales: (totalSalesAgg[0] && totalSalesAgg[0].totalSales) || 0,
          avgRating: ratingAgg[0] ? Number((ratingAgg[0].avgRating || 0).toFixed(1)) : 0,
          totalReviews: ratingAgg[0] ? (ratingAgg[0].totalReviews || 0) : 0,
          categories: categories || [],
        }
      }
    };

    cache.set(cacheKey, payload, 2 * 60 * 1000);
    setPublicCache(res, 120);
    res.json(payload);
  } catch (error) {
    console.error('[storeRoutes] GET /:slug error', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/stores/:slug/products - paginated products for store with server-side sorting/filters
router.get('/:slug/products', async (req, res) => {
  try {
    const { page = 1, limit = 24, search, sort, category, minPrice, maxPrice, inStock } = req.query;
    const slug = req.params.slug.trim();

    const store = await Store.findOne({ slug }).lean();
    if (!store) return res.status(404).json({ success: false, message: 'Boutique introuvable' });

    const filter = { vendorId: store.userId, isPublished: true, validationStatus: 'approved' };
    if (category) filter.category = category;
    if (search) filter.$text = { $search: search };
    if (minPrice || maxPrice) {
      filter.salePrice = {};
      if (minPrice) filter.salePrice.$gte = parseFloat(minPrice);
      if (maxPrice) filter.salePrice.$lte = parseFloat(maxPrice);
    }
    if (inStock === 'true') filter.stock = { $gt: 0 };

    const sortOption = {};
    if (sort === 'price-asc') sortOption.salePrice = 1;
    else if (sort === 'price-desc') sortOption.salePrice = -1;
    else if (sort === 'popular') sortOption.totalSales = -1;
    else if (sort === 'newest') sortOption.createdAt = -1;
    else if (sort === 'promo') sortOption.isPromo = -1;
    else if (sort === 'top-rated') sortOption.rating = -1;
    else sortOption.createdAt = -1;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 24));
    const skip = (pageNum - 1) * limitNum;

    const [products, total] = await Promise.all([
      Product.find(filter).sort(sortOption).skip(skip).limit(limitNum).select('-description -specifications -history').lean(),
      Product.countDocuments(filter),
    ]);

    res.json({ success: true, data: products, pagination: { currentPage: pageNum, totalPages: Math.ceil(total / limitNum), totalItems: total, itemsPerPage: limitNum } });
  } catch (error) {
    console.error('[storeRoutes] GET /:slug/products error', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/stores/:slug/reviews - recent reviews across products of the store
router.get('/:slug/reviews', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const slug = req.params.slug.trim();
    const store = await Store.findOne({ slug }).lean();
    if (!store) return res.status(404).json({ success: false, message: 'Boutique introuvable' });

    // Find products for store
    const productIds = await Product.find({ vendorId: store.userId }).select('_id').lean();
    const ids = productIds.map(p => p._id);

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const [reviews, total] = await Promise.all([
      Review.find({ productId: { $in: ids } }).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Review.countDocuments({ productId: { $in: ids } }),
    ]);

    res.json({ success: true, data: reviews, pagination: { currentPage: pageNum, totalPages: Math.ceil(total / limitNum), totalItems: total } });
  } catch (error) {
    console.error('[storeRoutes] GET /:slug/reviews error', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
