const express = require('express');
const router = express.Router();
const Category = require('../Models/Category');
const Product = require('../Models/Product');

const FALLBACK_CATEGORIES = [
  { name: 'Électronique', slug: 'electronique' },
  { name: 'Mode', slug: 'mode' },
  { name: 'Maison', slug: 'maison' },
  { name: 'Beauté', slug: 'beaute' },
  { name: 'Téléphones', slug: 'telephones' },
  { name: 'Informatique', slug: 'informatique' },
  { name: 'Accessoires', slug: 'accessoires' },
  { name: 'Sport', slug: 'sport' },
  { name: 'Vêtements', slug: 'vetements' }
];

// GET /api/categories - list categories with product counts
router.get('/', async (req, res) => {
  try {
    const categories = await Category.aggregate([
      {
        $lookup: {
          from: 'products',
          localField: 'name',
          foreignField: 'category',
          as: 'products'
        }
      },
      {
        $addFields: { productCount: { $size: { $filter: { input: '$products', as: 'p', cond: { $eq: ['$$p.isPublished', true] } } } } }
      },
      { $project: { products: 0 } },
      { $sort: { productCount: -1, name: 1 } }
    ]);

    if (!categories || categories.length === 0) {
      const fallback = FALLBACK_CATEGORIES.map((cat, index) => ({
        _id: `fallback-${index}-${cat.slug}`,
        name: cat.name,
        slug: cat.slug,
        description: '',
        image: '',
        banner: '',
        seoTitle: '',
        seoDescription: '',
        createdAt: new Date(),
        productCount: 0
      }));

      return res.json({ data: fallback });
    }

    res.json({ data: categories });
  } catch (err) {
    console.error('GET /api/categories error', err);
    res.status(500).json({ message: 'Erreur serveur lors de la récupération des catégories' });
  }
});

// GET /api/categories/:slug - single category
router.get('/:slug', async (req, res) => {
  try {
    const cat = await Category.findOne({ slug: req.params.slug });
    if (!cat) return res.status(404).json({ message: 'Catégorie introuvable' });
    const productCount = await Product.countDocuments({ category: cat.name, isPublished: true });
    res.json({ data: { ...cat.toObject(), productCount } });
  } catch (err) {
    console.error('GET /api/categories/:slug error', err);
    res.status(500).json({ message: 'Erreur serveur lors de la récupération de la catégorie' });
  }
});

// GET /api/categories/:slug/products - products in category with filters
router.get('/:slug/products', async (req, res) => {
  try {
    const { slug } = req.params;
    const cat = await Category.findOne({ slug });
    if (!cat) return res.status(404).json({ message: 'Catégorie introuvable' });

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

    const match = { category: cat.name, isPublished: true };
    if (minPrice) match.price = { ...(match.price || {}), $gte: Number(minPrice) };
    if (maxPrice) match.price = { ...(match.price || {}), $lte: Number(maxPrice) };
    if (brand) match.brand = brand;
    if (seller) match.vendorName = seller;
    if (promo === 'true') match.isPromo = true;
    if (subCategory) match.subCategory = subCategory;

    const pipeline = [];
    pipeline.push({ $match: match });

    // Text search for relevance
    if (search) {
      pipeline.push({ $match: { $text: { $search: search } } });
    }

    // Sorting
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

    // Facet for data + total
    const pageNum = Math.max(1, Number(page));
    const pageSize = Math.max(1, Math.min(100, Number(limit)));

    pipeline.push({
      $facet: {
        data: [ { $skip: (pageNum - 1) * pageSize }, { $limit: pageSize } ],
        total: [ { $count: 'count' } ]
      }
    });

    const agg = await Product.aggregate(pipeline);
    const products = (agg[0] && agg[0].data) || [];
    const total = (agg[0] && agg[0].total && agg[0].total[0] && agg[0].total[0].count) || 0;

    res.json({ data: products, meta: { total, page: pageNum, limit: pageSize } });
  } catch (err) {
    console.error('GET /api/categories/:slug/products error', err);
    res.status(500).json({ message: 'Erreur serveur lors de la récupération des produits' });
  }
});

module.exports = router;
