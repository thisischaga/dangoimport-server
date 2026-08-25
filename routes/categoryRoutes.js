const express = require('express');
const router = express.Router();
const Product = require('../Models/Product');

const slugify = (value = '') =>
  String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// GET /api/categories - derive categories from Product.category values
router.get('/', async (req, res) => {
  try {
    const categories = await Product.aggregate([
      {
        $match: {
          category: { $exists: true, $ne: '' },
          isPublished: true,
        },
      },
      {
        $group: {
          _id: '$category',
          name: { $first: '$category' },
          productCount: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          name: 1,
          slug: {
            $toLower: {
              $replaceAll: {
                input: { $trim: { input: '$_id' } },
                find: ' ',
                replacement: '-',
              },
            },
          },
          productCount: 1,
          description: { $literal: '' },
          image: { $literal: '' },
          banner: { $literal: '' },
        },
      },
      {
        $addFields: {
          slug: {
            $replaceAll: {
              input: '$slug',
              find: 'é',
              replacement: 'e',
            },
          },
        },
      },
      { $sort: { productCount: -1, name: 1 } },
    ]);

    const normalized = categories.map((cat) => ({
      ...cat,
      slug: slugify(cat.name),
      _id: `${slugify(cat.name)}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    }));

    res.json({ data: normalized });
  } catch (err) {
    console.error('GET /api/categories error', err);
    res.status(500).json({ message: 'Erreur serveur lors de la récupération des catégories' });
  }
});

// GET /api/categories/:slug - single category derived from products
router.get('/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;
    const products = await Product.find({ isPublished: true }).select('category').lean();

    const matched = products.find((p) => slugify(p.category) === slug);
    if (!matched) {
      return res.status(404).json({ message: 'Catégorie introuvable' });
    }

    const productCount = await Product.countDocuments({ category: matched.category, isPublished: true });

    res.json({
      data: {
        _id: slug,
        name: matched.category,
        slug,
        description: '',
        image: '',
        banner: '',
        productCount,
      },
    });
  } catch (err) {
    console.error('GET /api/categories/:slug error', err);
    res.status(500).json({ message: 'Erreur serveur lors de la récupération de la catégorie' });
  }
});

// GET /api/categories/:slug/products - products in category with filters
router.get('/:slug/products', async (req, res) => {
  try {
    const { slug } = req.params;
    const products = await Product.find({ isPublished: true }).select('category').lean();
    const matchedCategory = products.find((p) => slugify(p.category) === slug);

    if (!matchedCategory) {
      return res.status(404).json({ message: 'Catégorie introuvable' });
    }

    const {
      search,
      minPrice,
      maxPrice,
      brand,
      seller,
      promo,
      subCategory,
      sort = 'relevance',
      page = 1,
      limit = 20
    } = req.query;

    const match = { category: matchedCategory.category, isPublished: true };
    if (minPrice) match.price = { ...(match.price || {}), $gte: Number(minPrice) };
    if (maxPrice) match.price = { ...(match.price || {}), $lte: Number(maxPrice) };
    if (brand) match.brand = brand;
    if (seller) match.vendorName = seller;
    if (promo === 'true') match.isPromo = true;
    if (subCategory) match.subCategory = subCategory;

    const pipeline = [];
    pipeline.push({ $match: match });

    if (search) {
      pipeline.push({ $match: { $text: { $search: search } } });
    }

    const sortStage = {};
    switch (sort) {
      case 'new': sortStage.createdAt = -1; break;
      case 'sales': sortStage.totalSales = -1; break;
      case 'price_asc': sortStage.price = 1; break;
      case 'price_desc': sortStage.price = -1; break;
      case 'name_asc': sortStage.name = 1; break;
      case 'name_desc': sortStage.name = -1; break;
      default:
        if (search) sortStage.score = { $meta: 'textScore' };
        else sortStage.isFeatured = -1;
    }
    if (Object.keys(sortStage).length > 0) pipeline.push({ $sort: sortStage });

    const pageNum = Math.max(1, Number(page));
    const pageSize = Math.max(1, Math.min(100, Number(limit)));

    pipeline.push({
      $facet: {
        data: [ { $skip: (pageNum - 1) * pageSize }, { $limit: pageSize } ],
        total: [ { $count: 'count' } ]
      }
    });

    const agg = await Product.aggregate(pipeline);
    const productsList = (agg[0] && agg[0].data) || [];
    const total = (agg[0] && agg[0].total && agg[0].total[0] && agg[0].total[0].count) || 0;

    res.json({ data: productsList, meta: { total, page: pageNum, limit: pageSize } });
  } catch (err) {
    console.error('GET /api/categories/:slug/products error', err);
    res.status(500).json({ message: 'Erreur serveur lors de la récupération des produits' });
  }
});

module.exports = router;
