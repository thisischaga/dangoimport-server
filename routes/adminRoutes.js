const express = require('express');
const Product = require('../Models/Product');
const Promotion = require('../Models/Promotion');
const ShopOrder = require('../Models/ShopOrder');
const OrderHistory = require('../Models/OrderHistory');
const QRCode = require('../Models/QRCode');
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
      console.error("[adminRoutes.js] Erreur capturée :", error);
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
      console.error("[adminRoutes.js] Erreur capturée :", error);
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
      console.error("[adminRoutes.js] Erreur capturée :", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST - Créer une promotion
router.post('/promotions', verifyToken, adminOnly, async (req, res) => {
    try {
        const {
            name, code, description, discountType, discountValue, maxDiscount,
            minOrderAmount, applicableCategories, applicableProducts,
            maxUses, maxUsesPerUser, excludedCategories, excludedProducts,
            eligibleUsers, excludeOnSale, status, startDate, endDate
        } = req.body;

        const promotion = new Promotion({
            name,
            code: code.toUpperCase(),
            description,
            discountType,
            discountValue,
            maxDiscount,
            minOrderAmount,
            maxUses,
            maxUsesPerUser,
            applicableCategories,
            applicableProducts,
            excludedCategories,
            excludedProducts,
            eligibleUsers,
            excludeOnSale,
            status: status || 'active',
            startDate,
            endDate,
            createdBy: req.user.userId || req.user.id,
        });

        await promotion.save();
        res.json({ success: true, message: 'Promotion créée', data: promotion });
    } catch (error) {
      console.error("[adminRoutes.js] Erreur capturée :", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET - Toutes les promotions
router.get('/promotions', verifyToken, adminOnly, async (req, res) => {
    try {
        const promotions = await Promotion.find().sort({ createdAt: -1 });
        res.json({ success: true, data: promotions });
    } catch (error) {
      console.error("[adminRoutes.js] Erreur capturée :", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET - Historique complet des commandes pour l'administration
router.get('/orders/history', verifyToken, adminOnly, async (req, res) => {
    try {
        const { page = 1, limit = 20, status, paymentStatus, search, from, to, dateFilter } = req.query;
        const skip = (page - 1) * limit;
        const mongoose = require('mongoose');

        const filter = {};
        if (status) filter.status = status;
        if (paymentStatus) filter.paymentStatus = paymentStatus;

        if (search) {
            // Find transactionIds matching the search criteria
            const matchingTxs = await mongoose.model('Transaction').find({
                transactionId: { $regex: search, $options: 'i' }
            }).select('orderId').lean();
            const orderIdsFromTxs = matchingTxs.map(t => t.orderId).filter(Boolean);

            filter.$or = [
                { orderNumber: { $regex: search, $options: 'i' } },
                { customerName: { $regex: search, $options: 'i' } },
                { customerEmail: { $regex: search, $options: 'i' } },
                { 'items.productName': { $regex: search, $options: 'i' } },
                { 'items.vendorName': { $regex: search, $options: 'i' } },
                { _id: { $in: orderIdsFromTxs } }
            ];
        }

        const dateRange = dateFilter || req.query.dateRange;
        if (dateRange && dateRange !== 'all') {
            filter.createdAt = {};
            const now = new Date();
            if (dateRange === 'today') {
                const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                filter.createdAt.$gte = start;
            } else if (dateRange === 'yesterday') {
                const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
                const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                filter.createdAt.$gte = start;
                filter.createdAt.$lt = end;
            } else if (dateRange === '7d') {
                const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                filter.createdAt.$gte = start;
            } else if (dateRange === '30d') {
                const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                filter.createdAt.$gte = start;
            } else if (dateRange === 'year') {
                const start = new Date(now.getFullYear(), 0, 1);
                filter.createdAt.$gte = start;
            }
        } else if (from || to) {
            filter.createdAt = {};
            if (from) filter.createdAt.$gte = new Date(from);
            if (to) filter.createdAt.$lte = new Date(to);
        }

        const orders = await ShopOrder.find(filter)
            .sort({ createdAt: -1 })
            .skip(parseInt(skip, 10))
            .limit(parseInt(limit, 10))
            .lean();

        const total = await ShopOrder.countDocuments(filter);
        const orderIds = orders.map((o) => o._id);
        const histories = orderIds.length > 0 ? await OrderHistory.find({ orderId: { $in: orderIds } }).sort({ createdAt: -1 }).lean() : [];
        const qrTokens = orderIds.length > 0 ? await QRCode.find({ orderId: { $in: orderIds } }).lean() : [];

        // Build stats
        const statsAggregation = await ShopOrder.aggregate([
            {
                $facet: {
                    totalOrders: [{ $count: "count" }],
                    completedPayments: [
                        { $match: { paymentStatus: "completed" } },
                        { $count: "count" }
                    ],
                    inProgressOrders: [
                        { $match: { status: { $in: ["confirmed", "processing", "shipped"] } } },
                        { $count: "count" }
                    ],
                    deliveredOrders: [
                        { $match: { status: "delivered" } },
                        { $count: "count" }
                    ],
                    cancelledOrders: [
                        { $match: { status: "cancelled" } },
                        { $count: "count" }
                    ],
                    totalSales: [
                        { $match: { paymentStatus: "completed" } },
                        { $group: { _id: null, sum: { $sum: "$total" } } }
                    ]
                }
            }
        ]);

        const stats = {
            totalOrders: statsAggregation[0]?.totalOrders[0]?.count || 0,
            completedPayments: statsAggregation[0]?.completedPayments[0]?.count || 0,
            inProgressOrders: statsAggregation[0]?.inProgressOrders[0]?.count || 0,
            deliveredOrders: statsAggregation[0]?.deliveredOrders[0]?.count || 0,
            cancelledOrders: statsAggregation[0]?.cancelledOrders[0]?.count || 0,
            totalSales: statsAggregation[0]?.totalSales[0]?.sum || 0,
        };

        const enrichedOrders = await Promise.all(orders.map(async (order) => {
            const tx = await mongoose.model('Transaction').findOne({ orderId: order._id }).select('transactionId').lean();
            const uniqueVendors = new Set((order.items || []).map(it => String(it.vendorId || 'Dango'))).size;
            return {
                ...order,
                fedapayRef: tx ? tx.transactionId : '—',
                uniqueVendorsCount: uniqueVendors,
                history: histories.filter((h) => String(h.orderId) === String(order._id)),
                qrTokens: qrTokens.filter((qr) => String(qr.orderId) === String(order._id)),
            };
        }));

        res.json({
            success: true,
            data: enrichedOrders,
            stats,
            pagination: {
                currentPage: parseInt(page, 10),
                totalPages: Math.ceil(total / limit),
                totalItems: total,
            },
        });
    } catch (error) {
        console.error("[adminRoutes.js] Erreur capturée :", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET - Détail d'une commande pour l'administration
router.get('/orders/:id', verifyToken, adminOnly, async (req, res) => {
    try {
        const mongoose = require('mongoose');
        const order = await ShopOrder.findById(req.params.id).lean();
        if (!order) {
            return res.status(404).json({ success: false, message: 'Commande non trouvée.' });
        }

        const history = await OrderHistory.find({ orderId: order._id }).sort({ createdAt: -1 }).lean();
        const qrTokens = await QRCode.find({ orderId: order._id }).lean();
        const tx = await mongoose.model('Transaction').findOne({ orderId: order._id }).select('transactionId').lean();

        return res.json({ success: true, data: { ...order, history, qrTokens, fedapayRef: tx ? tx.transactionId : '—' } });
    } catch (error) {
        console.error("[adminRoutes.js] Erreur capturée :", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// PATCH - Mettre à jour le statut d'une commande ShopOrder (Admin)
router.patch('/orders/:id/status', verifyToken, adminOnly, async (req, res) => {
    try {
        const { status, paymentStatus, trackingNumber, carrier, adminNotes } = req.body;
        const order = await ShopOrder.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Commande non trouvée.' });
        }

        const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'];
        if (status) {
            if (!validStatuses.includes(status)) {
                return res.status(400).json({ success: false, message: 'Statut invalide.' });
            }
            order.status = status;
        }

        const validPaymentStatuses = ['pending', 'completed', 'failed', 'refunded'];
        if (paymentStatus) {
            if (!validPaymentStatuses.includes(paymentStatus)) {
                return res.status(400).json({ success: false, message: 'Statut de paiement invalide.' });
            }
            order.paymentStatus = paymentStatus;
        }

        if (trackingNumber) order.trackingNumber = trackingNumber;
        if (carrier) order.carrier = carrier;
        if (adminNotes) order.adminNotes = adminNotes;
        order.updatedAt = new Date();

        await order.save();
        return res.json({ success: true, message: 'Commande mise à jour', data: order });
    } catch (error) {
      console.error("[adminRoutes.js] Erreur capturée :", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE - Supprimer une commande ShopOrder (Admin)
router.delete('/orders/:id', verifyToken, adminOnly, async (req, res) => {
    try {
        const order = await ShopOrder.findByIdAndDelete(req.params.id);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Commande non trouvée.' });
        }

        await OrderHistory.deleteMany({ orderId: order._id });
        await QRCode.deleteMany({ orderId: order._id });

        return res.json({ success: true, message: 'Commande supprimée' });
    } catch (error) {
      console.error("[adminRoutes.js] Erreur capturée :", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// PUT - Mettre à jour une promotion
router.put('/promotions/:id', verifyToken, adminOnly, async (req, res) => {
    try {
        const updateData = {
            ...req.body,
            maxUses: req.body.maxUses ?? req.body.usageLimit,
            updatedAt: new Date(),
        };

        const promotion = await Promotion.findByIdAndUpdate(req.params.id, updateData, { new: true });

        if (!promotion) {
            return res.status(404).json({ success: false, message: 'Promotion non trouvée' });
        }

        res.json({ success: true, message: 'Promotion mise à jour', data: promotion });
    } catch (error) {
      console.error("[adminRoutes.js] Erreur capturée :", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE - Supprimer une promotion
router.delete('/promotions/:id', verifyToken, adminOnly, async (req, res) => {
    try {
        await Promotion.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Promotion supprimée' });
    } catch (error) {
      console.error("[adminRoutes.js] Erreur capturée :", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
