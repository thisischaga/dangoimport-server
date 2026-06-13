const express = require('express');
const Cart = require('../Models/Cart');
const Product = require('../Models/Product');
const verifyToken = require('../Middlewares/verifyTokens');

const router = express.Router();

// GET - Voir le panier
router.get('/', verifyToken, async (req, res) => {
    try {
        let cart = await Cart.findOne({ userId: req.user.id });

        if (!cart) {
            cart = new Cart({ userId: req.user.id, items: [], totalItems: 0, totalPrice: 0 });
            await cart.save();
        }

        res.json({ success: true, data: cart });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST - Ajouter un article au panier
router.post('/add', verifyToken, async (req, res) => {
    try {
        const { productId, quantity, selectedOptions } = req.body;

        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({ success: false, message: 'Produit non trouvé' });
        }

        if (product.stock < quantity) {
            return res.status(400).json({ success: false, message: 'Stock insuffisant' });
        }

        let cart = await Cart.findOne({ userId: req.user.id });

        if (!cart) {
            cart = new Cart({ userId: req.user.id, items: [], totalItems: 0, totalPrice: 0 });
        }

        // Vérifier si le produit existe déjà dans le panier
        const existingItem = cart.items.find(
            item => item.productId.toString() === productId &&
                JSON.stringify(item.selectedOptions) === JSON.stringify(selectedOptions || {})
        );

        const basePrice = product.salePrice || product.price;

        // Calculer les surcoûts des paramètres personnalisés
        let priceAdj = 0;
        if (selectedOptions && product.parameters && product.parameters.length > 0) {
            product.parameters.forEach(param => {
                const selectedValue = selectedOptions[param.name];
                if (selectedValue) {
                    const opt = param.options?.find(o => o.value === selectedValue);
                    if (opt && opt.priceAdjustment) {
                        priceAdj += opt.priceAdjustment;
                    }
                }
            });
        }
        const price = basePrice + priceAdj;

        if (existingItem) {
            existingItem.quantity += quantity;
        } else {
            cart.items.push({
                productId,
                productName: product.name,
                productImage: product.images[0]?.url || '',
                price,
                quantity,
                selectedOptions: selectedOptions || {}
            });
        }

        // Recalculer le total
        cart.totalItems = cart.items.reduce((sum, item) => sum + item.quantity, 0);
        cart.totalPrice = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        cart.updatedAt = new Date();

        await cart.save();

        res.json({ success: true, message: 'Article ajouté au panier', data: cart });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// PUT - Mettre à jour la quantité d'un article
router.put('/update/:itemId', verifyToken, async (req, res) => {
    try {
        const { quantity } = req.body;

        const cart = await Cart.findOne({ userId: req.user.id });
        if (!cart) {
            return res.status(404).json({ success: false, message: 'Panier non trouvé' });
        }

        const item = cart.items.id(req.params.itemId);
        if (!item) {
            return res.status(404).json({ success: false, message: 'Article non trouvé' });
        }

        const product = await Product.findById(item.productId);
        if (product.stock < quantity) {
            return res.status(400).json({ success: false, message: 'Stock insuffisant' });
        }

        item.quantity = quantity;

        // Recalculer le total
        cart.totalItems = cart.items.reduce((sum, it) => sum + it.quantity, 0);
        cart.totalPrice = cart.items.reduce((sum, it) => sum + (it.price * it.quantity), 0);
        cart.updatedAt = new Date();

        await cart.save();

        res.json({ success: true, message: 'Quantité mise à jour', data: cart });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE - Supprimer un article du panier
router.delete('/remove/:itemId', verifyToken, async (req, res) => {
    try {
        const cart = await Cart.findOne({ userId: req.user.id });
        if (!cart) {
            return res.status(404).json({ success: false, message: 'Panier non trouvé' });
        }

        cart.items.id(req.params.itemId).remove();

        // Recalculer le total
        cart.totalItems = cart.items.reduce((sum, item) => sum + item.quantity, 0);
        cart.totalPrice = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        cart.updatedAt = new Date();

        await cart.save();

        res.json({ success: true, message: 'Article supprimé', data: cart });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE - Vider le panier
router.delete('/clear', verifyToken, async (req, res) => {
    try {
        const cart = await Cart.findOneAndUpdate(
            { userId: req.user.id },
            { items: [], totalItems: 0, totalPrice: 0, updatedAt: new Date() },
            { new: true }
        );

        res.json({ success: true, message: 'Panier vidé', data: cart });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
