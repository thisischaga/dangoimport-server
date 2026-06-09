const express = require('express');
const Order = require('../Models/Commande');
const Cart = require('../Models/Cart');
const Product = require('../Models/Product');
const verifyToken = require('../Middlewares/verifyTokens');

const router = express.Router();

// Générer numéro de commande unique
const generateOrderNumber = () => {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `ORD-${random}-${timestamp.slice(-8)}`;
};

// POST - Créer une nouvelle commande
router.post('/', verifyToken, async (req, res) => {
    try {
        const { items, shippingAddress, shippingMethod, paymentMethod } = req.body;

        if (!items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Aucun article dans la commande' });
        }

        let subtotal = 0;
        const orderItems = [];

        for (const item of items) {
            const product = await Product.findById(item.productId);
            if (!product) {
                return res.status(404).json({ success: false, message: `Produit ${item.productId} non trouvé` });
            }

            const itemPrice = product.salePrice || product.price;
            const itemTotal = itemPrice * item.quantity;

            orderItems.push({
                productId: product._id,
                productName: product.name,
                productImage: product.images[0]?.url || '',
                price: itemPrice,
                quantity: item.quantity,
                selectedOptions: item.selectedOptions || {},
                subtotal: itemTotal
            });

            subtotal += itemTotal;
        }

        // Calculer les frais de livraison
        let shippingCost = 0;
        let estimatedDelivery = new Date();

        if (shippingMethod === 'express') {
            shippingCost = subtotal * 0.1; // 10% du sous-total
            estimatedDelivery.setDate(estimatedDelivery.getDate() + 2);
        } else if (shippingMethod === 'standard') {
            shippingCost = subtotal * 0.05; // 5% du sous-total
            estimatedDelivery.setDate(estimatedDelivery.getDate() + 5);
        }

        // Calculer les taxes (18%)
        const tax = subtotal * 0.18;

        const total = subtotal + shippingCost + tax;

        const order = new Order({
            orderNumber: generateOrderNumber(),
            customerId: req.user.id,
            customerName: `${req.user.userFirstname} ${req.user.userSurname}`,
            customerEmail: req.user.userEmail,
            customerPhone: req.user.userPhone || '',
            shippingAddress,
            items: orderItems,
            subtotal,
            shippingCost,
            tax,
            total,
            shippingMethod,
            estimatedDelivery,
            paymentMethod
        });

        await order.save();

        // Réduire le stock
        for (const item of items) {
            await Product.findByIdAndUpdate(item.productId, {
                $inc: { stock: -item.quantity, totalSales: item.quantity }
            });
        }

        // Vider le panier
        await Cart.findOneAndUpdate({ userId: req.user.id }, { items: [], totalItems: 0, totalPrice: 0 });

        res.json({ success: true, message: 'Commande créée', data: order });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET - Mes commandes
router.get('/my-orders', verifyToken, async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const skip = (page - 1) * limit;

        const orders = await Order.find({ customerId: req.user.id })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Order.countDocuments({ customerId: req.user.id });

        res.json({
            success: true,
            data: orders,
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

// GET - Détails de la commande
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Commande non trouvée' });
        }

        // Vérifier que l'utilisateur est le propriétaire ou un admin
        if (order.customerId.toString() !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Accès refusé' });
        }

        res.json({ success: true, data: order });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET - Toutes les commandes (Admin)
router.get('/admin/all', verifyToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Accès refusé' });
        }

        const { page = 1, limit = 20, status, search } = req.query;
        const skip = (page - 1) * limit;

        let filter = {};
        if (status) filter.status = status;
        if (search) {
            filter.$or = [
                { orderNumber: { $regex: search, $options: 'i' } },
                { customerName: { $regex: search, $options: 'i' } },
                { customerEmail: { $regex: search, $options: 'i' } }
            ];
        }

        const orders = await Order.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Order.countDocuments(filter);

        res.json({
            success: true,
            data: orders,
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

// PATCH - Mettre à jour le statut de la commande (Admin)
router.patch('/:id/status', verifyToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Accès refusé' });
        }

        const { status, trackingNumber, carrier, adminNotes } = req.body;

        const order = await Order.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Commande non trouvée' });
        }

        order.status = status;
        if (trackingNumber) order.trackingNumber = trackingNumber;
        if (carrier) order.carrier = carrier;
        if (adminNotes) order.adminNotes = adminNotes;

        if (status === 'confirmed') order.confirmedAt = new Date();
        if (status === 'shipped') order.shippedAt = new Date();
        if (status === 'delivered') order.deliveredAt = new Date();

        order.updatedAt = new Date();
        await order.save();

        res.json({ success: true, message: 'Commande mise à jour', data: order });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
