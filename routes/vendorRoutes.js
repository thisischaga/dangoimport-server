const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const slugify = require('slugify');
const User = require('../Models/User');
const Store = require('../Models/Store');
const Product = require('../Models/Product');
const VendorProduct = require('../Models/VendorProduct');
const VendorOrder = require('../Models/VendorOrder');
const QRCode = require('../Models/QRCode');
const Otp = require('../Models/Otp');
const verifyToken = require('../Middlewares/verifyTokens');
const { buildProductPayload } = require('../utils/productPayload');
const { normalizeProductImages } = require('../utils/imageStorage');
const { resolveSkuForCreate } = require('../utils/productIdentifiers');
const { Resend } = require('resend');

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

// Middleware vendeur
const verifyVendor = async (req, res, next) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const user = await User.findById(userId);
    if (!user || user.role !== 'vendor') {
      return res.status(403).json({ message: 'Accès réservé aux vendeurs.' });
    }
    req.vendorUser = user;
    next();
  } catch (error) {
    return res.status(500).json({ message: 'Erreur de vérification vendeur.' });
  }
};

async function ensureVendorStore(user) {
  let store = await Store.findOne({ userId: user._id });
  if (store) return store;

  const baseName = user.vendorName || `${user.userFirstname || ''} ${user.userSurname || ''}`.trim() || 'Ma boutique';
  const storeSlug = `${slugify(baseName, { lower: true, strict: true })}-${Math.random().toString(36).substring(2, 6)}`;
  store = await Store.create({
    userId: user._id,
    slug: storeSlug,
    name: baseName,
    whatsapp: user.userPhone || '',
  });
  return store;
}

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

// Resend client configuration
const resend = new Resend(process.env.RESEND_API_KEY);

// POST /api/vendor/become-vendor — upgrade instantané (sans validation admin)
router.post('/become-vendor', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId || req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur introuvable.' });
    }

    user.role = 'vendor';
    user.isVendor = true;
    if (!user.vendorName) {
      user.vendorName = `${user.userFirstname || ''} ${user.userSurname || ''}`.trim() || 'Ma boutique';
    }
    await user.save();

    const store = await ensureVendorStore(user);
    const token = signVendorToken(user);

    return res.status(200).json({
      success: true,
      message: 'Vous êtes maintenant vendeur sur DANGOIMPORT.',
      token,
      user: {
        ...buildVendorPayload(user),
        storeId: store._id,
        slug: store.slug,
      },
    });
  } catch (error) {
    console.error('[become-vendor] error:', error);
    return res.status(500).json({ message: 'Erreur lors de l’activation du compte vendeur.' });
  }
});

// POST /api/vendor/send-otp
router.post('/send-otp', async (req, res) => {
  try {
    const { name, email, password, storeName, whatsapp, description } = req.body;

    if (!name || !email || !password || !storeName) {
      return res.status(400).json({ message: 'Veuillez remplir tous les champs requis.' });
    }

    // 1. Verify if email already exists in User
    const existingUser = await User.findOne({ userEmail: String(email).toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ message: 'Cet email est déjà utilisé.' });
    }

    // 2. Generate 6-digit random OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    // 3. Save to Otp collection (using findOneAndUpdate to avoid duplicate email key violations)
    await Otp.findOneAndUpdate(
      { email: String(email).toLowerCase() },
      {
        otp: otpCode,
        data: { name, email, password, storeName, whatsapp, description },
        createdAt: new Date()
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // 4. Send email via Resend
    const fromEmail = process.env.EMAIL ? `Dango Seller <${process.env.EMAIL}>` : 'Dango Seller <onboarding@resend.dev>';
    await resend.emails.send({
      from: fromEmail,
      to: [email],
      subject: 'Code de vérification Dango Seller',
      text: `Votre code de vérification est : ${otpCode}. Il expire dans 10 minutes.`,
      html: `<div style="font-family: sans-serif; padding: 20px; color: #0f172a;">
               <h2 style="color: #f68b1e;">Vérification Dango Seller</h2>
               <p>Bonjour,</p>
               <p>Merci de créer votre boutique sur Dango Seller. Veuillez utiliser le code de vérification ci-dessous pour confirmer votre adresse email :</p>
               <div style="font-size: 24px; font-weight: bold; letter-spacing: 4px; padding: 12px 20px; background: #f1f5f9; display: inline-block; border-radius: 6px; color: #0f172a; margin: 15px 0;">
                 ${otpCode}
               </div>
               <p style="font-size: 13px; color: #64748b;">Ce code expire dans 10 minutes.</p>
             </div>`
    });

    return res.status(200).json({ success: true, message: 'OTP envoyé avec succès.' });
  } catch (error) {
    console.error('[send-otp] error:', error);
    return res.status(500).json({ message: 'Erreur lors de la génération ou de l\'envoi du code de vérification.' });
  }
});

// POST /api/vendor/verify-otp
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: 'Email et code OTP requis.' });
    }

    // 1. Search in Otp collection
    const otpDoc = await Otp.findOne({ email: String(email).toLowerCase(), otp: String(otp).trim() });
    if (!otpDoc) {
      return res.status(400).json({ message: 'Code de vérification invalide ou expiré.' });
    }

    const { name, password, storeName, whatsapp, description } = otpDoc.data;

    // Check if email already used (in case register succeeded in the meantime)
    const existingUser = await User.findOne({ userEmail: String(email).toLowerCase() });
    if (existingUser) {
      await Otp.deleteOne({ _id: otpDoc._id });
      return res.status(400).json({ message: 'Cet email est déjà utilisé.' });
    }

    // 2. Create User and hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    const names = String(name).trim().split(/\s+/);
    const userFirstname = names[0];
    const userSurname = names.slice(1).join(' ') || names[0];

    const newUser = new User({
      userFirstname,
      userSurname,
      userEmail: String(email).toLowerCase(),
      userPassword: hashedPassword,
      userPhone: whatsapp || '',
      role: 'vendor',
      isVendor: true,
      vendorName: storeName,
      isVerified: true
    });

    await newUser.save();

    // 3. Create Store
    const storeSlug = slugify(storeName, { lower: true, strict: true }) + '-' + Math.random().toString(36).substring(2, 6);
    const newStore = new Store({
      userId: newUser._id,
      slug: storeSlug,
      name: storeName,
      description: description || '',
      whatsapp: whatsapp || '',
    });

    await newStore.save();

    // 4. Delete Otp document
    await Otp.deleteOne({ _id: otpDoc._id });

    // 5. Generate JWT and respond
    const token = signVendorToken(newUser);
    return res.status(200).json({
      success: true,
      message: 'Compte vendeur et boutique créés avec succès.',
      token,
      user: {
        ...buildVendorPayload(newUser),
        store: newStore
      }
    });

  } catch (error) {
    console.error('[verify-otp] error:', error);
    return res.status(500).json({ message: 'Erreur lors de la vérification du code et de la création du compte.' });
  }
});

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

// GET /api/vendor/store (Get current store settings)
router.get('/store', verifyToken, getStore, async (req, res) => {
  try {
    return res.status(200).json({ success: true, data: req.store });
  } catch (error) {
    console.error('[vendorRoutes.js] get store settings:', error);
    return res.status(500).json({ message: 'Erreur serveur lors de la récupération des paramètres de la boutique.' });
  }
});

// PUT /api/vendor/store (Update store settings)
router.put('/store', verifyToken, getStore, async (req, res) => {
  try {
    const { name, description, whatsapp, fedaPayLink } = req.body;
    if (!name) {
      return res.status(400).json({ message: 'Le nom de la boutique est requis.' });
    }

    req.store.name = name.trim();
    req.store.description = description ? description.trim() : '';
    req.store.whatsapp = whatsapp ? whatsapp.trim() : '';
    req.store.fedaPayLink = fedaPayLink ? fedaPayLink.trim() : '';

    await req.store.save();
    return res.status(200).json({ success: true, data: req.store });
  } catch (error) {
    console.error('[vendorRoutes.js] update store settings:', error);
    return res.status(500).json({ message: 'Erreur serveur lors de la mise à jour des paramètres.' });
  }
});

// GET /api/vendor/dashboard/stats
router.get('/dashboard/stats', verifyToken, getStore, async (req, res) => {
  try {
    const vendorId = req.vendorUser?._id || req.user?.userId || req.user?.id;
    const storeId = req.storeId;
    if (!vendorId) {
      console.error('[vendorRoutes.js] get dashboard stats: missing vendor id', { user: req.user, vendorUser: req.vendorUser });
      return res.status(400).json({ message: 'Impossible de récupérer l’identifiant du vendeur.' });
    }
    const nb_produits = await Product.countDocuments({ vendorId, isPublished: true });

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const monthlyStats = await VendorOrder.aggregate([
      { $match: { storeId, createdAt: { $gte: startOfMonth } } },
      {
        $group: {
          _id: null,
          ventes_mois: { $sum: 1 },
          ca_total: { $sum: '$total' },
        },
      },
    ]);

    const ordersByStatus = await VendorOrder.aggregate([
      { $match: { storeId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]);

    const statusCounts = ordersByStatus.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {});

    const lowStockCount = await Product.countDocuments({ vendorId, stock: { $lte: 5 }, isPublished: true });

    const stats = monthlyStats[0] || { ventes_mois: 0, ca_total: 0 };

    return res.status(200).json({
      success: true,
      data: {
        nb_produits,
        ventes_mois: stats.ventes_mois,
        ca_total: stats.ca_total,
        pendingOrders: statusCounts.pending || 0,
        paidOrders: statusCounts.paid || 0,
        shippedOrders: statusCounts.shipped || 0,
        deliveredOrders: statusCounts.delivered || 0,
        lowStockCount,
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

// GET /api/vendor/products — produits marketplace du vendeur
router.get('/products', verifyToken, verifyVendor, async (req, res) => {
  try {
    const products = await Product.find({ vendorId: req.vendorUser._id }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: products });
  } catch (error) {
    console.error('[vendorRoutes.js] get products:', error);
    return res.status(500).json({ message: 'Erreur serveur lors de la récupération des produits.' });
  }
});

// POST /api/vendor/products — publier un produit sur la marketplace
router.post('/products', verifyToken, verifyVendor, async (req, res) => {
  try {
    const { name, description, price, stock, category, images, image, imageBase64, country } = req.body;

    if (!name || !description || price === undefined || stock === undefined || !category) {
      return res.status(400).json({ message: 'Nom, description, prix, stock et catégorie sont requis.' });
    }

    const imageList = [];
    if (Array.isArray(images)) {
      images.forEach((img, i) => {
        const url = typeof img === 'string' ? img : img?.url;
        if (url) imageList.push({ url, alt: name, isPrimary: i === 0 });
      });
    }
    if (imageBase64) {
      const urls = Array.isArray(imageBase64) ? imageBase64 : [imageBase64];
      urls.forEach((url, i) => {
        if (url) imageList.push({ url, alt: name, isPrimary: imageList.length === 0 && i === 0 });
      });
    }
    if (image && !imageList.length) {
      imageList.push({ url: image, alt: name, isPrimary: true });
    }

    if (!imageList.length) {
      return res.status(400).json({ message: 'Au moins une image est requise.' });
    }

    let payload = buildProductPayload({
      ...req.body,
      name,
      description,
      price,
      stock,
      category,
      image: imageList[0].url,
      images: imageList,
      isPublished: false,
      validationStatus: 'pending',
      vendorName: req.vendorUser.vendorName || `${req.vendorUser.userFirstname} ${req.vendorUser.userSurname}`.trim(),
      shippingInfo: country ? `Livraison: ${country}` : undefined,
    });

    payload.vendorId = req.vendorUser._id;
    payload.sku = await resolveSkuForCreate(payload.sku);
    payload = await normalizeProductImages(payload);
    payload.history = [
      {
        action: 'Créé & soumis à validation',
        comment: 'Produit soumis à l’équipe de modération Dango Import.',
        performedBy: req.vendorUser.vendorName || `${req.vendorUser.userFirstname} ${req.vendorUser.userSurname}`.trim(),
        role: 'vendor',
        date: new Date(),
      }
    ];

    const newProduct = new Product(payload);
    await newProduct.save();

    const cache = require('../utils/cache');
    cache.delPrefix('products:');

    return res.status(201).json({ success: true, data: newProduct });
  } catch (error) {
    console.error('[vendorRoutes.js] create product:', error);
    return res.status(500).json({ message: error.message || 'Erreur serveur lors de la création du produit.' });
  }
});

// PUT /api/vendor/products/:id — Ré-édition et resoumission par le vendeur
router.put('/products/:id', verifyToken, verifyVendor, async (req, res) => {
  try {
    const existing = await Product.findOne({ _id: req.params.id, vendorId: req.vendorUser._id });
    if (!existing) {
      return res.status(404).json({ message: 'Produit introuvable.' });
    }

    let payload = buildProductPayload(req.body, { existingProduct: existing });
    payload.vendorId = req.vendorUser._id;
    
    // Si le produit nécessitait des modifications ou était rejeté, sa mise à jour le repasse en validation
    if (['changes_requested', 'rejected', 'draft'].includes(existing.validationStatus)) {
      payload.validationStatus = 'pending';
      payload.isPublished = false;
    } else {
      payload.validationStatus = existing.validationStatus;
      payload.isPublished = existing.isPublished;
    }

    payload = await normalizeProductImages(payload, { existingProduct: existing });

    // Ajout d'une entrée dans l'historique
    const vendorName = req.vendorUser.vendorName || `${req.vendorUser.userFirstname} ${req.vendorUser.userSurname}`.trim();
    payload.history = [
      ...(existing.history || []),
      {
        action: 'Modifié & Renvoyé',
        comment: 'Le vendeur a mis à jour les informations du produit.',
        performedBy: vendorName,
        role: 'vendor',
        date: new Date(),
      }
    ];

    const updated = await Product.findByIdAndUpdate(req.params.id, payload, { new: true });
    const cache = require('../utils/cache');
    cache.delPrefix('products:');

    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    console.error('[vendorRoutes.js] update product:', error);
    return res.status(500).json({ message: error.message || 'Erreur serveur lors de la modification du produit.' });
  }
});

// DELETE /api/vendor/products/:id
router.delete('/products/:id', verifyToken, verifyVendor, async (req, res) => {
  try {
    const productId = req.params.id;
    const vendorId = req.vendorUser?._id;

    let deleted = await Product.findOneAndDelete({
      _id: productId,
      $or: [
        { vendorId: vendorId },
        { vendorUser: vendorId },
        { vendorName: req.vendorUser?.vendorName || `${req.vendorUser?.userFirstname} ${req.vendorUser?.userSurname}`.trim() },
      ],
    });

    if (!deleted) {
      deleted = await Product.findByIdAndDelete(productId);
    }

    if (!deleted) {
      return res.status(404).json({ message: 'Produit introuvable.' });
    }

    const cache = require('../utils/cache');
    cache.delPrefix('products:');

    return res.status(200).json({ success: true, message: 'Produit supprimé avec succès.' });
  } catch (error) {
    console.error('[vendorRoutes.js] delete product:', error);
    return res.status(500).json({ message: 'Erreur serveur lors de la suppression du produit.' });
  }
});

// GET /api/vendor/orders
router.get('/orders', verifyToken, getStore, async (req, res) => {
  try {
    const orders = await VendorOrder.find({ storeId: req.storeId }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: orders });
  } catch (error) {
    console.error('[vendorRoutes.js] get orders:', error);
    return res.status(500).json({ message: 'Erreur serveur lors de la récupération des commandes.' });
  }
});

// PATCH /api/vendor/orders/:id/status
router.patch('/orders/:id/status', verifyToken, getStore, async (req, res) => {
  try {
    const { status } = req.body;
    const allowedStatuses = ['pending', 'paid', 'shipped', 'delivered'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: 'Statut invalide.' });
    }

    const order = await VendorOrder.findOne({ _id: req.params.id, storeId: req.storeId });
    if (!order) {
      return res.status(404).json({ message: 'Commande introuvable.' });
    }

    order.status = status;
    if (status === 'shipped') {
      order.shippedAt = new Date();
    }
    if (status === 'delivered') {
      order.deliveredAt = new Date();
    }
    order.updatedAt = new Date();
    await order.save();

    return res.status(200).json({ success: true, data: order });
  } catch (error) {
    console.error('[vendorRoutes.js] update order status:', error);
    return res.status(500).json({ message: 'Erreur serveur lors de la mise à jour du statut de la commande.' });
  }
});

module.exports = router;
