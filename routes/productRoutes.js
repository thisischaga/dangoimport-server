const express = require('express');
const Product = require('../Models/Product');
const Review = require('../Models/Review');
const verifyToken = require('../Middlewares/verifyTokens');

const router = express.Router();

// GET - Obtenir tous les produits avec pagination et filtres
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 20, category, search, sort, minPrice, maxPrice } = req.query;

        let filter = { isPublished: true };

        if (category) filter.category = category;
        if (minPrice || maxPrice) {
            filter.salePrice = {};
            if (minPrice) filter.salePrice.$gte = parseFloat(minPrice);
            if (maxPrice) filter.salePrice.$lte = parseFloat(maxPrice);
        }
        if (search) {
            filter.$text = { $search: search };
        }

        let sortOption = {};
        if (sort === 'price-asc') sortOption.salePrice = 1;
        else if (sort === 'price-desc') sortOption.salePrice = -1;
        else if (sort === 'newest') sortOption.createdAt = -1;
        else if (sort === 'popular') sortOption.totalSales = -1;
        else sortOption.createdAt = -1;

        const skip = (page - 1) * limit;

        const products = await Product.find(filter)
            .sort(sortOption)
            .skip(skip)
            .limit(parseInt(limit))
            .select('-reviews');

        const total = await Product.countDocuments(filter);

        res.json({
            success: true,
            data: products,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit),
                totalItems: total,
                itemsPerPage: parseInt(limit)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET - Produits en vedette
router.get('/featured', async (req, res) => {
    try {
        const products = await Product.find({ isFeatured: true, isPublished: true })
            .limit(12)
            .select('-reviews');
        res.json({ success: true, data: products });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET - Produits similaires
router.get('/similar/:id', async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ success: false, message: 'Produit non trouvé' });
        }

        const similar = await Product.find({
            category: product.category,
            _id: { $ne: product._id },
            isPublished: true
        })
            .limit(6)
            .select('-reviews');

        res.json({ success: true, data: similar });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET - Détails du produit
router.get('/:id', async (req, res) => {
    try {
        const product = await Product.findById(req.params.id)
            .populate('reviews');

        if (!product) {
            return res.status(404).json({ success: false, message: 'Produit non trouvé' });
        }

        res.json({ success: true, data: product });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET - Avis du produit
router.get('/:id/reviews', async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const skip = (page - 1) * limit;

        const reviews = await Review.find({ productId: req.params.id })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Review.countDocuments({ productId: req.params.id });

        res.json({
            success: true,
            data: reviews,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit),
                totalItems: total
            }
        });
    } catch (error) {
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
            verified: true
        });

        await review.save();

        // Mettre à jour la note moyenne du produit
        const product = await Product.findById(req.params.id);
        const allReviews = await Review.find({ productId: req.params.id });
        const avgRating = allReviews.reduce((sum, rev) => sum + rev.rating, 0) / allReviews.length;

        product.rating = parseFloat(avgRating.toFixed(1));
        product.totalReviews = allReviews.length;
        await product.save();

        res.json({ success: true, message: 'Avis ajouté', data: review });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
