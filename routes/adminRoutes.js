const express = require('express');
const Product = require('../Models/Product');
const Promotion = require('../Models/Promotion');
const verifyToken = require('../Middlewares/verifyTokens');

const router = express.Router();

// Middleware pour vérifier l'accès admin
const adminOnly = (req, res, next) => {
    if (req.user.role !== 'admin' && req.user.role !== 'dev-admin') {
        return res.status(403).json({ success: false, message: 'Accès refusé' });
    }
    next();
};

// POST - Créer un produit
router.post('/products', verifyToken, adminOnly, async (req, res) => {
    try {
        const productData = { ...req.body };
        
        // Générer slug si non fourni
        if (!productData.slug && productData.name) {
            productData.slug = productData.name.toLowerCase().replace(/\s+/g, '-');
        }

        if (!productData.vendorId) {
            productData.vendorId = req.user.userId || req.user.id;
        }

        const product = new Product(productData);
        await product.save();

        res.json({ success: true, message: 'Produit créé', data: product });
    } catch (error) {
        console.error("Erreur POST /api/admin/products:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// PUT - Mettre à jour un produit
router.put('/products/:id', verifyToken, adminOnly, async (req, res) => {
    try {
        const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });

        if (!product) {
            return res.status(404).json({ success: false, message: 'Produit non trouvé' });
        }

        res.json({ success: true, message: 'Produit mis à jour', data: product });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE - Supprimer un produit
router.delete('/products/:id', verifyToken, adminOnly, async (req, res) => {
    try {
        const product = await Product.findByIdAndDelete(req.params.id);

        if (!product) {
            return res.status(404).json({ success: false, message: 'Produit non trouvé' });
        }

        res.json({ success: true, message: 'Produit supprimé' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET - Tous les produits (Admin)
router.get('/products', verifyToken, adminOnly, async (req, res) => {
    try {
        const { page = 1, limit = 500, search, category } = req.query;
        const skip = (page - 1) * limit;

        let filter = {};
        if (search) filter.$text = { $search: search };
        if (category) filter.category = category;

        if (req.user.role === 'dev-admin') {
            filter.vendorId = req.user.userId;
        }

        const products = await Product.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Product.countDocuments(filter);

        res.json({
            success: true,
            data: products,
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

// POST - Créer une promotion
router.post('/promotions', verifyToken, adminOnly, async (req, res) => {
    try {
        const {
            code, description, discountType, discountValue, maxDiscount,
            minOrderAmount, applicableCategories, applicableProducts, usageLimit, startDate, endDate
        } = req.body;

        const promotion = new Promotion({
            code: code.toUpperCase(),
            description,
            discountType,
            discountValue,
            maxDiscount,
            minOrderAmount,
            applicableCategories,
            applicableProducts,
            usageLimit,
            startDate,
            endDate
        });

        await promotion.save();
        res.json({ success: true, message: 'Promotion créée', data: promotion });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET - Toutes les promotions
router.get('/promotions', verifyToken, adminOnly, async (req, res) => {
    try {
        const promotions = await Promotion.find();
        res.json({ success: true, data: promotions });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// PUT - Mettre à jour une promotion
router.put('/promotions/:id', verifyToken, adminOnly, async (req, res) => {
    try {
        const promotion = await Promotion.findByIdAndUpdate(req.params.id, req.body, { new: true });

        if (!promotion) {
            return res.status(404).json({ success: false, message: 'Promotion non trouvée' });
        }

        res.json({ success: true, message: 'Promotion mise à jour', data: promotion });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE - Supprimer une promotion
router.delete('/promotions/:id', verifyToken, adminOnly, async (req, res) => {
    try {
        await Promotion.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Promotion supprimée' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
