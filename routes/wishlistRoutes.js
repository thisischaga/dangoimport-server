const express = require('express');
const Wishlist = require('../Models/Wishlist');
const Product = require('../Models/Product');
const verifyToken = require('../Middlewares/verifyTokens');

const router = express.Router();

// GET - Voir la liste de souhaits
router.get('/', verifyToken, async (req, res) => {
    try {
        let wishlist = await Wishlist.findOne({ userId: req.user.id })
            .populate('items.productId');

        if (!wishlist) {
            wishlist = new Wishlist({ userId: req.user.id, items: [] });
            await wishlist.save();
        }

        res.json({ success: true, data: wishlist });
    } catch (error) {
      console.error("[wishlistRoutes.js] Erreur capturée :", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST - Ajouter un produit à la liste de souhaits
router.post('/add/:productId', verifyToken, async (req, res) => {
    try {
        const productId = req.params.productId;

        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({ success: false, message: 'Produit non trouvé' });
        }

        let wishlist = await Wishlist.findOne({ userId: req.user.id });

        if (!wishlist) {
            wishlist = new Wishlist({ userId: req.user.id, items: [] });
        }

        // Vérifier si le produit existe déjà
        const exists = wishlist.items.some(item => item.productId.toString() === productId);

        if (exists) {
            return res.status(400).json({ success: false, message: 'Produit déjà dans la liste' });
        }

        wishlist.items.push({ productId });
        wishlist.updatedAt = new Date();
        await wishlist.save();

        res.json({ success: true, message: 'Produit ajouté à la liste', data: wishlist });
    } catch (error) {
      console.error("[wishlistRoutes.js] Erreur capturée :", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE - Supprimer un produit de la liste de souhaits
router.delete('/remove/:productId', verifyToken, async (req, res) => {
    try {
        const wishlist = await Wishlist.findOne({ userId: req.user.id });

        if (!wishlist) {
            return res.status(404).json({ success: false, message: 'Liste de souhaits non trouvée' });
        }

        wishlist.items = wishlist.items.filter(item => item.productId.toString() !== req.params.productId);
        wishlist.updatedAt = new Date();
        await wishlist.save();

        res.json({ success: true, message: 'Produit supprimé', data: wishlist });
    } catch (error) {
      console.error("[wishlistRoutes.js] Erreur capturée :", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
