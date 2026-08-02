const express = require('express');
const Store = require('../Models/Store');
const User = require('../Models/User');
const Product = require('../Models/Product');
const Review = require('../Models/Review');
const VendorOrder = require('../Models/VendorOrder');
const cache = require('../utils/cache');

const router = express.Router();

const LIST_EXCLUDE = '-description -specifications -history';

function setPublicCache(res, maxAge = 300) {
  res.set('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=60`);
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Prix affiché : salePrice si promo valide, sinon price */
function effectivePriceExpr() {
  return {
    $cond: [
      {
        $and: [
          { $gt: [{ $ifNull: ['$salePrice', 0] }, 0] },
          { $lt: ['$salePrice', '$price'] },
        ],
      },
      '$salePrice',
      '$price',
    ],
  };
}

async function findStoreByParam(param) {
  const slug = param.trim();
  let store = await Store.findOne({ slug }).lean();
  if (store) return store;

  const decoded = decodeURIComponent(param).replace(/[-_]+/g, ' ').trim();
  store =
    (await Store.findOne({ slug: decoded }).lean()) ||
    (await Store.findOne({ name: new RegExp(`^${escapeRegex(decoded)}$`, 'i') }).lean());
  if (store) return store;

  const vendor = await User.findOne({ vendorName: new RegExp(`^${escapeRegex(decoded)}$`, 'i') }).lean();
  if (vendor) {
    store = await Store.findOne({ userId: vendor._id }).lean();
    if (store) return store;
  }

  return null;
}

function buildProductFilter(store, query) {
  const {
    search,
    category,
    minPrice,
    maxPrice,
    inStock,
    promo,
    isPromo,
    isNew,
    nouveautes,
  } = query;

  const filter = {
    vendorId: store.userId,
    isPublished: true,
    validationStatus: 'approved',
  };

  if (category) filter.category = category;

  const q = typeof search === 'string' ? search.trim() : '';
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: rx }, { brand: rx }, { tags: rx }, { category: rx }];
  }

  if (inStock === 'true') filter.stock = { $gt: 0 };
  if (inStock === 'false') filter.stock = { $lte: 0 };

  const wantPromo = promo === 'true' || isPromo === 'true';
  if (wantPromo) {
    filter.$and = (filter.$and || []).concat([
      {
        $or: [
          { isPromo: true },
          {
            $expr: {
              $and: [
                { $gt: [{ $ifNull: ['$salePrice', 0] }, 0] },
                { $lt: ['$salePrice', '$price'] },
              ],
            },
          },
        ],
      },
    ]);
  }

  const wantNew = isNew === 'true' || nouveautes === 'true';
  if (wantNew) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    filter.$and = (filter.$and || []).concat([
      {
        $or: [{ isNewArrival: true }, { createdAt: { $gte: thirtyDaysAgo } }],
      },
    ]);
  }

  const min = minPrice !== undefined && minPrice !== '' ? parseFloat(minPrice) : null;
  const max = maxPrice !== undefined && maxPrice !== '' ? parseFloat(maxPrice) : null;
  if ((min !== null && !Number.isNaN(min)) || (max !== null && !Number.isNaN(max))) {
    const priceConds = [];
    if (min !== null && !Number.isNaN(min)) priceConds.push({ $gte: ['$$ep', min] });
    if (max !== null && !Number.isNaN(max)) priceConds.push({ $lte: ['$$ep', max] });
    filter.$expr = {
      $let: {
        vars: { ep: effectivePriceExpr() },
        in: { $and: priceConds },
      },
    };
  }

  return filter;
}

function buildSortOption(sort) {
  switch (sort) {
    case 'price-asc':
      return { price: 1, createdAt: -1 };
    case 'price-desc':
      return { price: -1, createdAt: -1 };
    case 'promo':
      return { isPromo: -1, createdAt: -1 };
    case 'name-asc':
      return { name: 1 };
    case 'name-desc':
      return { name: -1 };
    case 'popular':
      return { totalSales: -1, createdAt: -1 };
    case 'newest':
    default:
      return { createdAt: -1 };
  }
}

// GET /api/stores/:slug - store info + aggregated stats
router.get('/:slug', async (req, res) => {
  try {
    const slug = req.params.slug.trim();
    const cacheKey = `store:info:v2:${slug}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      setPublicCache(res, 120);
      return res.json(cached);
    }

    const store = await findStoreByParam(slug);
    if (!store) return res.status(404).json({ success: false, message: 'Boutique introuvable' });

    const user = await User.findById(store.userId).lean();
    const prodFilter = { vendorId: store.userId, isPublished: true, validationStatus: 'approved' };

    const [productCount, categories, deliveredOrders] = await Promise.all([
      Product.countDocuments(prodFilter),
      Product.distinct('category', prodFilter),
      VendorOrder.countDocuments({ storeId: store._id, status: 'delivered' }).catch(() => 0),
    ]);

    const joinedAt = store.createdAt || (user && user.date) || null;

    const payload = {
      success: true,
      data: {
        store,
        seller: user
          ? {
              id: user._id,
              name: user.vendorName || `${user.userFirstname || ''} ${user.userSurname || ''}`.trim(),
              email: user.userEmail,
              phone: user.userPhone,
              profileImage: user.profileImage || user.vendorLogo,
              isVerified: Boolean(user.isVerified),
              createdAt: user.date,
            }
          : null,
        stats: {
          productCount: productCount || 0,
          deliveredOrders: deliveredOrders || 0,
          joinedYear: joinedAt ? new Date(joinedAt).getFullYear() : null,
          categories: (categories || []).filter(Boolean).sort((a, b) => a.localeCompare(b, 'fr')),
        },
      },
    };

    cache.set(cacheKey, payload, 2 * 60 * 1000);
    setPublicCache(res, 120);
    res.json(payload);
  } catch (error) {
    console.error('[storeRoutes] GET /:slug error', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/stores/:slug/products - paginated products with filters & server-side sort
router.get('/:slug/products', async (req, res) => {
  try {
    const { page = 1, limit = 24, sort } = req.query;
    const slug = req.params.slug.trim();

    const store = await findStoreByParam(slug);
    if (!store) return res.status(404).json({ success: false, message: 'Boutique introuvable' });

    const filter = buildProductFilter(store, req.query);
    const sortOption = buildSortOption(sort);

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 24));
    const skip = (pageNum - 1) * limitNum;

    const [products, total] = await Promise.all([
      Product.find(filter)
        .sort(sortOption)
        .skip(skip)
        .limit(limitNum)
        .select(LIST_EXCLUDE)
        .lean(),
      Product.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: products,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.max(1, Math.ceil(total / limitNum)),
        totalItems: total,
        itemsPerPage: limitNum,
      },
    });
  } catch (error) {
    console.error('[storeRoutes] GET /:slug/products error', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/stores/:slug/related - products from other sellers in shared categories
router.get('/:slug/related', async (req, res) => {
  try {
    const slug = req.params.slug.trim();
    const limitNum = Math.min(24, Math.max(1, parseInt(req.query.limit, 10) || 8));

    const store = await findStoreByParam(slug);
    if (!store) return res.status(404).json({ success: false, message: 'Boutique introuvable' });

    const categories = await Product.distinct('category', {
      vendorId: store.userId,
      isPublished: true,
      validationStatus: 'approved',
    });

    if (!categories.length) {
      return res.json({ success: true, data: [] });
    }

    const related = await Product.find({
      category: { $in: categories },
      vendorId: { $ne: store.userId },
      isPublished: true,
      validationStatus: 'approved',
    })
      .sort({ totalSales: -1, createdAt: -1 })
      .limit(limitNum)
      .select(LIST_EXCLUDE)
      .lean();

    setPublicCache(res, 180);
    res.json({ success: true, data: related });
  } catch (error) {
    console.error('[storeRoutes] GET /:slug/related error', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/stores/:slug/reviews - recent reviews across products of the store
router.get('/:slug/reviews', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const slug = req.params.slug.trim();
    const store = await findStoreByParam(slug);
    if (!store) return res.status(404).json({ success: false, message: 'Boutique introuvable' });

    const productIds = await Product.find({ vendorId: store.userId }).select('_id').lean();
    const ids = productIds.map((p) => p._id);

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const [reviews, total] = await Promise.all([
      Review.find({ productId: { $in: ids } })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Review.countDocuments({ productId: { $in: ids } }),
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
    console.error('[storeRoutes] GET /:slug/reviews error', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
