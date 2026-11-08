const express = require('express');
const mongoose = require('mongoose');
const AlibabaProduct = require('../Models/AlibabaProduct');
const { toPublicProduct, toPublicProductDetail } = require('../utils/publicProduct');

const router = express.Router();

// ─────────────────────────────────────────────
// Migration au démarrage : publier automatiquement TOUS les produits Alibaba
// qui ne sont pas en erreur (sans bloquer le démarrage du serveur)
// ─────────────────────────────────────────────
(async () => {
  try {
    const result = await AlibabaProduct.updateMany(
      {},
      {
        $set: {
          isPublished: true,
          publicationStatus: 'published',
        },
      },
    );
    await AlibabaProduct.updateMany(
      { status: { $in: ['ERROR', 'SYNC_ERROR'] } },
      { $set: { status: 'SYNCED' } },
    );
    if (result.modifiedCount > 0) {
      console.log(`[productRoutes] Migration: ${result.modifiedCount} produit(s) Alibaba publiés automatiquement.`);
    }
  } catch (err) {
    console.error('[productRoutes] Migration isPublished error:', err.message);
  }
})();

function escapeRegExp(string) {
  return String(string || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Filtre de base pour les produits publics Alibaba :
 * Par défaut (aucun paramètre), retourne TOUS les produits ({}) pour affichage direct sur la boutique.
 */
function getPublicCatalogFilter(query = {}) {
  const conditions = [];

  // Exclure seulement les produits explicitement dépubliés si demandé
  if (query.published === 'false') {
    conditions.push({ isPublished: false });
  } else if (query.published === 'true') {
    conditions.push({ isPublished: true });
  }

  // Filtre par catégorie
  if (query.category && String(query.category).trim() !== '' && query.category !== 'all') {
    const catStr = String(query.category).trim();
    conditions.push({
      $or: [
        { category: new RegExp(`^${escapeRegExp(catStr)}$`, 'i') },
        { 'normalized.category': new RegExp(`^${escapeRegExp(catStr)}$`, 'i') },
        { 'rawAlibabaData.result_data.category': new RegExp(`^${escapeRegExp(catStr)}$`, 'i') },
      ],
    });
  }

  // Filtre par marque
  if (query.brand && String(query.brand).trim()) {
    conditions.push({
      brand: new RegExp(escapeRegExp(String(query.brand).trim()), 'i'),
    });
  }

  // Filtre par recherche textuelle (q ou search)
  const searchTerm = String(query.search || query.q || '').trim();
  if (searchTerm) {
    const searchRegex = new RegExp(escapeRegExp(searchTerm), 'i');
    conditions.push({
      $or: [
        { name: searchRegex },
        { title: searchRegex },
        { 'normalized.name': searchRegex },
        { sourceProductId: searchRegex },
        { externalProductId: searchRegex },
        { category: searchRegex },
        { brand: searchRegex },
        { description: searchRegex },
      ],
    });
  }

  if (conditions.length === 0) return {};
  if (conditions.length === 1) return conditions[0];
  return { $and: conditions };
}

/**
 * Résout les options de tri MongoDB
 */
function getSortOptions(sortKey = 'recent') {
  switch (String(sortKey).toLowerCase()) {
    case 'price_asc':
    case 'price-asc':
      return { 'pricing.sourcePrice': 1, 'variants.pricing.price': 1, price: 1 };
    case 'price_desc':
    case 'price-desc':
      return { 'pricing.sourcePrice': -1, 'variants.pricing.price': -1, price: -1 };
    case 'name':
    case 'name_asc':
      return { name: 1, title: 1 };
    case 'oldest':
      return { createdAt: 1 };
    case 'popular':
    case 'rating':
      return { rating: -1, updatedAt: -1 };
    case 'newest':
    case 'recent':
    case 'updated':
    default:
      return { updatedAt: -1, createdAt: -1 };
  }
}

// ─────────────────────────────────────────────
// 1. GET /api/products : Liste du catalogue public
// ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;

    const filter = getPublicCatalogFilter(req.query);
    const sort = getSortOptions(req.query.sort);

    const [total, rawProducts] = await Promise.all([
      AlibabaProduct.countDocuments(filter),
      AlibabaProduct.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    // Auto-publication continue : s'assurer que les produits Alibaba sont visibles
    AlibabaProduct.updateMany(
      { isPublished: { $ne: true } },
      { $set: { isPublished: true, publicationStatus: 'published' } }
    ).catch(() => {});

    const products = rawProducts.map((doc) => {
      try {
        const pub = toPublicProduct(doc);
        return pub || doc;
      } catch (err) {
        console.error('[productRoutes] Error formatting doc:', err);
        return doc;
      }
    }).filter(Boolean);
    return res.json({
      success: true,
      count: products.length,
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
      data: products,
      products,
    });
    
  } catch (error) {
    console.error('[productRoutes] GET / error:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des produits.',
      error: error.message,
    });
  }
});

// ─────────────────────────────────────────────
// 2. GET /api/products/featured : Sélection de produits phares
// ─────────────────────────────────────────────
router.get('/featured', async (req, res) => {
  try {
    const limit = Math.min(24, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const filter = getPublicCatalogFilter(req.query);

    const rawProducts = await AlibabaProduct.find(filter)
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();

    const products = rawProducts.map((doc) => toPublicProduct(doc)).filter(Boolean);

    return res.json({
      success: true,
      count: products.length,
      data: products,
      products,
    });
  } catch (error) {
    console.error('[productRoutes] GET /featured error:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des produits phares.',
    });
  }
});

// ─────────────────────────────────────────────
// 3. GET /api/products/categories : Liste des catégories uniques
// ─────────────────────────────────────────────
router.get('/categories', async (req, res) => {
  try {
    const rawCategories = await AlibabaProduct.distinct('category', {
      category: { $nin: [null, ''] },
    });

    const normalizedRaw = await AlibabaProduct.distinct('normalized.category', {
      'normalized.category': { $nin: [null, ''] },
    });

    const set = new Set([...rawCategories, ...normalizedRaw].map((c) => String(c || '').trim()).filter(Boolean));
    const categories = Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'));

    return res.json({
      success: true,
      data: categories,
      categories,
    });
  } catch (error) {
    console.error('[productRoutes] GET /categories error:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des catégories.',
    });
  }
});

// ─────────────────────────────────────────────
// 4. GET /api/products/similar/:id : Produits similaires
// ─────────────────────────────────────────────
router.get('/similar/:id', async (req, res) => {
  try {
    const rawId = String(req.params.id || '').trim();
    const query = mongoose.Types.ObjectId.isValid(rawId)
      ? { _id: rawId }
      : { $or: [{ sourceProductId: rawId }, { externalProductId: rawId }, { slug: rawId }] };

    const target = await AlibabaProduct.findOne(query).lean();
    if (!target) {
      return res.json({ success: true, data: [], products: [] });
    }

    const category = target.category || target.normalized?.category;
    const filter = {
      _id: { $ne: target._id },
      category: category ? new RegExp(`^${escapeRegExp(category)}$`, 'i') : { $exists: true },
      status: { $ne: 'ERROR' },
    };

    const rawSimilar = await AlibabaProduct.find(filter)
      .sort({ updatedAt: -1 })
      .limit(8)
      .lean();

    const similar = rawSimilar.map((doc) => toPublicProduct(doc)).filter(Boolean);

    return res.json({
      success: true,
      data: similar,
      products: similar,
    });
  } catch (error) {
    console.error('[productRoutes] GET /similar/:id error:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des produits similaires.',
    });
  }
});

// ─────────────────────────────────────────────
// 5. GET /api/products/vendor/:vendorName : Produits d'un fournisseur / usine
// ─────────────────────────────────────────────
router.get('/vendor/:vendorName', async (req, res) => {
  try {
    const vendorName = decodeURIComponent(req.params.vendorName || '').trim();
    const regex = new RegExp(`^${escapeRegExp(vendorName)}$`, 'i');

    const filter = {
      $or: [
        { vendorName: regex },
        { brand: regex },
        { 'rawPayload.result_data.supplier': regex },
        { 'pricing.raw.supplier': regex },
      ],
      status: { $ne: 'ERROR' },
    };

    const rawProducts = await AlibabaProduct.find(filter)
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();

    const products = rawProducts.map((doc) => toPublicProduct(doc)).filter(Boolean);

    return res.json({
      success: true,
      data: products,
      products,
    });
  } catch (error) {
    console.error('[productRoutes] GET /vendor/:vendorName error:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des produits du fournisseur.',
    });
  }
});

// ─────────────────────────────────────────────
// 6. GET /api/products/slug/:slug : Produit par slug
// ─────────────────────────────────────────────
router.get('/slug/:slug', async (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim();
    const product = await AlibabaProduct.findOne({
      $or: [
        { slug },
        { 'normalized.slug': slug },
        { sourceProductId: slug },
        { externalProductId: slug },
      ],
    }).lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Produit introuvable.',
      });
    }

    const detail = await toPublicProductDetail(product);
    return res.json({
      success: true,
      data: detail,
      product: detail,
    });
  } catch (error) {
    console.error('[productRoutes] GET /slug/:slug error:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du produit.',
    });
  }
});

// ─────────────────────────────────────────────
// 7. GET /api/products/:id/reviews : Avis clients
// ─────────────────────────────────────────────
router.get('/:id/reviews', async (req, res) => {
  return res.json({
    success: true,
    data: [],
    reviews: [],
    pagination: {
      total: 0,
      page: 1,
      pages: 1,
      limit: 10,
    },
  });
});

// ─────────────────────────────────────────────
// 8. PATCH /api/products/:id/visibility : Gestion publication et visibilité
// ─────────────────────────────────────────────
router.patch('/:id/visibility', async (req, res) => {
  try {
    const rawId = String(req.params.id || '').trim();
    const query = mongoose.Types.ObjectId.isValid(rawId)
      ? { _id: rawId }
      : { $or: [{ sourceProductId: rawId }, { externalProductId: rawId }] };

    const update = {};
    if (req.body.isPublished !== undefined) {
      update.isPublished = Boolean(req.body.isPublished);
      update.publicationStatus = req.body.isPublished ? 'published' : 'draft';
    }
    if (req.body.status !== undefined) {
      update.status = String(req.body.status).toUpperCase();
    }

    const updated = await AlibabaProduct.findOneAndUpdate(query, { $set: update }, { new: true }).lean();
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Produit Alibaba introuvable.' });
    }

    return res.json({
      success: true,
      message: 'Visibilité mise à jour avec succès.',
      data: toPublicProduct(updated),
    });
  } catch (error) {
    console.error('[productRoutes] PATCH /:id/visibility error:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la mise à jour de la visibilité.',
    });
  }
});

// ─────────────────────────────────────────────
// 9. GET /api/products/:id : Détail produit par ID MongoDB ou ID Alibaba
// ─────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const rawId = String(req.params.id || '').trim();
    if (!rawId) {
      return res.status(404).json({ success: false, message: 'ID produit manquant.' });
    }

    const cleanId = rawId.replace(/^alibaba:/i, '');
    const numId = !isNaN(Number(cleanId)) ? Number(cleanId) : null;

    let product = null;

    // 1. Recherche par _id MongoDB (strictement 24 caractères hexadécimaux)
    if (/^[0-9a-fA-F]{24}$/.test(rawId)) {
      try {
        product = await AlibabaProduct.findById(rawId).lean();
      } catch (e) {}
    }

    // 2. Recherche par tous les identifiants possibles (sourceProductId, externalProductId, slug, etc.)
    if (!product) {
      const orConditions = [
        { sourceProductId: rawId },
        { sourceProductId: cleanId },
        { externalProductId: rawId },
        { externalProductId: cleanId },
        { externalProductId: `alibaba:${cleanId}` },
        { slug: rawId },
        { slug: cleanId },
        { 'normalized.slug': rawId },
        { 'normalized.slug': cleanId },
        { 'rawPayload.product_id': rawId },
        { 'rawPayload.result_data.product_id': rawId },
      ];
      if (numId !== null) {
        orConditions.push(
          { sourceProductId: numId },
          { externalProductId: numId },
          { 'rawPayload.product_id': numId },
          { 'rawPayload.result_data.product_id': numId },
        );
      }
      product = await AlibabaProduct.findOne({ $or: orConditions }).lean();
    }

    if (!product) {
      console.warn(`[productRoutes] GET /api/products/${rawId} : Produit introuvable.`);
      return res.status(404).json({
        success: false,
        message: 'Produit introuvable.',
      });
    }

    let detail = null;
    try {
      detail = await toPublicProductDetail(product);
    } catch (formatErr) {
      console.error('[productRoutes] Erreur toPublicProductDetail, fallback produit brut:', formatErr);
      detail = toPublicProduct(product) || product;
    }

    return res.json({
      success: true,
      data: detail,
      product: detail,
    });
  } catch (error) {
    console.error('[productRoutes] GET /:id error:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du détail produit.',
      error: error.message,
    });
  }
});

module.exports = router;
