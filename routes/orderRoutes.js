const express = require('express');
const Order = require('../Models/Commande');
const Cart = require('../Models/Cart');
const Product = require('../Models/Product');
const Promotion = require('../Models/Promotion');
const PromoUsage = require('../Models/PromoUsage');
const verifyToken = require('../Middlewares/verifyTokens');

const router = express.Router();
const { determineDeliveryProvider } = require('../services/deliveryService');
const Store = require('../Models/Store');

// Générer numéro de commande unique
const generateOrderNumber = () => {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `ORD-${random}-${timestamp.slice(-8)}`;
};

const getShippingCost = (subtotal, shippingMethod) => {
    if (shippingMethod === 'pickup') return 0;
    if (shippingMethod === 'express') return Math.round(subtotal * 0.1);
    return Math.round(subtotal * 0.05);
};

const validatePromotion = async (promoCode, subtotal, userId, cartItems = []) => {
    if (!promoCode) {
        return { discount: 0 };
    }

    const code = String(promoCode).trim().toUpperCase();
    const promotion = await Promotion.findOne({ code });
    if (!promotion) {
        return { error: 'Code promo invalide.' };
    }

    const now = new Date();
    if (promotion.status !== 'active') {
        return { error: 'Ce code promo n’est pas actif.' };
    }
    if (promotion.startDate && promotion.startDate > now) {
        return { error: 'Ce code promo n’est pas encore actif.' };
    }
    if (promotion.endDate && promotion.endDate < now) {
        return { error: 'Ce code promo est expiré.' };
    }
    if (promotion.minOrderAmount && subtotal < promotion.minOrderAmount) {
        return { error: `Montant minimum de commande ${promotion.minOrderAmount} FCFA requis.` };
    }
    if (promotion.maxUses !== null && promotion.maxUses !== undefined && promotion.usedCount >= promotion.maxUses) {
        return { error: 'Ce code promo a atteint sa limite d’utilisation.' };
    }
    if (promotion.maxUsesPerUser) {
        const userUses = await PromoUsage.countDocuments({ promotionId: promotion._id, userId });
        if (userUses >= promotion.maxUsesPerUser) {
            return { error: 'Vous avez déjà utilisé ce code promo le nombre maximum de fois.' };
        }
    }

    const eligibleProducts = promotion.applicableProducts?.map(String) || [];
    const excludedProducts = promotion.excludedProducts?.map(String) || [];
    const eligibleCategories = promotion.applicableCategories || [];
    const excludedCategories = promotion.excludedCategories || [];

    let eligibleSubtotal = 0;
    for (const item of cartItems) {
        const productId = String(item.productId || item._id || item.id);
        const category = item.category || item.productCategory || '';
        const unitPrice = Number(item.price || item.salePrice || item.promoPrice || 0);
        const itemSubtotal = unitPrice * Number(item.quantity || 1);

        const isExcludedProduct = excludedProducts.length > 0 && excludedProducts.includes(productId);
        const isExcludedCategory = excludedCategories.length > 0 && excludedCategories.includes(category);
        const isSaleProduct = promotion.excludeOnSale && Number(item.salePrice || item.promoPrice || 0) > 0 && Number(item.salePrice || item.promoPrice || 0) < Number(item.price || 0);

        if (isExcludedProduct || isExcludedCategory || isSaleProduct) {
            continue;
        }

        if (eligibleProducts.length > 0 && !eligibleProducts.includes(productId)) {
            continue;
        }

        if (eligibleCategories.length > 0 && !eligibleCategories.includes(category)) {
            continue;
        }

        eligibleSubtotal += itemSubtotal;
    }

    if (eligibleSubtotal <= 0) {
        return { error: 'Aucun article éligible pour ce code promo.' };
    }

    let discount = 0;
    if (promotion.discountType === 'percentage') {
        const raw = eligibleSubtotal * (promotion.discountValue / 100);
        discount = promotion.maxDiscount ? Math.min(raw, promotion.maxDiscount) : raw;
    } else {
        discount = Math.min(Number(promotion.discountValue || 0), eligibleSubtotal);
    }

    return { promotion, discount, eligibleSubtotal };
};

// POST - Aperçu de commande côté serveur
router.post('/preview', verifyToken, async (req, res) => {
    try {
        const { items, shippingMethod = 'standard', promoCode } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Aucun article dans la commande' });
        }

        let subtotal = 0;
        const previewItems = [];
        for (const item of items) {
            const product = await Product.findById(item.productId);
            if (!product) {
                return res.status(404).json({ success: false, message: `Produit ${item.productId} non trouvé` });
            }
            const unitPrice = Number(product.salePrice || product.price || 0);
            subtotal += unitPrice * Number(item.quantity || 1);
            previewItems.push({
                productId: product._id,
                category: product.category,
                price: product.price,
                salePrice: product.salePrice,
                quantity: item.quantity,
            });
        }

        const promoResult = await validatePromotion(promoCode, subtotal, req.user.id, previewItems);
        if (promoResult.error) {
            return res.status(400).json({ success: false, message: promoResult.error });
        }

        const shippingCost = getShippingCost(subtotal, shippingMethod);
        const discount = promoResult.discount || 0;
        const tax = 0;
        const total = Math.max(0, subtotal + shippingCost - discount);

        return res.json({
            success: true,
            data: {
                subtotal,
                shippingCost,
                tax,
                discount,
                total,
                shippingMethod,
                promoCode: promoCode ? String(promoCode).toUpperCase() : '',
            }
        });
    } catch (error) {
        console.error('[orderRoutes.js] preview:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// POST - Créer une nouvelle commande
router.post('/', verifyToken, async (req, res) => {
    try {
        const { items, shippingAddress, shippingMethod, paymentMethod, promoCode } = req.body;

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
                vendorName: product.vendorName || 'Vendeur Indépendant',
                vendorId: product.vendorId || null,
                price: itemPrice,
                originalPrice: product.price,
                salePrice: product.salePrice,
                category: product.category,
                quantity: item.quantity,
                selectedOptions: item.selectedOptions || {},
                subtotal: itemTotal
            });

            subtotal += itemTotal;
        }

        const promoResult = await validatePromotion(promoCode, subtotal, req.user.id, orderItems.map((item) => ({
            productId: item.productId,
            category: item.category,
            price: item.originalPrice,
            salePrice: item.salePrice,
            quantity: item.quantity,
        })));
        if (promoResult.error) {
            return res.status(400).json({ success: false, message: promoResult.error });
        }

        const shippingCost = getShippingCost(subtotal, shippingMethod);
        const discount = promoResult.discount || 0;
        const promotion = promoResult.promotion || null;
        let estimatedDelivery = new Date();

        if (shippingMethod === 'express') {
            estimatedDelivery.setDate(estimatedDelivery.getDate() + 2);
        } else if (shippingMethod === 'pickup') {
            estimatedDelivery.setDate(estimatedDelivery.getDate() + 1);
        } else {
            estimatedDelivery.setDate(estimatedDelivery.getDate() + 5);
        }

        const tax = 0;
        const total = Math.max(0, subtotal + shippingCost - discount);
        const paymentStatus = ['fedapay', 'mobile_money'].includes(paymentMethod) ? 'completed' : 'pending';
        const orderStatus = paymentStatus === 'completed' ? 'confirmed' : 'pending';

        const order = new Order({
            orderNumber: generateOrderNumber(),
            customerId: req.user.id,
            customerName: `${req.user.userFirstname} ${req.user.userSurname}`,
            customerEmail: req.body.customerEmail || req.user.userEmail,
            customerPhone: req.body.customerPhone || req.user.userPhone || '',
            shippingAddress,
            items: orderItems,
            subtotal,
            shippingCost,
            tax,
            discount,
            total,
            shippingMethod,
            estimatedDelivery,
            paymentMethod,
            paymentStatus,
            status: orderStatus,
            paymentDate: paymentStatus === 'completed' ? new Date() : null,
        });

        // Determine delivery provider when possible
        try {
            const vendorIds = [...new Set(orderItems.map(i => i.vendorId).filter(Boolean).map(String))];
            let providerResult = null;
            if (vendorIds.length === 1) {
                const store = await Store.findOne({ userId: vendorIds[0] });
                // shippingAddress may contain location coordinates
                const clientLoc = shippingAddress?.location?.coordinates || (shippingAddress?.lat && shippingAddress?.lng ? { lat: shippingAddress.lat, lng: shippingAddress.lng } : null);
                providerResult = await determineDeliveryProvider({ store, clientLocation: clientLoc });
            } else {
                // multiple vendors => default to DANGOIMPORT
                providerResult = { provider: 'DANGOIMPORT', reason: 'multiple_vendors' };
            }

            if (providerResult) {
                order.deliveryProvider = providerResult.provider;
                order.deliveryProviderReason = providerResult.reason;
                if (providerResult.distanceKm !== undefined) order.deliveryDistanceKm = providerResult.distanceKm;
            }
        } catch (e) {
            console.error('[orderRoutes] determineDeliveryProvider error:', e);
        }

        await order.save();

        // Réduire le stock
        for (const item of items) {
            await Product.findByIdAndUpdate(item.productId, {
                $inc: { stock: -item.quantity, totalSales: item.quantity }
            });
        }

        if (promotion && discount > 0) {
            await Promotion.findByIdAndUpdate(promotion._id, { $inc: { usedCount: 1 } });
            await PromoUsage.create({
                promotionId: promotion._id,
                code: promotion.code,
                userId: req.user.id,
                orderId: order._id,
                subtotal,
                discountAmount: discount,
            });
        }

        // Vider le panier
        await Cart.findOneAndUpdate({ userId: req.user.id }, { items: [], totalItems: 0, totalPrice: 0 });

        res.json({ success: true, message: 'Commande créée', data: order });
    } catch (error) {
      console.error("[orderRoutes.js] Erreur capturée :", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET - Mes commandes
router.get('/my-orders', verifyToken, async (req, res) => {
    return res.status(403).json({
        success: false,
        message: "L'accès à l'historique des commandes via l'application est suspendu. Vos codes QR et détails de commande vous ont été envoyés par email."
    });
});

// GET - Détails de la commande
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Commande non trouvée' });
        }

        // Vérifier que l'utilisateur est le propriétaire ou un admin
        if (order.customerId.toString() !== req.user.id && !['admin', 'dev-admin'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Accès refusé' });
        }

        res.json({ success: true, data: order });
    } catch (error) {
      console.error("[orderRoutes.js] Erreur capturée :", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET - Facture PDF de la commande
router.get('/:id/invoice', verifyToken, async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Commande non trouvée' });
        }

        if (order.customerId.toString() !== req.user.id && !['admin', 'dev-admin'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Accès refusé' });
        }

        const { streamOrderInvoicePdf } = require('../utils/invoiceGenerator');
        streamOrderInvoicePdf(res, order, { fileName: `facture-${order.orderNumber || order._id}.pdf` });
    } catch (error) {
      console.error("[orderRoutes.js] Erreur capturée :", error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: error.message });
        }
    }
});

// GET - Toutes les commandes (Admin)
router.get('/admin/all', verifyToken, async (req, res) => {
    try {
        if (!['admin', 'dev-admin'].includes(req.user.role)) {
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
      console.error("[orderRoutes.js] Erreur capturée :", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// PATCH - Mettre à jour le statut de la commande (Admin)
router.patch('/:id/status', verifyToken, async (req, res) => {
    try {
        if (!['admin', 'dev-admin'].includes(req.user.role)) {
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
      console.error("[orderRoutes.js] Erreur capturée :", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
