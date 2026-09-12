const express = require('express');
const bcrypt = require('bcryptjs');
const Product = require('../Models/Product');
const Promotion = require('../Models/Promotion');
const ShopOrder = require('../Models/ShopOrder');
const OrderHistory = require('../Models/OrderHistory');
const QRCode = require('../Models/QRCode');
const Transaction = require('../Models/Transaction');
const Review = require('../Models/Review');
const AuditLog = require('../Models/AuditLog');
const WithdrawalRequest = require('../Models/WithdrawalRequest');
const Notification = require('../Models/Notification');
const User = require('../Models/User');
const Store = require('../Models/Store');
const VendorWithdrawal = require('../Models/VendorWithdrawal');
const Driver = require('../Models/Driver');
const Delivery = require('../Models/Delivery');
const DeliveryList = require('../Models/DeliveryList');
const { isOrderEligibleForDelivery, createDeliveryListFromOrders, getEligibleDeliveryOrders } = require('../services/deliveryDispatchService');
const verifyToken = require('../Middlewares/verifyTokens');

const router = express.Router();

// Middleware pour vérifier l'accès admin
const adminOnly = (req, res, next) => {
    const role = req.user?.role || req.admin?.role;
    if (['admin', 'dev-admin', 'superadmin', 'manager'].includes(role)) {
        return next();
    }
    return res.status(403).json({ success: false, message: 'Accès refusé' });
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

// =============================
// DRIVERS MANAGEMENT
// =============================

const generateDriverCode = () => {
    const prefix = 'DRV';
    const random = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `${prefix}-${random}`;
};

const generateDriverPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#';
    let password = 'Drv@';
    while (password.length < 10) {
        password += chars[Math.floor(Math.random() * chars.length)];
    }
    return password;
};

router.get('/drivers', verifyToken, adminOnly, async (req, res) => {
    try {
        const drivers = await Driver.find({}).populate('userId', 'userFirstname userSurname userEmail userPhone role driverStatus isVerified').sort({ createdAt: -1 }).lean();

        const payload = drivers.map((driver) => ({
            id: driver._id,
            driverCode: driver.driverCode,
            driverPassword: driver.driverPassword || '',
            status: driver.status,
            isActive: driver.isActive,
            vehicleType: driver.vehicleType,
            vehiclePlate: driver.vehiclePlate,
            zone: driver.zone,
            phone: driver.phone,
            createdAt: driver.createdAt,
            user: driver.userId ? {
                id: driver.userId._id,
                userFirstname: driver.userId.userFirstname,
                userSurname: driver.userId.userSurname,
                userEmail: driver.userId.userEmail,
                userPhone: driver.userId.userPhone,
                role: driver.userId.role,
                driverStatus: driver.userId.driverStatus,
                isVerified: driver.userId.isVerified,
            } : null,
        }));

        return res.json({ success: true, data: payload });
    } catch (error) {
        console.error('[adminRoutes] GET /drivers error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/drivers/export', verifyToken, adminOnly, async (req, res) => {
    try {
        const { driverId } = req.query;

        const filter = driverId ? { _id: driverId } : {};
        const drivers = await Driver.find(filter).populate('userId', 'userFirstname userSurname userEmail userPhone role').lean();

        if (driverId && drivers.length === 0) {
            return res.status(404).json({ success: false, message: 'Livreur introuvable.' });
        }

        const rows = drivers.map((driver) => ({
            driverId: String(driver._id),
            userId: driver.userId ? String(driver.userId._id) : '',
            firstName: driver.userId?.userFirstname || '',
            lastName: driver.userId?.userSurname || '',
            email: driver.userId?.userEmail || '',
            phone: driver.userId?.userPhone || driver.phone || '',
            driverCode: driver.driverCode || '',
            driverPassword: driver.driverPassword || '',
            vehicleType: driver.vehicleType || '',
            vehiclePlate: driver.vehiclePlate || '',
            zone: driver.zone || '',
            status: driver.status || 'unavailable',
            isActive: driver.isActive !== false,
            createdAt: driver.createdAt ? new Date(driver.createdAt).toISOString() : '',
        }));

        const headers = ['driverId', 'userId', 'firstName', 'lastName', 'email', 'phone', 'driverCode', 'driverPassword', 'vehicleType', 'vehiclePlate', 'zone', 'status', 'isActive', 'createdAt'];
        const csv = [headers.join(',')].concat(rows.map((row) => headers.map((header) => {
            const value = row[header] ?? '';
            const escaped = String(value).replace(/"/g, '""');
            return `"${escaped}"`;
        }).join(','))).join('\n');

        const fileName = driverId ? `driver-${String(driverId).slice(0, 12)}-export.csv` : 'drivers-export.csv';

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        return res.send(csv);
    } catch (error) {
        console.error('[adminRoutes] GET /drivers/export error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/drivers', verifyToken, adminOnly, async (req, res) => {
    try {
        const {
            userFirstname,
            userSurname,
            userEmail,
            userPhone,
            driverCode,
            vehicleType,
            vehiclePlate,
            zone,
            status,
            userPassword,
        } = req.body || {};

        if (!userFirstname || !userSurname || !userEmail || !userPhone) {
            return res.status(400).json({ success: false, message: 'Nom, prénom, email et numéro requis.' });
        }

        const normalizedPhone = String(userPhone).trim();
        const normalizedEmail = String(userEmail).trim().toLowerCase();
        const generatedPassword = userPassword || generateDriverPassword();

        const requestedDriverCode = (driverCode || '').toString().trim().toUpperCase();
        let driverIdentifier = requestedDriverCode || generateDriverCode();
        let attempts = 0;
        while (attempts < 10) {
            const existingDriverCode = await Driver.findOne({ driverCode: driverIdentifier });
            if (!existingDriverCode) break;
            driverIdentifier = generateDriverCode();
            attempts += 1;
        }

        let savedUser = await User.findOne({ userPhone: normalizedPhone }) || await User.findOne({ userEmail: normalizedEmail });

        if (!savedUser) {
            const newUser = new User({
                userFirstname,
                userSurname,
                userEmail: normalizedEmail,
                userPassword: await bcrypt.hash(generatedPassword, 10),
                userPhone: normalizedPhone,
                role: 'driver',
                isVerified: true,
                driverStatus: ['available', 'unavailable', 'on_delivery'].includes(status) ? status : 'available',
            });
            savedUser = await newUser.save();
        } else {
            savedUser.userFirstname = userFirstname;
            savedUser.userSurname = userSurname;
            savedUser.userEmail = normalizedEmail;
            savedUser.userPhone = normalizedPhone;
            savedUser.role = 'driver';
            savedUser.isVerified = true;
            savedUser.driverStatus = ['available', 'unavailable', 'on_delivery'].includes(status) ? status : 'available';
            savedUser.userPassword = await bcrypt.hash(generatedPassword, 10);
            await savedUser.save();
        }

        let existingDriver = await Driver.findOne({ userId: savedUser._id });
        if (!existingDriver) {
            existingDriver = new Driver({
                userId: savedUser._id,
                driverCode: driverIdentifier,
                phone: normalizedPhone,
                driverPassword: generatedPassword,
                vehicleType: vehicleType || '',
                vehiclePlate: vehiclePlate || '',
                zone: zone || '',
                status: ['available', 'unavailable', 'on_delivery'].includes(status) ? status : 'available',
                isActive: true,
                createdBy: req.user?.userId || req.user?.id || null,
            });
        } else {
            existingDriver.driverCode = driverIdentifier;
            existingDriver.phone = normalizedPhone;
            existingDriver.driverPassword = generatedPassword;
            existingDriver.vehicleType = vehicleType || existingDriver.vehicleType || '';
            existingDriver.vehiclePlate = vehiclePlate || existingDriver.vehiclePlate || '';
            existingDriver.zone = zone || existingDriver.zone || '';
            existingDriver.status = ['available', 'unavailable', 'on_delivery'].includes(status) ? status : existingDriver.status;
            existingDriver.isActive = true;
            if (!existingDriver.createdBy) {
                existingDriver.createdBy = req.user?.userId || req.user?.id || null;
            }
        }

        const savedDriver = await existingDriver.save();

        return res.status(201).json({
            success: true,
            message: 'Livreur créé avec succès.',
            data: {
                id: savedDriver._id,
                userId: savedUser._id,
                driverCode: savedDriver.driverCode,
                driverPassword: savedDriver.driverPassword,
                userPhone: savedUser.userPhone,
                userEmail: savedUser.userEmail,
                generatedPassword,
                role: savedUser.role,
                status: savedDriver.status,
            }
        });
    } catch (error) {
        console.error('[adminRoutes] POST /drivers error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/drivers/:id', verifyToken, adminOnly, async (req, res) => {
    try {
        const driver = await Driver.findById(req.params.id).populate('userId', 'userFirstname userSurname userEmail userPhone role driverStatus isVerified').lean();
        if (!driver) {
            return res.status(404).json({ success: false, message: 'Livreur introuvable.' });
        }

        return res.json({
            success: true,
            data: {
                id: driver._id,
                driverCode: driver.driverCode,
                status: driver.status,
                isActive: driver.isActive,
                vehicleType: driver.vehicleType,
                vehiclePlate: driver.vehiclePlate,
                zone: driver.zone,
                phone: driver.phone,
                createdAt: driver.createdAt,
                user: driver.userId ? {
                    id: driver.userId._id,
                    userFirstname: driver.userId.userFirstname,
                    userSurname: driver.userId.userSurname,
                    userEmail: driver.userId.userEmail,
                    userPhone: driver.userId.userPhone,
                    role: driver.userId.role,
                    driverStatus: driver.userId.driverStatus,
                    isVerified: driver.userId.isVerified,
                } : null,
            }
        });
    } catch (error) {
        console.error('[adminRoutes] GET /drivers/:id error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

router.patch('/drivers/:id', verifyToken, adminOnly, async (req, res) => {
    try {
        const {
            userFirstname,
            userSurname,
            userEmail,
            userPhone,
            driverCode,
            vehicleType,
            vehiclePlate,
            zone,
            status,
            isActive,
            userPassword,
            driverPassword,
        } = req.body || {};

        const driver = await Driver.findById(req.params.id);
        if (!driver) {
            return res.status(404).json({ success: false, message: 'Livreur introuvable.' });
        }

        const user = await User.findById(driver.userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'Compte utilisateur du livreur introuvable.' });
        }

        if (userFirstname) user.userFirstname = userFirstname;
        if (userSurname) user.userSurname = userSurname;
        if (userEmail) user.userEmail = String(userEmail).trim().toLowerCase();
        if (userPhone) user.userPhone = String(userPhone).trim();
        if (userPassword) {
            user.userPassword = await bcrypt.hash(String(userPassword), 10);
        }
        if (driverPassword) {
            driver.driverPassword = String(driverPassword);
        }
        if (driverCode) driver.driverCode = String(driverCode).trim().toUpperCase();
        if (vehicleType !== undefined) driver.vehicleType = vehicleType;
        if (vehiclePlate !== undefined) driver.vehiclePlate = vehiclePlate;
        if (zone !== undefined) driver.zone = zone;
        if (status && ['available', 'unavailable', 'on_delivery'].includes(status)) {
            driver.status = status;
            user.driverStatus = status;
        }
        if (isActive !== undefined) driver.isActive = Boolean(isActive);

        await user.save();
        await driver.save();

        return res.json({ success: true, message: 'Livreur mis à jour.', data: driver });
    } catch (error) {
        console.error('[adminRoutes] PATCH /drivers/:id error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

router.patch('/drivers/:id/status', verifyToken, adminOnly, async (req, res) => {
    try {
        const { status } = req.body || {};
        if (!['available', 'unavailable', 'on_delivery'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Statut de livreur invalide.' });
        }

        const driver = await Driver.findById(req.params.id);
        if (!driver) {
            return res.status(404).json({ success: false, message: 'Livreur introuvable.' });
        }

        driver.status = status;
        await driver.save();

        const user = await User.findById(driver.userId);
        if (user) {
            user.driverStatus = status;
            await user.save();
        }

        return res.json({ success: true, message: 'Statut livreur mis à jour.', data: driver });
    } catch (error) {
        console.error('[adminRoutes] PATCH /drivers/:id/status error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

router.delete('/drivers/:id', verifyToken, adminOnly, async (req, res) => {
    try {
        const driver = await Driver.findById(req.params.id);
        if (!driver) {
            return res.status(404).json({ success: false, message: 'Livreur introuvable.' });
        }

        await User.findByIdAndDelete(driver.userId);
        await Driver.findByIdAndDelete(driver._id);

        return res.json({ success: true, message: 'Livreur supprimé.' });
    } catch (error) {
        console.error('[adminRoutes] DELETE /drivers/:id error:', error);
        return res.status(500).json({ success: false, message: error.message });
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

// GET /api/admin/transactions — transactions paiement marketplace
router.get('/transactions', verifyToken, adminOnly, async (req, res) => {
    try {
        const { page = 1, limit = 50 } = req.query;
        const skip = (Number(page) - 1) * Number(limit);
        const rows = await Transaction.find({}).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean();
        const total = await Transaction.countDocuments({});
        return res.json({ success: true, data: rows, pagination: { currentPage: Number(page), totalPages: Math.ceil(total / Number(limit)), totalItems: total } });
    } catch (error) {
        console.error('[adminRoutes.js] transactions:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/admin/refunds — remboursements et retours gagnés
router.get('/refunds', verifyToken, adminOnly, async (req, res) => {
    try {
        const rows = await ShopOrder.find({
            $or: [{ status: 'refunded' }, { status: 'cancelled' }, { paymentStatus: 'refunded' }]
        }).sort({ createdAt: -1 }).lean();

        return res.json({ success: true, data: rows });
    } catch (error) {
        console.error('[adminRoutes.js] refunds:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/admin/deliveries — suivi des livraisons
router.get('/delivery/orders', verifyToken, adminOnly, async (req, res) => {
    try {
        const orders = await getEligibleDeliveryOrders(req.query || {});
        return res.json({ success: true, data: orders });
    } catch (error) {
        console.error('[adminRoutes] GET /delivery/orders error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/delivery/drivers', verifyToken, adminOnly, async (req, res) => {
    try {
        const drivers = await Driver.find({ isActive: true }).populate('userId', 'userFirstname userSurname userEmail userPhone role').lean();
        return res.json({ success: true, data: drivers.map((driver) => ({
            id: driver.userId?._id || driver._id,
            driverId: driver._id,
            name: driver.userId ? `${driver.userId.userFirstname || ''} ${driver.userId.userSurname || ''}`.trim() : 'Livreur',
            email: driver.userId?.userEmail || '',
            phone: driver.userId?.userPhone || driver.phone || '',
            driverCode: driver.driverCode,
            vehicleType: driver.vehicleType,
            zone: driver.zone,
            status: driver.status,
        })) });
    } catch (error) {
        console.error('[adminRoutes] GET /delivery/drivers error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/delivery/lists', verifyToken, adminOnly, async (req, res) => {
    try {
        const { name, driverId, selectedOrderIds, scheduledDate, zone, priority, notes } = req.body || {};
        const result = await createDeliveryListFromOrders({
            name,
            driverId,
            selectedOrderIds,
            scheduledDate,
            zone,
            priority,
            notes,
            createdBy: req.user?.id || req.user?.userId || null,
        });
        return res.status(201).json(result);
    } catch (error) {
        console.error('[adminRoutes] POST /delivery/lists error:', error);
        return res.status(400).json({ success: false, message: error.message });
    }
});

router.get('/delivery/lists', verifyToken, adminOnly, async (req, res) => {
    try {
        const lists = await DeliveryList.find({}).populate('driverId', 'userFirstname userSurname userEmail userPhone role').sort({ createdAt: -1 }).lean();
        return res.json({ success: true, data: lists.map((list) => ({
            ...list,
            driverName: list.driverId ? `${list.driverId.userFirstname || ''} ${list.driverId.userSurname || ''}`.trim() : 'Livreur',
            deliveriesCount: Array.isArray(list.deliveryIds) ? list.deliveryIds.length : 0,
        })) });
    } catch (error) {
        console.error('[adminRoutes] GET /delivery/lists error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/delivery/lists/:id', verifyToken, adminOnly, async (req, res) => {
    try {
        const list = await DeliveryList.findById(req.params.id).populate('driverId', 'userFirstname userSurname userEmail userPhone role').lean();
        if (!list) return res.status(404).json({ success: false, message: 'Liste introuvable.' });
        const deliveries = await Delivery.find({ _id: { $in: list.deliveryIds || [] } }).sort({ createdAt: -1 }).lean();
        return res.json({ success: true, data: { ...list, deliveries } });
    } catch (error) {
        console.error('[adminRoutes] GET /delivery/lists/:id error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/deliveries', verifyToken, adminOnly, async (req, res) => {
    try {
        const rows = await ShopOrder.find({
            status: { $in: ['confirmed', 'processing', 'shipped', 'delivered'] }
        }).sort({ createdAt: -1 }).lean();

        return res.json({ success: true, data: rows });
    } catch (error) {
        console.error('[adminRoutes.js] deliveries:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/admin/disputes — signalements / support / litiges
router.get('/disputes', verifyToken, adminOnly, async (req, res) => {
    try {
        const rows = await Notification.find({
            $or: [
              { type: 'support' },
              { type: 'ticket' },
              { type: 'dispute' },
              { title: { $regex: 'litige|signal|support|réclamation', $options: 'i' } },
              { message: { $regex: 'litige|signal|support|réclamation', $options: 'i' } }
            ]
        }).sort({ createdAt: -1 }).lean();

        return res.json({ success: true, data: rows });
    } catch (error) {
        console.error('[adminRoutes.js] disputes:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/admin/reviews — avis produits
router.get('/reviews', verifyToken, adminOnly, async (req, res) => {
    try {
        const rows = await Review.find({}).populate('productId').sort({ createdAt: -1 }).lean();
        return res.json({ success: true, data: rows });
    } catch (error) {
        console.error('[adminRoutes.js] reviews:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/admin/reported-products — catalogue signalé / en besoin de modération
router.get('/reported-products', verifyToken, adminOnly, async (req, res) => {
    try {
        const rows = await Product.find({
            $or: [
                { reported: true },
                { validationStatus: 'changes_requested' },
                { validationStatus: 'rejected' },
                { rejectionReason: { $exists: true, $ne: '' } }
            ]
        }).sort({ createdAt: -1 }).lean();

        return res.json({ success: true, data: rows });
    } catch (error) {
        console.error('[adminRoutes.js] reported-products:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// =============================
// VENDORS & VERIFICATION
// =============================

router.get('/vendors', verifyToken, adminOnly, async (req, res) => {
    try {
        const stores = await Store.find({})
            .populate('userId', 'userEmail userFirstname userSurname userPhone balance reservedBalance role')
            .sort({ createdAt: -1 })
            .lean();

        const data = stores.map((store) => ({
            _id: store._id,
            storeName: store.name,
            slug: store.slug,
            city: store.city,
            country: store.country,
            logo: store.logo,
            verificationStatus: store.verification?.status || 'UNVERIFIED',
            documentsCount: store.verification?.documents?.length || 0,
            vendorId: store.userId?._id,
            vendorEmail: store.userId?.userEmail,
            vendorName: [store.userId?.userFirstname, store.userId?.userSurname].filter(Boolean).join(' '),
            vendorPhone: store.userId?.userPhone,
            balance: store.userId?.balance || 0,
            reservedBalance: store.userId?.reservedBalance || 0,
            createdAt: store.createdAt,
        }));

        return res.json({ success: true, data });
    } catch (error) {
        console.error('[adminRoutes.js] vendors:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/stores/verification', verifyToken, adminOnly, async (req, res) => {
    try {
        const { status = 'PENDING' } = req.query;
        const filter = status === 'ALL'
            ? { 'verification.documents.0': { $exists: true } }
            : { 'verification.status': status };

        const stores = await Store.find(filter)
            .populate('userId', 'userEmail userFirstname userSurname userPhone')
            .sort({ updatedAt: -1 })
            .lean();

        const data = stores.map((store) => ({
            _id: store._id,
            storeName: store.name,
            slug: store.slug,
            city: store.city,
            country: store.country,
            verification: {
                status: store.verification?.status || 'UNVERIFIED',
                documents: store.verification?.documents || [],
                rejectionReason: store.verification?.rejectionReason || '',
                verifiedAt: store.verification?.verifiedAt,
            },
            vendor: store.userId ? {
                _id: store.userId._id,
                email: store.userId.userEmail,
                name: [store.userId.userFirstname, store.userId.userSurname].filter(Boolean).join(' '),
                phone: store.userId.userPhone,
            } : null,
            updatedAt: store.updatedAt,
        }));

        return res.json({ success: true, data });
    } catch (error) {
        console.error('[adminRoutes.js] stores/verification:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

router.put('/stores/:id/verification', verifyToken, adminOnly, async (req, res) => {
    try {
        const { status, reason } = req.body;
        const allowed = ['VERIFIED', 'REJECTED', 'PENDING', 'UNVERIFIED'];
        if (!allowed.includes(status)) {
            return res.status(400).json({ success: false, message: 'Statut invalide.' });
        }

        const store = await Store.findById(req.params.id);
        if (!store) {
            return res.status(404).json({ success: false, message: 'Boutique introuvable.' });
        }

        store.verification = store.verification || {};
        store.verification.status = status;
        if (status === 'REJECTED') {
            store.verification.rejectionReason = reason || '';
        } else if (status === 'VERIFIED') {
            store.verification.verifiedAt = new Date();
            store.verification.rejectionReason = '';
        }
        await store.save();

        return res.json({
            success: true,
            message: status === 'VERIFIED' ? 'Vendeur vérifié.' : status === 'REJECTED' ? 'Vérification rejetée.' : 'Statut mis à jour.',
            data: store.verification,
        });
    } catch (error) {
        console.error('[adminRoutes.js] stores/:id/verification:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// =============================
// VENDOR PAYOUTS (VERSEMENTS)
// =============================

router.get('/vendor-payouts', verifyToken, adminOnly, async (req, res) => {
    try {
        const { status } = req.query;
        const filter = status ? { status } : {};
        const rows = await VendorWithdrawal.find(filter)
            .populate('userId', 'userEmail userFirstname userSurname userPhone')
            .sort({ createdAt: -1 })
            .limit(500)
            .lean();

        return res.json({ success: true, data: rows });
    } catch (error) {
        console.error('[adminRoutes.js] vendor-payouts GET:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/vendor-payouts', verifyToken, adminOnly, async (req, res) => {
    try {
        const {
            vendorEmail,
            userId,
            amount,
            destinationPhone,
            reference,
            withdrawalId,
            note,
        } = req.body;

        if (withdrawalId) {
            const withdrawal = await VendorWithdrawal.findById(withdrawalId);
            if (!withdrawal) {
                return res.status(404).json({ success: false, message: 'Demande de retrait introuvable.' });
            }
            if (withdrawal.status === 'completed') {
                return res.status(400).json({ success: false, message: 'Ce versement a déjà été effectué.' });
            }

            const user = await User.findById(withdrawal.userId);
            if (!user) {
                return res.status(404).json({ success: false, message: 'Vendeur introuvable.' });
            }

            const payoutAmount = Number(withdrawal.amount);
            if ((user.balance || 0) < payoutAmount) {
                return res.status(400).json({ success: false, message: 'Solde vendeur insuffisant.' });
            }

            user.balance = (user.balance || 0) - payoutAmount;
            user.reservedBalance = Math.max(0, (user.reservedBalance || 0) - payoutAmount);
            await user.save();

            withdrawal.status = 'completed';
            withdrawal.meta = {
                ...(withdrawal.meta || {}),
                reference: reference || '',
                note: note || '',
                completedBy: req.user.userId || req.user.id,
                completedAt: new Date(),
                source: 'admin_complete',
            };
            await withdrawal.save();

            return res.json({ success: true, message: 'Versement confirmé.', data: withdrawal });
        }

        const payoutAmount = Number(amount);
        if (!payoutAmount || payoutAmount <= 0) {
            return res.status(400).json({ success: false, message: 'Montant invalide.' });
        }

        let user = null;
        if (userId) user = await User.findById(userId);
        else if (vendorEmail) user = await User.findOne({ userEmail: String(vendorEmail).trim().toLowerCase() });
        if (!user) {
            return res.status(404).json({ success: false, message: 'Vendeur introuvable.' });
        }

        const available = (user.balance || 0) - (user.reservedBalance || 0);
        if (payoutAmount > available) {
            return res.status(400).json({
                success: false,
                message: `Solde disponible insuffisant (${available.toLocaleString()} FCFA).`,
            });
        }

        user.balance = (user.balance || 0) - payoutAmount;
        await user.save();

        const payout = await VendorWithdrawal.create({
            userId: user._id,
            amount: payoutAmount,
            destinationPhone: destinationPhone || user.userPhone || '',
            status: 'completed',
            otpVerified: false,
            meta: {
                reference: reference || '',
                note: note || '',
                source: 'admin_manual',
                createdBy: req.user.userId || req.user.id,
                method: 'Mobile Money',
            },
        });

        return res.status(201).json({ success: true, message: 'Versement enregistré.', data: payout });
    } catch (error) {
        console.error('[adminRoutes.js] vendor-payouts POST:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/admin/activity-log — audit trail admin
router.get('/activity-log', verifyToken, adminOnly, async (req, res) => {
    try {
        const rows = await AuditLog.find({}).sort({ createdAt: -1 }).limit(100).lean();
        return res.json({ success: true, data: rows });
    } catch (error) {
        console.error('[adminRoutes.js] activity-log:', error);
        return res.status(500).json({ success: false, message: error.message });
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
