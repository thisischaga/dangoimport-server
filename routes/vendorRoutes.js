const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const slugify = require('slugify');
const User = require('../Models/User');
const Store = require('../Models/Store');
const VendorProduct = require('../Models/VendorProduct');
const VendorOrder = require('../Models/VendorOrder');
const verifyToken = require('../Middlewares/verifyTokens');

const router = express.Router();

// Helper to build vendor user payload
const buildVendorPayload = (user) => ({
  id: user._id,
  userId: user._id,
  userFirstname: user.userFirstname,
  userSurname: user.userSurname,
  userEmail: user.userEmail,
  userPhone: user.userPhone || '',
  role: user.role,
  isVendor: true,
  vendorName: user.vendorName || `${user.userFirstname || ''} ${user.userSurname || ''}`.trim(),
});

// Helper to sign JWT token
const signVendorToken = (user) => jwt.sign(
  {
    userId: user._id,
    role: user.role,
    userFirstname: user.userFirstname,
    userSurname: user.userSurname,
    userEmail: user.userEmail,
  },
  process.env.JWT_SECRET,
  { expiresIn: '24h' }
);

// Middleware to inject vendor's store
const getStore = async (req, res, next) => {
  try {
    const store = await Store.findOne({ userId: req.user.userId || req.user.id });
    if (!store) {
      return res.status(404).json({ message: "Boutique introuvable pour ce vendeur." });
    }
    req.store = store;
    req.storeId = store._id;
    next();
  } catch (error) {
    console.error('[getStore] error:', error);
    return res.status(500).json({ message: "Erreur serveur lors de la récupération de la boutique." });
  }
};

// POST /api/vendor/register
router.post('/register', async (req, res) => {
  try {
    const { userFirstname, userSurname, userEmail, userPassword, vendorName, userPhone } = req.body;

    if (!userFirstname || !userSurname || !userEmail || !userPassword || !vendorName) {
      return res.status(400).json({ message: 'Veuillez remplir tous les champs requis (nom de boutique inclus).' });
    }

    const existingUser = await User.findOne({ userEmail: String(userEmail).toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ message: 'Cet email est déjà utilisé.' });
    }

    const hashedPassword = await bcrypt.hash(userPassword, 10);
    const newUser = new User({
      userFirstname,
      userSurname,
      userEmail: String(userEmail).toLowerCase(),
      userPassword: hashedPassword,
      userPhone: userPhone || '',
      role: 'vendor',
      isVendor: true,
      vendorName,
      isVerified: true,
    });

    await newUser.save();

    // Create the Store for the new Vendor
    const storeSlug = slugify(vendorName, { lower: true, strict: true }) + '-' + Math.random().toString(36).substring(2, 6);
    const newStore = new Store({
      userId: newUser._id,
      slug: storeSlug,
      name: vendorName,
      whatsapp: userPhone || '',
    });

    await newStore.save();

    const token = signVendorToken(newUser);
    return res.status(201).json({
      message: 'Compte vendeur et boutique créés avec succès.',
      token,
      user: {
        ...buildVendorPayload(newUser),
        storeId: newStore._id,
        vendorName: newStore.name,
        slug: newStore.slug,
      },
    });
  } catch (error) {
    console.error('[vendorRoutes.js] register:', error);
    return res.status(500).json({ message: 'Erreur serveur lors de la création du compte vendeur.' });
  }
});

// POST /api/vendor/login
router.post('/login', async (req, res) => {
  try {
    const { userEmail, userPassword } = req.body;
    if (!userEmail || !userPassword) {
      return res.status(400).json({ message: 'Email et mot de passe requis.' });
    }

    const user = await User.findOne({ userEmail: String(userEmail).toLowerCase() });
    if (!user) {
      return res.status(401).json({ message: 'Compte introuvable.' });
    }

    if (user.role !== 'vendor') {
      return res.status(403).json({ message: 'Ce compte n’est pas un compte vendeur.' });
    }

    const isMatch = await bcrypt.compare(userPassword, user.userPassword);
    if (!isMatch) {
      return res.status(401).json({ message: 'Mot de passe incorrect.' });
    }

    // Find the corresponding Store
    const store = await Store.findOne({ userId: user._id });

    const token = signVendorToken(user);
    return res.status(200).json({
      message: 'Connexion vendeur réussie.',
      token,
      user: {
        ...buildVendorPayload(user),
        storeId: store ? store._id : null,
        vendorName: store ? store.name : user.vendorName,
        slug: store ? store.slug : '',
      },
    });
  } catch (error) {
    console.error('[vendorRoutes.js] login:', error);
    return res.status(500).json({ message: 'Erreur serveur lors de la connexion vendeur.' });
  }
});

// GET /api/vendor/dashboard/stats
router.get('/dashboard/stats', verifyToken, getStore, async (req, res) => {
  try {
    const nb_produits = await VendorProduct.countDocuments({ storeId: req.storeId });

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const statsArray = await VendorOrder.aggregate([
      { $match: { storeId: req.storeId } },
      {
        $group: {
          _id: null,
          nb_commandes: { $sum: 1 },
          ca_total: { $sum: '$total' },
          ventes_mois: {
            $sum: {
              $cond: [{ $gte: ['$createdAt', startOfMonth] }, 1, 0],
            },
          },
        },
      },
    ]);

    const stats = statsArray[0] || { nb_commandes: 0, ca_total: 0, ventes_mois: 0 };

    return res.status(200).json({
      success: true,
      data: {
        ventes_mois: stats.ventes_mois,
        nb_commandes: stats.nb_commandes,
        nb_produits,
        ca_total: stats.ca_total,
      },
    });
  } catch (error) {
    console.error('[vendorRoutes.js] get dashboard stats:', error);
    return res.status(500).json({ message: 'Erreur serveur lors du calcul des statistiques.' });
  }
});

// GET /api/vendor/dashboard/graph
router.get('/dashboard/graph', verifyToken, getStore, async (req, res) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const graphStats = await VendorOrder.aggregate([
      {
        $match: {
          storeId: req.storeId,
          createdAt: { $gte: sevenDaysAgo },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          ventes: { $sum: 1 },
          ca: { $sum: '$total' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Pre-fill last 7 days array
    const graphData = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      graphData.push({ date: dateStr, ventes: 0, ca: 0 });
    }

    // Merge aggregate results into prefilled array
    graphStats.forEach((item) => {
      const day = graphData.find((d) => d.date === item._id);
      if (day) {
        day.ventes = item.ventes;
        day.ca = item.ca;
      }
    });

    return res.status(200).json({
      success: true,
      data: graphData,
    });
  } catch (error) {
    console.error('[vendorRoutes.js] get dashboard graph:', error);
    return res.status(500).json({ message: 'Erreur serveur lors du chargement du graphique.' });
  }
});

// GET /api/vendor/products (List products filtered by storeId)
router.get('/products', verifyToken, getStore, async (req, res) => {
  try {
    const products = await VendorProduct.find({ storeId: req.storeId }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: products });
  } catch (error) {
    console.error('[vendorRoutes.js] get products:', error);
    return res.status(500).json({ message: 'Erreur serveur lors de la récupération des produits.' });
  }
});

// POST /api/vendor/products (Create product)
router.post('/products', verifyToken, getStore, async (req, res) => {
  try {
    const { name, description, price, stock, image, status, deliveryZones, characteristics } = req.body;

    if (!name || price === undefined || stock === undefined || !image) {
      return res.status(400).json({ message: 'Le nom, le prix, le stock et l\'image sont requis.' });
    }

    // Validate at least 1 delivery zone block containing country, region, and at least 1 quartier
    const zones = Array.isArray(deliveryZones)
      ? deliveryZones.filter(z => z.country && z.region && Array.isArray(z.quartiers) && z.quartiers.length > 0)
      : [];
    if (zones.length === 0) {
      return res.status(400).json({ message: 'Au moins une zone de livraison est requise.' });
    }

    // Normalize characteristics
    const chars = Array.isArray(characteristics)
      ? characteristics
          .filter(c => c.name && c.name.trim())
          .map(c => ({
            name: c.name.trim(),
            values: Array.isArray(c.values)
              ? c.values.map(v => String(v).trim()).filter(Boolean)
              : String(c.values || '').split(',').map(v => v.trim()).filter(Boolean),
          }))
      : [];

    const newProduct = new VendorProduct({
      storeId: req.storeId,
      name,
      description: description || '',
      price: Number(price),
      stock: Number(stock),
      image,
      status: status || 'active',
      deliveryZones: zones.map(z => ({
        country: z.country,
        region: z.region,
        quartiers: z.quartiers.map(q => ({
          name: q.name.trim(),
          price: Number(q.price) || 0
        }))
      })),
      characteristics: chars,
    });

    await newProduct.save();
    return res.status(201).json({ success: true, data: newProduct });
  } catch (error) {
    console.error('[vendorRoutes.js] create product:', error);
    return res.status(500).json({ message: 'Erreur serveur lors de la création du produit.' });
  }
});


// PUT /api/vendor/products/:id (Update product)
router.put('/products/:id', verifyToken, getStore, async (req, res) => {
  try {
    const updatedProduct = await VendorProduct.findOneAndUpdate(
      { _id: req.params.id, storeId: req.storeId },
      req.body,
      { new: true }
    );

    if (!updatedProduct) {
      return res.status(404).json({ message: 'Produit introuvable.' });
    }

    return res.status(200).json({ success: true, data: updatedProduct });
  } catch (error) {
    console.error('[vendorRoutes.js] update product:', error);
    return res.status(500).json({ message: 'Erreur serveur lors de la modification du produit.' });
  }
});

// DELETE /api/vendor/products/:id (Delete product)
router.delete('/products/:id', verifyToken, getStore, async (req, res) => {
  try {
    const deletedProduct = await VendorProduct.findOneAndDelete({
      _id: req.params.id,
      storeId: req.storeId,
    });

    if (!deletedProduct) {
      return res.status(404).json({ message: 'Produit introuvable.' });
    }

    return res.status(200).json({ success: true, message: 'Produit supprimé avec succès.' });
  } catch (error) {
    console.error('[vendorRoutes.js] delete product:', error);
    return res.status(500).json({ message: 'Erreur serveur lors de la suppression du produit.' });
  }
});

// GET /api/vendor/orders (List orders filtered by storeId)
router.get('/orders', verifyToken, getStore, async (req, res) => {
  try {
    const orders = await VendorOrder.find({ storeId: req.storeId }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: orders });
  } catch (error) {
    console.error('[vendorRoutes.js] get orders:', error);
    return res.status(500).json({ message: 'Erreur serveur lors de la récupération des commandes.' });
  }
});

module.exports = router;
