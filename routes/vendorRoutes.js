const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../Models/User');
const Product = require('../Models/Product');
const Order = require('../Models/Commande');
const verifyToken = require('../Middlewares/verifyTokens');

const router = express.Router();

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
  vendorDescription: user.vendorDescription || '',
  balance: user.balance || 0,
  bankDetails: user.bankDetails || {},
});

const signVendorToken = (user) => jwt.sign(
  {
    userId: user._id,
    role: user.role,
    userFirstname: user.userFirstname,
    userSurname: user.userSurname,
    userEmail: user.userEmail,
  },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);

router.post('/promote', verifyToken, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.userId || req.user.id);
    if (!currentUser) {
      return res.status(404).json({ message: 'Utilisateur introuvable.' });
    }

    currentUser.role = 'vendor';
    currentUser.isVendor = true;
    currentUser.vendorName = currentUser.vendorName || `${currentUser.userFirstname || ''} ${currentUser.userSurname || ''}`.trim();

    await currentUser.save();

    const token = signVendorToken(currentUser);
    return res.status(200).json({
      message: 'Compte promu vendeur avec succès.',
      token,
      user: buildVendorPayload(currentUser),
    });
  } catch (error) {
    console.error('[vendorRoutes.js] promote:', error);
    return res.status(500).json({ message: 'Erreur lors de la promotion du compte.' });
  }
});

router.post('/register', async (req, res) => {
  try {
    const { userFirstname, userSurname, userEmail, userPassword, vendorName, vendorDescription } = req.body;

    if (!userFirstname || !userSurname || !userEmail || !userPassword) {
      return res.status(400).json({ message: 'Veuillez remplir tous les champs requis.' });
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
      role: 'vendor',
      isVendor: true,
      vendorName: vendorName || `${userFirstname} ${userSurname}`.trim(),
      vendorDescription,
      isVerified: true,
    });

    await newUser.save();

    const token = signVendorToken(newUser);
    return res.status(201).json({
      message: 'Compte vendeur créé avec succès.',
      token,
      user: buildVendorPayload(newUser),
    });
  } catch (error) {
    console.error('[vendorRoutes.js] register:', error);
    return res.status(500).json({ message: 'Erreur serveur lors de la création du compte vendeur.' });
  }
});

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

    const token = signVendorToken(user);
    return res.status(200).json({
      message: 'Connexion vendeur réussie.',
      token,
      user: buildVendorPayload(user),
    });
  } catch (error) {
    console.error('[vendorRoutes.js] login:', error);
    return res.status(500).json({ message: 'Erreur serveur lors de la connexion vendeur.' });
  }
});

router.get('/products', verifyToken, async (req, res) => {
  try {
    if ((req.user?.role || '').toLowerCase() !== 'vendor') {
      return res.status(403).json({ message: 'Accès réservé aux vendeurs.' });
    }

    const products = await Product.find({ vendorId: req.user.userId || req.user.id }).sort({ createdAt: -1 }).lean();
    return res.status(200).json({ success: true, data: products });
  } catch (error) {
    console.error('[vendorRoutes.js] get products:', error);
    return res.status(500).json({ message: 'Erreur serveur lors de la récupération des produits.' });
  }
});

router.post('/products', verifyToken, async (req, res) => {
  try {
    if ((req.user?.role || '').toLowerCase() !== 'vendor') {
      return res.status(403).json({ message: 'Accès réservé aux vendeurs.' });
    }

    const { name, description, price, stock, category, images, country, shortDescription, brand } = req.body;
    if (!name || !description || !price || !stock || !category) {
      return res.status(400).json({ message: 'Nom, description, prix, stock et catégorie sont requis.' });
    }

    const user = await User.findById(req.user.userId || req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'Compte vendeur introuvable.' });
    }

    const product = new Product({
      name,
      description,
      shortDescription: shortDescription || description,
      price: Number(price),
      salePrice: Number(price),
      stock: Number(stock),
      category,
      brand: brand || user.vendorName || `${user.userFirstname} ${user.userSurname}`.trim(),
      vendorId: user._id,
      vendorName: user.vendorName || `${user.userFirstname} ${user.userSurname}`.trim(),
      images: Array.isArray(images) ? images.map((url, index) => ({ url, alt: name, isPrimary: index === 0 })) : [],
      image: Array.isArray(images) && images.length ? images[0] : '',
      isPublished: true,
      country: country || 'Togo',
      status: 'active',
    });

    await product.save();
    return res.status(201).json({ success: true, message: 'Produit publié avec succès.', data: product });
  } catch (error) {
    console.error('[vendorRoutes.js] create product:', error);
    return res.status(500).json({ message: 'Erreur serveur lors de la publication du produit.' });
  }
});

router.put('/products/:id', verifyToken, async (req, res) => {
  try {
    if ((req.user?.role || '').toLowerCase() !== 'vendor') {
      return res.status(403).json({ message: 'Accès réservé aux vendeurs.' });
    }

    const product = await Product.findOne({ _id: req.params.id, vendorId: req.user.userId || req.user.id });
    if (!product) {
      return res.status(404).json({ message: 'Produit introuvable ou non autorisé.' });
    }

    Object.assign(product, req.body);
    product.updatedAt = new Date();
    await product.save();

    return res.status(200).json({ success: true, message: 'Produit mis à jour.', data: product });
  } catch (error) {
    console.error('[vendorRoutes.js] update product:', error);
    return res.status(500).json({ message: 'Erreur serveur lors de la mise à jour du produit.' });
  }
});

router.delete('/products/:id', verifyToken, async (req, res) => {
  try {
    if ((req.user?.role || '').toLowerCase() !== 'vendor') {
      return res.status(403).json({ message: 'Accès réservé aux vendeurs.' });
    }

    const product = await Product.findOneAndDelete({ _id: req.params.id, vendorId: req.user.userId || req.user.id });
    if (!product) {
      return res.status(404).json({ message: 'Produit introuvable ou non autorisé.' });
    }

    return res.status(200).json({ success: true, message: 'Produit supprimé.' });
  } catch (error) {
    console.error('[vendorRoutes.js] delete product:', error);
    return res.status(500).json({ message: 'Erreur serveur lors de la suppression du produit.' });
  }
});

router.get('/orders', verifyToken, async (req, res) => {
  try {
    if ((req.user?.role || '').toLowerCase() !== 'vendor') {
      return res.status(403).json({ message: 'Accès réservé aux vendeurs.' });
    }

    const vendorProducts = await Product.find({ vendorId: req.user.userId || req.user.id }).select('_id').lean();
    const productIds = vendorProducts.map((product) => product._id);
    const orders = await Order.find({ 'items.productId': { $in: productIds } }).sort({ createdAt: -1 }).lean();

    return res.status(200).json({ success: true, data: orders });
  } catch (error) {
    console.error('[vendorRoutes.js] get orders:', error);
    return res.status(500).json({ message: 'Erreur serveur lors de la récupération des commandes.' });
  }
});

module.exports = router;
