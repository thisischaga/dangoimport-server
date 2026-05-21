const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const compression = require('compression');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const crypto = require('crypto');
const paydunya = require('paydunya');
const { FedaPay, Transaction } = require('fedapay');
require('dotenv').config();
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const http = require('http');
const { initSocket } = require('./utils/socket');
const Notification = require('./Models/Notification');

const connectDB = require('./Congfig/db');
const verifyToken = require('./Middlewares/verifyTokens');
const Commande = require('./Models/Commande');
const Admin = require('./Models/Admin');
const Achat = require('./Models/Achat');
const Product = require('./Models/Product');
const Devis = require('./Models/Devis');
const Newsletter = require('./Models/Newsletter');
const authRoutes = require('./routes/authRoutes');
const { notifyAdmins } = require('./utils/notifications');
const { sendNotification } = require('./utils/socket');

const app = express();
app.set('trust proxy', 1);
app.use(compression());

// ═══════════════════════════════════════════════
// 🛡️  SÉCURITÉ
// ═══════════════════════════════════════════════
// Helmet : protection des headers HTTP (XSS, clickjacking, sniffing...)
app.use(helmet({
  contentSecurityPolicy: false, // désactivé car API REST (pas de HTML servi)
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // permet le fetch cross-origin des images
}));

// Morgan : logs d'accès en développement
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Rate Limiter général — anti-DDoS basique
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Trop de requêtes, réessayez dans 15 minutes.' },
  skip: (req, res) => {
    // Ne pas limiter les requêtes locales
    return req.ip === '::1' || req.ip === '127.0.0.1';
  }
});
app.use(generalLimiter);

// Rate Limiter strict pour le login admin — anti-bruteforce
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // max 5 tentatives
  skipSuccessfulRequests: true, // ne compte pas les succès
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Trop de tentatives de connexion. Compte temporairement bloqué (15 min).' }
});

const port = process.env.PORT || 8000;

// ═══════════════════════════════════════════════
// 💳 CONFIGURATION FEDAPAY
// ═══════════════════════════════════════════════
if (process.env.FEDAPAY_SECRET_KEY) {
  FedaPay.setApiKey(process.env.FEDAPAY_SECRET_KEY);
  FedaPay.setEnvironment('live');
}

// ═══════════════════════════════════════════════
// 💳 CONFIGURATION PAYDUNYA
// ═══════════════════════════════════════════════
const {
  PAYDUNYA_MASTER_KEY,
  PAYDUNYA_PRIVATE_KEY,
  PAYDUNYA_PUBLIC_KEY,
  PAYDUNYA_TOKEN,
  PAYDUNYA_MODE = 'test',
  PAYDUNYA_STORE_NAME = 'Dango Import',
  PAYDUNYA_STORE_TAGLINE = 'Import sécurisé depuis la Chine vers l\'Afrique',
  PAYDUNYA_STORE_WEBSITE = 'https://dangoimport.com',
  PAYDUNYA_STORE_LOGO = 'https://dangoimport.com/logo.png',
  PAYDUNYA_CALLBACK_URL = 'http://localhost:8000/api/paydunya/ipn',
  PAYDUNYA_RETURN_URL = 'http://localhost:3000/',
  PAYDUNYA_CANCEL_URL = 'http://localhost:3000/cart',
} = process.env;

const isPlaceholderKey = (value) => {
  if (!value) return true;
  const placeholderPatterns = ['replace_with_real', 'your_master_key', 'your_private_key', 'your_public_key', 'your_token', 'test_master_key', 'test_private_key', 'test_public_key', 'test_token'];
  return placeholderPatterns.some((pattern) => value.toLowerCase().includes(pattern));
};

let paydunyaSetup = null;
const paydunyaKeysConfigured = PAYDUNYA_MASTER_KEY && PAYDUNYA_PRIVATE_KEY && PAYDUNYA_PUBLIC_KEY && PAYDUNYA_TOKEN;
const paydunyaKeysArePlaceholders = paydunyaKeysConfigured && (
  isPlaceholderKey(PAYDUNYA_MASTER_KEY) ||
  isPlaceholderKey(PAYDUNYA_PRIVATE_KEY) ||
  isPlaceholderKey(PAYDUNYA_PUBLIC_KEY) ||
  isPlaceholderKey(PAYDUNYA_TOKEN)
);

if (paydunyaKeysConfigured && !paydunyaKeysArePlaceholders) {
  paydunyaSetup = new paydunya.Setup({
    masterKey: PAYDUNYA_MASTER_KEY,
    privateKey: PAYDUNYA_PRIVATE_KEY,
    publicKey: PAYDUNYA_PUBLIC_KEY,
    token: PAYDUNYA_TOKEN,
    mode: PAYDUNYA_MODE,
  });
} else if (paydunyaKeysConfigured && paydunyaKeysArePlaceholders) {
  console.warn('⚠️ PayDunya env variables appear to be placeholders. Remplacez-les par vos vraies clés PayDunya dans dangoimport-server/.env.');
} else {
  console.warn('⚠️ PayDunya env variables are not fully configured. PayDunya payment will not work.');
}

// CONFIGURATION CORS AMÉLIORÉE POUR iOS/macOS
const corsOptions = {
  origin: function (origin, callback) {
    const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
    // console.log('CORS origin check:', { origin, NODE_ENV: process.env.NODE_ENV, isDev });
    if (isDev) {
      return callback(null, true);
    }

    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:5173',
      'https://www.dangoimport.com',
      'https://dangoimport.com',
      'https://dangoimport-admin.vercel.app',
    ];

    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400, // Cache preflight pendant 24h
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Gérer explicitement les requêtes OPTIONS (préflight)
app.options('*', cors(corsOptions));

// Headers supplémentaires pour iOS/macOS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.header('Pragma', 'no-cache');
  res.header('Expires', '0');
  next();
});

// Parser avec limites augmentées pour les images
app.use(express.json({ limit: '125mb' }));
app.use(express.urlencoded({ limit: '125mb', extended: true }));

// Servir les images statiques
app.use('/images', express.static(path.join(__dirname, 'public/images')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

const devisUploadDir = path.join(__dirname, 'public/uploads/devis');
if (!fs.existsSync(devisUploadDir)) {
  fs.mkdirSync(devisUploadDir, { recursive: true });
}

const devisStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, devisUploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${uniqueSuffix}-${safeName}`);
  },
});

const devisUpload = multer({
  storage: devisStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Seules les images sont autorisées.'));
    }
    cb(null, true);
  },
});

// Point de départ du serveur
const startServer = async () => {
  try {
    connectDB();

    // Route de santé pour tester la connexion
    app.get('/health', (req, res) => {
      res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        platform: 'iOS/macOS compatible'
      });
    });

    // Ajouter un admin
    app.post('/add_admin', async (req, res) => {
      const { adminFirstname, adminSurname, adminName, adminPassword, role } = req.body;
      try {
        const existingAdmin = await Admin.findOne({ adminName });
        if (existingAdmin) {
          return res.status(400).json({ message: "Ce nom d'admin existe déjà !" });
        }

        const hashedPassword = await bcrypt.hash(adminPassword, 10);
        const newAdmin = new Admin({
          adminFirstname,
          adminSurname,
          adminName,
          adminPassword: hashedPassword,
          role,
        });
        await newAdmin.save();

        const token = jwt.sign(
          { userId: newAdmin._id },
          process.env.JWT_SECRET,
          { expiresIn: '1h' }
        );

        res.status(201).json({ message: 'Admin ajouté avec succès', token });
      } catch (error) {
        console.error('Erreur /add_admin :', error);
        res.status(500).json({ message: 'Erreur serveur', error: error.message });
      }
    });

    // Point de terminaison pour les demandes de devis
    app.post('/api/devis', async (req, res) => {
      try {
        const { name, phone, productLink, quantity, description, studyFee } = req.body;

        if (!name || !phone || !productLink || !quantity) {
          return res.status(400).json({ message: 'Veuillez remplir tous les champs obligatoires.' });
        }

        const newDevis = new Devis({
          name: name.trim(),
          phone: phone.trim(),
          productLink: productLink.trim(),
          quantity: Number(quantity),
          description: description ? description.trim() : '',
          studyFee: studyFee ? Number(studyFee) : 5000,
        });

        await newDevis.save();

        // Notification Admin
        await notifyAdmins({
          subject: '📝 Nouvelle demande de Devis',
          html: `
            <h2>Nouvelle demande de devis reçue</h2>
            <p><strong>Client :</strong> ${name}</p>
            <p><strong>Téléphone :</strong> ${phone}</p>
            <p><strong>Produit :</strong> <a href="${productLink}">${productLink}</a></p>
            <p><strong>Quantité :</strong> ${quantity}</p>
            <p><strong>Description :</strong> ${description || 'N/A'}</p>
            <hr/>
            <p><a href="http://localhost:5173/devis">Voir dans le panel admin</a></p>
          `
        });

        // Notification Temps Réel Admin
        await sendNotification({
          recipient: 'admin',
          type: 'devis',
          title: '📝 Nouveau Devis',
          message: `Demande de ${name} pour ${quantity} article(s).`,
          link: '/devis'
        });

        res.status(201).json({ message: 'Demande de devis reçue. Nous vous contacterons bientôt.' });
      } catch (error) {
        console.error('Erreur POST /api/devis :', error);
        res.status(500).json({ message: 'Erreur serveur', error: error.message });
      }
    });

    // Créer une facture PayDunya pour le devis
    app.post('/api/devis/create-invoice', devisUpload.single('photo'), async (req, res) => {
      if (!paydunyaSetup) {
        return res.status(500).json({ error: 'Configuration PayDunya invalide sur le serveur.' });
      }

      try {
        const { name, phone, productLink, quantity, description, studyFee } = req.body;
        if (!name || !phone || !productLink || !quantity) {
          return res.status(400).json({ message: 'Veuillez remplir tous les champs obligatoires.' });
        }

        const amount = Number(studyFee) || 5000;
        const photoUrl = req.file ? `${req.protocol}://${req.get('host')}/uploads/devis/${req.file.filename}` : undefined;
        const photoFilename = req.file ? req.file.filename : undefined;

        const paydunyaStore = new paydunya.Store({
          name: PAYDUNYA_STORE_NAME,
          tagline: PAYDUNYA_STORE_TAGLINE,
          websiteURL: PAYDUNYA_STORE_WEBSITE,
          logoURL: PAYDUNYA_STORE_LOGO,
          callbackURL: PAYDUNYA_CALLBACK_URL,
          returnURL: `${PAYDUNYA_RETURN_URL}?type=devis`,
          cancelURL: PAYDUNYA_CANCEL_URL,
        });

        const invoice = new paydunya.CheckoutInvoice(paydunyaSetup, paydunyaStore);
        invoice.description = `Frais d'étude de devis - ${name}`;
        invoice.totalAmount = amount;
        invoice.addItem('Frais étude devis', 1, amount, amount, 'Paiement du montant fixe de 5000 FCFA pour étude de devis');

        await invoice.create();

        const newDevis = new Devis({
          name: name.trim(),
          phone: phone.trim(),
          productLink: productLink.trim(),
          quantity: Number(quantity),
          description: description ? description.trim() : '',
          studyFee: amount,
          photoUrl,
          photoFilename,
          status: 'pending_payment',
          paymentToken: invoice.token,
          invoiceUrl: invoice.url,
          invoiceStatus: invoice.status,
        });
        await newDevis.save();

        // Notification Admin
        await notifyAdmins({
          subject: '💳 Nouveau Devis en attente de paiement',
          html: `
            <h2>Paiement de devis initié</h2>
            <p><strong>Client :</strong> ${name}</p>
            <p><strong>Montant :</strong> ${amount} FCFA</p>
            <p><strong>Produit :</strong> <a href="${productLink}">${productLink}</a></p>
            <p><strong>Lien de facture :</strong> <a href="${invoice.url}">PayDunya Invoice</a></p>
            <hr/>
            <p><a href="http://localhost:5173/devis">Voir dans le panel admin</a></p>
          `
        });

        return res.status(201).json({
          message: 'Devis enregistré. Redirection vers PayDunya.',
          url: invoice.url,
          token: invoice.token,
          devisId: newDevis._id,
        });
      } catch (error) {
        console.error('Erreur POST /api/devis/create-invoice :', error);
        const responseText = error?.responseText || error?.data || error?.message || null;
        return res.status(500).json({
          message: 'Erreur lors de la création du paiement du devis.',
          error: error.message,
          responseText,
        });
      }
    });

    // Connexion admin — PROTÉGÉ anti-bruteforce
    app.post('/login', adminLoginLimiter, async (req, res) => {
      const { adminName, adminPassword } = req.body;

      // Validation basique des inputs
      if (!adminName || !adminPassword) {
        return res.status(400).json({ message: "Identifiant et mot de passe requis." });
      }
      if (typeof adminName !== 'string' || typeof adminPassword !== 'string') {
        return res.status(400).json({ message: "Format invalide." });
      }

      try {
        const admin = await Admin.findOne({ adminName: adminName.toLowerCase().trim() });
        if (!admin) {
          // Message générique pour ne pas révéler si le compte existe
          return res.status(401).json({ message: "Identifiants incorrects." });
        }

        const isMatch = await bcrypt.compare(adminPassword, admin.adminPassword);
        if (!isMatch) {
          return res.status(401).json({ message: "Identifiants incorrects." });
        }

        // JWT incluant le rôle pour éviter des requêtes DB supplémentaires côté middleware
        const token = jwt.sign(
          { userId: admin._id, role: admin.role },
          process.env.JWT_SECRET,
          { expiresIn: '8h' }
        );

        res.status(200).json({
          message: 'Connexion réussie',
          token,
          user: {
            id: admin._id,
            firstname: admin.adminFirstname,
            surname: admin.adminSurname,
            email: admin.adminName,
            role: admin.role,
          }
        });
      } catch (error) {
        console.error('Erreur /login :', error);
        res.status(500).json({ message: 'Erreur serveur.' });
      }
    });

    // --- GESTION DES ADMINS (Réservé au Dev Admin) ---

    // Récupérer tous les admins
    app.get('/api/admins', verifyToken, async (req, res) => {
      try {
        const currentUser = await Admin.findById(req.user.userId);
        if (!currentUser || currentUser.role !== 'dev-admin') {
          return res.status(403).json({ message: "Action réservée au Dev Admin" });
        }
        const admins = await Admin.find().select('-adminPassword');
        res.status(200).json(admins);
      } catch (error) {
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Créer un admin
    app.post('/api/admins', verifyToken, async (req, res) => {
      try {
        const currentUser = await Admin.findById(req.user.userId);
        if (!currentUser || currentUser.role !== 'dev-admin') {
          return res.status(403).json({ message: "Action réservée au Dev Admin" });
        }
        const { adminFirstname, adminSurname, adminName, adminPassword, role } = req.body;
        
        const existing = await Admin.findOne({ adminName });
        if (existing) return res.status(400).json({ message: "Cet identifiant existe déjà" });

        const hashedPassword = await bcrypt.hash(adminPassword, 10);
        const newAdmin = new Admin({
          adminFirstname,
          adminSurname,
          adminName,
          adminPassword: hashedPassword,
          role: role || 'admin'
        });
        await newAdmin.save();
        res.status(201).json({ message: "Admin créé avec succès" });
      } catch (error) {
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Modifier un admin
    app.put('/api/admins/:id', verifyToken, async (req, res) => {
      try {
        const currentUser = await Admin.findById(req.user.userId);
        if (!currentUser || currentUser.role !== 'dev-admin') {
          return res.status(403).json({ message: "Action réservée au Dev Admin" });
        }
        const { adminFirstname, adminSurname, adminName, role } = req.body;
        const updated = await Admin.findByIdAndUpdate(
          req.params.id,
          { adminFirstname, adminSurname, adminName, role },
          { new: true }
        );
        res.status(200).json({ message: "Admin mis à jour", admin: updated });
      } catch (error) {
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Supprimer un admin
    app.delete('/api/admins/:id', verifyToken, async (req, res) => {
      try {
        const currentUser = await Admin.findById(req.user.userId);
        if (!currentUser || currentUser.role !== 'dev-admin') {
          return res.status(403).json({ message: "Action réservée au Dev Admin" });
        }
        
        // Empêcher de se supprimer soi-même si on est le dernier dev-admin? 
        // Pour l'instant on autorise tout tant que c'est un dev-admin
        await Admin.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: "Admin supprimé" });
      } catch (error) {
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Récupérer les données de l'admin connecté
    app.get('/api/admin/me', verifyToken, async (req, res) => {
      try {
        const admin = await Admin.findById(req.user.userId);
        if (!admin) {
          return res.status(401).json({ message: "Admin non trouvé" });
        }

        return res.status(200).json({
          username: admin.adminName,
          userId: admin._id,
          role: admin.role,
          firstname: admin.adminFirstname,
          surname: admin.adminSurname
        });
      } catch (error) {
        res.status(500).json({ message: "Erreur serveur" });
      }
    });


    app.post('/commander', async (req, res) => {
      const { userName, userEmail, categorie, productQuantity, picture, productDescription, selectedCountry, status, lat, lng, deliveryFee, paymentMethod, address, city, totalPrice, productPrice } = req.body;
      const date = new Date();

      if (!userEmail || !userName || !categorie || !productQuantity || !picture || !productDescription || !selectedCountry || !status) {
        return res.status(400).json({ message: "Champs manquants." });
      }

      try {
        const newCommande = new Commande({
          userName,
          userEmail,
          categorie,
          productQuantity,
          picture,
          productDescription,
          selectedCountry,
          status,
          lat,
          lng,
          deliveryFee,
          paymentMethod,
          address,
          city,
          totalPrice,
          productPrice,
          date,
        });

        await newCommande.save();

        // Notification Admin
        await notifyAdmins({
          subject: '📦 Nouvelle Commande (Sur mesure)',
          html: `
            <h2>Nouvelle commande sur mesure</h2>
            <p><strong>Client :</strong> ${userName} (${userEmail})</p>
            <p><strong>Catégorie :</strong> ${categorie}</p>
            <p><strong>Description :</strong> ${productDescription}</p>
            <p><strong>Quantité :</strong> ${productQuantity}</p>
            <p><strong>Total :</strong> ${totalPrice} FCFA</p>
            <hr/>
            <p><a href="http://localhost:5173/orders">Voir dans le panel admin</a></p>
          `
        });

        res.status(201).json({ 
          message: "Nous avons reçu votre commande, nous vous contacterons !",
          commandeId: newCommande._id
        });

        // Notification Temps Réel Admin
        await sendNotification({
          recipient: 'admin',
          type: 'order',
          title: '📦 Nouvelle Commande',
          message: `Commande de ${userName} (${categorie}).`,
          link: '/orders'
        });
      } catch (error) {
        console.error("Erreur /commander :", error);
        res.status(500).json({ message: "Erreur serveur", error: error.message });
      }
    });

    // ═══════════════════════════════════════════════
    // 💳 FEDAPAY ENDPOINTS
    // ═══════════════════════════════════════════════
    app.post('/api/fedapay/checkout', async (req, res) => {
      const { userName, userNumber, productQuantity, picture, userPref, userEmail, selectedCountry, lat, lng, deliveryFee, address, city, totalPrice, productPrice, description, type } = req.body;
      const date = new Date();

      if (!userNumber || !userName || !userEmail || !totalPrice) {
        return res.status(400).json({ message: "Champs manquants pour FedaPay." });
      }

      try {
        let newOrder;
        
        if (type === 'cart') {
           newOrder = new Commande({
              userName, userEmail, categorie: 'Panier', productQuantity, picture,
              productDescription: description, selectedCountry, status: 'En attente', lat, lng,
              deliveryFee, paymentMethod: 'FedaPay', address, city, totalPrice, productPrice, date
           });
           await newOrder.save();
        } else {
           newOrder = new Achat({
              userName, userNumber, productQuantity, userPref: userPref || 'Achat direct', selectedCountry, picture, userEmail,
              status: 'En attente', lat, lng, deliveryFee, paymentMethod: 'FedaPay', address, city, totalPrice, productPrice, date
           });
           await newOrder.save();
        }

        const nameParts = userName.trim().split(' ');
        const firstname = nameParts[0] || 'Client';
        const lastname = nameParts.slice(1).join(' ') || 'Dango';
        const returnUrl = process.env.PAYDUNYA_RETURN_URL || 'https://www.dangoimport.com/';

        const transaction = await Transaction.create({
          description: description || 'Commande Dango Import',
          amount: totalPrice,
          currency: { iso: 'XOF' },
          callback_url: returnUrl, 
          custom_metadata: { orderId: newOrder._id.toString(), type: type || 'achat' },
          customer: {
            firstname,
            lastname,
            email: userEmail,
            phone_number: {
              number: userNumber,
              country: 'BJ'
            }
          }
        });

        const token = await transaction.generateToken();

        res.status(201).json({ url: token.url, orderId: newOrder._id });
      } catch (error) {
        console.error("Erreur FedaPay Checkout :", error);
        res.status(500).json({ message: "Erreur lors de l'initialisation FedaPay", error: error.message });
      }
    });

    app.post('/api/fedapay/webhook', express.json(), async (req, res) => {
      try {
        const event = req.body;
        
        if (event && event.name === 'transaction.approved') {
          const transaction = event.entity;
          if (transaction && transaction.custom_metadata) {
             const { orderId, type } = transaction.custom_metadata;
             
             if (type === 'cart') {
                await Commande.findByIdAndUpdate(orderId, { status: 'Payé' });
             } else {
                await Achat.findByIdAndUpdate(orderId, { status: 'Payé' });
             }
             
             // Optionnel: notifyAdmins()
             console.log(`Commande ${orderId} marquée comme payée via FedaPay.`);
          }
        }
        res.status(200).send('Webhook OK');
      } catch (err) {
        console.error("Erreur Webhook FedaPay:", err);
        res.status(500).send('Erreur Webhook');
      }
    });

    app.post('/acheter', async (req, res) => {
      const { userName, userNumber, productQuantity, picture, userPref, userEmail, selectedCountry, status, lat, lng, deliveryFee, paymentMethod, address, city, totalPrice, productPrice } = req.body;
      const date = new Date();

      if (!userNumber || !userName || !userEmail || !productQuantity || !picture || !userPref || !selectedCountry || !status) {
        return res.status(400).json({ message: "Champs manquants." });
      }

      try {
        const newAchat = new Achat({
          userName,
          userNumber,
          productQuantity,
          userPref,
          selectedCountry,
          picture,
          userEmail,
          status,
          lat,
          lng,
          deliveryFee,
          paymentMethod,
          address,
          city,
          totalPrice,
          productPrice,
          date,
        });

        await newAchat.save();

        // Notification Admin
        await notifyAdmins({
          subject: '🛍️ Nouvel Achat (Boutique)',
          html: `
            <h2>Nouvel achat boutique</h2>
            <p><strong>Client :</strong> ${userName} (${userEmail})</p>
            <p><strong>Téléphone :</strong> ${userNumber}</p>
            <p><strong>Détails :</strong> ${userPref}</p>
            <p><strong>Quantité :</strong> ${productQuantity}</p>
            <p><strong>Total :</strong> ${totalPrice} FCFA</p>
            <p><strong>Localisation :</strong> <a href="https://www.google.com/maps?q=${lat},${lng}">Voir sur Maps</a></p>
            <hr/>
            <p><a href="http://localhost:5173/orders">Voir dans le panel admin</a></p>
          `
        });

        res.status(201).json({ 
          message: "Nous avons reçu votre commande, nous vous contacterons !",
          achatId: newAchat._id
        });

        // Notification Temps Réel Admin
        await sendNotification({
          recipient: 'admin',
          type: 'order',
          title: '🛍️ Nouvel Achat Boutique',
          message: `${userName} a acheté ${productQuantity} article(s).`,
          link: '/orders'
        });
      } catch (error) {
        console.error("Erreur /acheter :", error);
        res.status(500).json({ message: "Erreur serveur", error: error.message });
      }
    });


        // --- MARKETPLACE ROUTES ---

    // Récupérer tous les produits de la base de données
    app.get('/api/products', async (req, res) => {
      try {
        const products = await Product.find().sort({ date: -1 });
        res.status(200).json(products);
      } catch (error) {
        console.error("Erreur GET /api/products :", error);
        res.status(500).json({ message: "Erreur serveur lors de la récupération des produits" });
      }
    });

    // Route GET pour récupérer les produits d'un vendeur spécifique
    app.get('/api/products/vendor/:vendorName', async (req, res) => {
      try {
        const vendorName = req.params.vendorName.trim();
        // Recherche exacte avec l'option 'i' pour l'insensibilité à la casse
        const products = await Product.find({ 
          vendorName: { $regex: new RegExp(`^${vendorName}$`, 'i') } 
        }).sort({ date: -1 });
        res.status(200).json(products);
      } catch (error) {
        console.error("Erreur GET /api/products/vendor :", error);
        res.status(500).json({ message: "Erreur serveur lors de la récupération des produits du vendeur" });
      }
    });

    // Récupérer les notifications
    app.get('/api/notifications', async (req, res) => {
      try {
        const { recipient } = req.query; // 'admin' ou userId
        if (!recipient) return res.status(400).json({ message: "Recipient requis" });
        
        const notifications = await Notification.find({ recipient })
          .sort({ createdAt: -1 })
          .limit(20);
        res.status(200).json(notifications);
      } catch (error) {
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Marquer comme lu
    app.put('/api/notifications/:id/read', async (req, res) => {
      try {
        await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
        res.status(200).json({ message: "Marqué comme lu" });
      } catch (error) {
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Route SEARCH pour chercher des produits par mot-clé
    app.get('/api/products/search', async (req, res) => {
      try {
        const query = req.query.q;
        if (!query) return res.status(200).json([]);
        
        const products = await Product.find({
          $or: [
            { name: { $regex: query, $options: 'i' } },
            { description: { $regex: query, $options: 'i' } },
            { category: { $regex: query, $options: 'i' } },
            { vendorName: { $regex: query, $options: 'i' } }
          ]
        }).sort({ date: -1 });
        
        res.status(200).json(products);
      } catch (error) {
        console.error("Erreur SEARCH /api/products/search :", error);
        res.status(500).json({ message: "Erreur serveur lors de la recherche" });
      }
    });

    // Ajouter / Publier un nouveau produit
    app.post('/api/products', async (req, res) => {
      const { name, price, category, description, image, vendorName } = req.body;

      if (!name || !price || !category || !image) {
        return res.status(400).json({ message: "Champs requis manquants (nom, prix, catégorie, image)." });
      }

      try {
        const newProduct = new Product({
          name,
          price,
          category,
          description: description || '',
          image,
          vendorName: vendorName || 'Vendeur Indépendant'
        });

        await newProduct.save();
        res.status(201).json({ message: "Produit publié avec succès !", product: newProduct });
      } catch (error) {
        console.error("Erreur POST /api/products :", error);
        res.status(500).json({ message: "Erreur serveur lors de la publication", error: error.message });
      }
    });

    // Route pour la newsletter
    app.post('/api/newsletter/subscribe', async (req, res) => {
      const { email } = req.body;
      if (!email) return res.status(400).json({ message: "Email requis." });

      try {
        const existing = await Newsletter.findOne({ email });
        if (existing) return res.status(400).json({ message: "Cet email est déjà inscrit !" });

        const newSub = new Newsletter({ email });
        await newSub.save();

        // Optionnel: Envoyer une notification admin
        await sendNotification({
          recipient: 'admin',
          type: 'newsletter',
          title: '📧 Nouveau abonné Newsletter',
          message: `${email} vient de s'inscrire.`,
          link: '#'
        });

        res.status(201).json({ message: "Inscription réussie ! Merci." });
      } catch (error) {
        console.error("Erreur Newsletter :", error);
        res.status(500).json({ message: "Erreur serveur lors de l'inscription." });
      }
    });

    // Auth Routes
    app.use('/api/auth', authRoutes);

    // Modifier un produit (admin only)
    app.put('/api/products/:id', verifyToken, async (req, res) => {
      try {
        const admin = await Admin.findById(req.user.userId);
        if (!admin) return res.status(401).json({ message: "Non autorisé" });
        const { name, price, category, description, image, vendorName } = req.body;
        const updated = await Product.findByIdAndUpdate(
          req.params.id,
          { name, price, category, description, image, vendorName },
          { new: true }
        );
        if (!updated) return res.status(404).json({ message: "Produit introuvable" });
        res.status(200).json({ message: "Produit mis à jour", product: updated });
      } catch (error) {
        console.error("Erreur PUT /api/products/:id :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Supprimer un produit (admin only)
    app.delete('/api/products/:id', verifyToken, async (req, res) => {
      try {
        const admin = await Admin.findById(req.user.userId);
        if (!admin) return res.status(401).json({ message: "Non autorisé" });
        const deleted = await Product.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ message: "Produit introuvable" });
        res.status(200).json({ message: "Produit supprimé avec succès" });
      } catch (error) {
        console.error("Erreur DELETE /api/products/:id :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Supprimer une commande (admin only)
    app.delete('/api/commandes/:id', verifyToken, async (req, res) => {
      try {
        const admin = await Admin.findById(req.user.userId);
        if (!admin) return res.status(401).json({ message: "Non autorisé" });
        await Commande.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: "Commande supprimée" });
      } catch (error) {
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Supprimer un achat (admin only)
    app.delete('/api/achats/:id', verifyToken, async (req, res) => {
      try {
        const admin = await Admin.findById(req.user.userId);
        if (!admin) return res.status(401).json({ message: "Non autorisé" });
        await Achat.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: "Achat supprimé" });
      } catch (error) {
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Récupérer tous les utilisateurs (admin only)
    const User = require('./Models/User');
    app.get('/api/users', verifyToken, async (req, res) => {
      try {
        const admin = await Admin.findById(req.user.userId);
        if (!admin) return res.status(401).json({ message: "Non autorisé" });
        const users = await User.find().select('-userPassword').sort({ date: -1 });
        res.status(200).json(users);
      } catch (error) {
        console.error("Erreur GET /api/users :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Supprimer un utilisateur (admin only)
    app.delete('/api/users/:id', verifyToken, async (req, res) => {
      try {
        const admin = await Admin.findById(req.user.userId);
        if (!admin) return res.status(401).json({ message: "Non autorisé" });
        await User.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: "Utilisateur supprimé" });
      } catch (error) {
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Statistiques globales (admin only)
    app.get('/api/admin/stats', verifyToken, async (req, res) => {
      try {
        const admin = await Admin.findById(req.user.userId);
        if (!admin) return res.status(401).json({ message: "Non autorisé" });
        const UserModel = require('./Models/User');
        const [products, commandes, achats, users] = await Promise.all([
          Product.countDocuments(),
          Commande.countDocuments(),
          Achat.countDocuments(),
          UserModel.countDocuments(),
        ]);
        const recentCommandes = await Commande.find().sort({ date: -1 }).limit(5);
        const recentAchats = await Achat.find().sort({ date: -1 }).limit(5);
        res.status(200).json({ products, commandes, achats, users, recentCommandes, recentAchats });
      } catch (error) {
        console.error("Erreur GET /api/admin/stats :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Récupérer toutes les commandes
    app.get('/commandes', verifyToken, async (req, res) => {
      try {
        const admin = await Admin.findById(req.user.userId);
        if (!admin) {
          return res.status(401).json({ message: "Admin non trouvé" });
        }

        const commandes = await Commande.find().sort({ createdAt: 1 });
        res.status(200).json(commandes);
      } catch (error) {
        console.error("Erreur /commandes :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Récupérer tous les achats
    app.get('/achats', verifyToken, async (req, res) => {
      try {
        const admin = await Admin.findById(req.user.userId);
        if (!admin) {
          return res.status(401).json({ message: "Admin non trouvé" });
        }

        const achats = await Achat.find().sort({ createdAt: 1 });
        res.status(200).json(achats);
      } catch (error) {
        console.error("Erreur /achats :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Récupérer tous les devis
    app.get('/devis', verifyToken, async (req, res) => {
      try {
        const admin = await Admin.findById(req.user.userId);
        if (!admin) {
          return res.status(401).json({ message: "Admin non trouvé" });
        }

        const devis = await Devis.find().sort({ createdAt: 1 });
        res.status(200).json(devis);
      } catch (error) {
        console.error("Erreur /devis :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Modifier le statut d'une commande
    app.put('/commande/status', async (req, res) => {
      try {
        const { orderId, status } = req.body;

        let nextStatus = status;
        if (status === "En attente") nextStatus = "Validée";
        else if (status === "Validée") nextStatus = "Achevée";
        else if (status === "Achevée") nextStatus = "En attente";

        const updatedCommande = await Commande.findByIdAndUpdate(
          orderId,
          { status: nextStatus },
          { new: true }
        );

        if (!updatedCommande) {
          return res.status(404).json({ message: "Commande introuvable" });
        }

        res.status(200).json(updatedCommande);
      } catch (err) {
        console.error("Erreur maj commande:", err);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Modifier le statut d'un devis
    app.put('/devis/status', async (req, res) => {
      try {
        const { orderId, status } = req.body;

        let nextStatus = status;
        if (status === "En attente") nextStatus = "Validée";
        else if (status === "Validée") nextStatus = "Achevée";
        else if (status === "Achevée") nextStatus = "En attente";

        const updatedDevis = await Devis.findByIdAndUpdate(
          orderId,
          { status: nextStatus },
          { new: true }
        );

        if (!updatedDevis) {
          return res.status(404).json({ message: "Devis introuvable" });
        }

        res.status(200).json(updatedDevis);
      } catch (err) {
        console.error("Erreur maj devis:", err);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Supprimer une commande
    app.delete('/commande/:id', verifyToken, async (req, res) => {
      try {
        const admin = await Admin.findById(req.user.userId);
        if (!admin) {
          return res.status(401).json({ message: "Admin non trouvé" });
        }

        const deletedCommande = await Commande.findByIdAndDelete(req.params.id);
        if (!deletedCommande) {
          return res.status(404).json({ message: "Commande introuvable" });
        }

        res.status(200).json({ message: "Commande supprimée" });
      } catch (error) {
        console.error("Erreur suppression commande:", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Supprimer un achat
    app.delete('/achat/:id', verifyToken, async (req, res) => {
      try {
        const admin = await Admin.findById(req.user.userId);
        if (!admin) {
          return res.status(401).json({ message: "Admin non trouvé" });
        }

        const deletedAchat = await Achat.findByIdAndDelete(req.params.id);
        if (!deletedAchat) {
          return res.status(404).json({ message: "Achat introuvable" });
        }

        res.status(200).json({ message: "Achat supprimé" });
      } catch (error) {
        console.error("Erreur suppression achat:", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Supprimer un devis
    app.delete('/devis/:id', verifyToken, async (req, res) => {
      try {
        const admin = await Admin.findById(req.user.userId);
        if (!admin) {
          return res.status(401).json({ message: "Admin non trouvé" });
        }

        const deletedDevis = await Devis.findByIdAndDelete(req.params.id);
        if (!deletedDevis) {
          return res.status(404).json({ message: "Devis introuvable" });
        }

        res.status(200).json({ message: "Devis supprimé" });
      } catch (error) {
        console.error("Erreur suppression devis:", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    app.put('/achat/status', async (req, res) => {
      try {
        const { orderId, status } = req.body;

        let nextStatus = status;
        if (status === "En attente") nextStatus = "Validée";
        else if (status === "Validée") nextStatus = "Achevée";
        else if (status === "Achevée") nextStatus = "En attente";

        const updatedAchat = await Achat.findByIdAndUpdate(
          orderId,
          { status: nextStatus },
          { new: true }
        );

        if (!updatedAchat) {
          return res.status(404).json({ message: "Achat introuvable" });
        }

        // Notification Temps Réel Utilisateur (si email dispo)
        if (updatedAchat.userEmail) {
          await sendNotification({
            recipient: updatedAchat.userEmail, // On utilise l'email comme ID de salle pour l'utilisateur
            type: 'status_update',
            title: '📦 Mise à jour de commande',
            message: `Votre commande est désormais : ${nextStatus}`,
            link: '/profile'
          });
        }

        res.status(200).json(updatedAchat);
      } catch (err) {
        console.error("Erreur maj achat:", err);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // ═══════════════════════════════════════════════
    // 💳 ENDPOINTS PAYDUNYA
    // ═══════════════════════════════════════════════

    // Créer une facture PayDunya
    app.post('/api/paydunya/create-invoice', async (req, res) => {
      if (!paydunyaSetup) {
        console.error('❌ PayDunya Setup NOT configured. Missing or placeholder keys.');
        console.error('PAYDUNYA_MASTER_KEY:', PAYDUNYA_MASTER_KEY ? '✓' : '✗');
        console.error('PAYDUNYA_PRIVATE_KEY:', PAYDUNYA_PRIVATE_KEY ? '✓' : '✗');
        console.error('PAYDUNYA_PUBLIC_KEY:', PAYDUNYA_PUBLIC_KEY ? '✓' : '✗');
        console.error('PAYDUNYA_TOKEN:', PAYDUNYA_TOKEN ? '✓' : '✗');
        return res.status(500).json({ 
          error: 'Configuration PayDunya invalide sur le serveur. Vérifiez les clés PAYDUNYA_* dans dangoimport-server/.env.',
          debug: {
            PAYDUNYA_MASTER_KEY: PAYDUNYA_MASTER_KEY ? (isPlaceholderKey(PAYDUNYA_MASTER_KEY) ? 'placeholder' : 'configured') : 'missing',
            PAYDUNYA_PRIVATE_KEY: PAYDUNYA_PRIVATE_KEY ? (isPlaceholderKey(PAYDUNYA_PRIVATE_KEY) ? 'placeholder' : 'configured') : 'missing',
            PAYDUNYA_PUBLIC_KEY: PAYDUNYA_PUBLIC_KEY ? (isPlaceholderKey(PAYDUNYA_PUBLIC_KEY) ? 'placeholder' : 'configured') : 'missing',
            PAYDUNYA_TOKEN: PAYDUNYA_TOKEN ? (isPlaceholderKey(PAYDUNYA_TOKEN) ? 'placeholder' : 'configured') : 'missing',
          }
        });
      }

      const {
        amount,
        items = [],
        description = 'Paiement Dango Import',
        customer = {},
        callbackURL,
        returnURL,
        cancelURL,
        store = {},
      } = req.body;

      if (!amount || Number(amount) <= 0) {
        return res.status(400).json({ error: 'Montant invalide.' });
      }

      try {
        const storeOptions = {
          name: store.name || PAYDUNYA_STORE_NAME,
          tagline: store.tagline || PAYDUNYA_STORE_TAGLINE,
          websiteURL: store.websiteURL || PAYDUNYA_STORE_WEBSITE,
          logoURL: store.logoURL || PAYDUNYA_STORE_LOGO,
          callbackURL: callbackURL || PAYDUNYA_CALLBACK_URL,
          returnURL: returnURL || PAYDUNYA_RETURN_URL,
          cancelURL: cancelURL || PAYDUNYA_CANCEL_URL,
        };

        const paydunyaStore = new paydunya.Store(storeOptions);
        const invoice = new paydunya.CheckoutInvoice(paydunyaSetup, paydunyaStore);

        items.forEach((item) => {
          const quantity = Number(item.quantity) || 1;
          const unitPrice = Number(item.price) || 0;
          const totalPrice = Number(item.total) || quantity * unitPrice;
          invoice.addItem(item.name, quantity, unitPrice, totalPrice, item.description || '');
        });

        invoice.description = description;
        invoice.totalAmount = Number(amount);

        // console.log('📝 Creating PayDunya invoice with:', { amount, itemsCount: items.length });
        await invoice.create();

        /* console.log('✅ PayDunya invoice created:', {
          token: invoice.token,
          url: invoice.url,
          status: invoice.status,
          responseText: invoice.responseText,
        }); */
        return res.json({
          url: invoice.url,
          token: invoice.token,
          status: invoice.status,
          responseText: invoice.responseText,
        });
      } catch (error) {
        console.error('❌ PayDunya create invoice error:', error);
        const responseText = error?.responseText || error?.data || error?.message || null;
        return res.status(500).json({ 
          error: error.message || 'Erreur lors de la création de la facture PayDunya.',
          responseText,
          debug: error
        });
      }
    });

    // Confirmer une facture PayDunya
    app.post('/api/paydunya/confirm', async (req, res) => {
      if (!paydunyaSetup) {
        return res.status(500).json({ error: 'Configuration PayDunya manquante sur le serveur.' });
      }

      const { token } = req.body;

      if (!token) {
        return res.status(400).json({ error: 'Token de facture requis.' });
      }

      try {
        const paydunyaStore = new paydunya.Store({
          name: PAYDUNYA_STORE_NAME,
          tagline: PAYDUNYA_STORE_TAGLINE,
          websiteURL: PAYDUNYA_STORE_WEBSITE,
          logoURL: PAYDUNYA_STORE_LOGO,
        });
        const invoice = new paydunya.CheckoutInvoice(paydunyaSetup, paydunyaStore);
        await invoice.confirm(token);
        return res.json({
          status: invoice.status,
          responseText: invoice.responseText,
          customer: invoice.customer,
          receiptURL: invoice.receiptURL,
        });
      } catch (error) {
        console.error('PayDunya confirm error:', error);
        return res.status(500).json({ error: error.message || 'Erreur de confirmation PayDunya.' });
      }
    });

    // IPN (Instant Payment Notification) PayDunya
    app.post('/api/paydunya/ipn', async (req, res) => {
      const data = req.body.data || req.body;
      const hash = data?.hash;

      // Vérifier le hash si configuration complète
      if (PAYDUNYA_MASTER_KEY) {
        const expected = crypto.createHash('sha512').update(PAYDUNYA_MASTER_KEY, 'utf8').digest('hex');
        if (expected !== hash) {
          console.warn('IPN hash invalide', data);
          return res.status(403).json({ error: 'Hash PayDunya invalide.' });
        }
      }

      // console.log('IPN PayDunya reçu:', JSON.stringify(data, null, 2));

      try {
        const token = data?.token || data?.invoice_token || data?.checkout_token;
        const status = data?.status || data?.invoice_status || data?.payment_status;

        if (token) {
          const update = {};
          if (status) {
            update.invoiceStatus = status;
          }
          if (['completed', 'paid', 'success'].includes(String(status).toLowerCase())) {
            update.status = 'paid';
          }

          const updatedDevis = await Devis.findOneAndUpdate({ paymentToken: token }, update, { new: true });
          if (updatedDevis) {
            console.log('Devis mis à jour via IPN PayDunya :', updatedDevis._id);
          }
        }
      } catch (error) {
        console.error('Erreur lors de la mise à jour du devis via IPN :', error);
      }

      return res.json({ ok: true });
    });

    // Gestion des erreurs 404
    app.use((req, res) => {
      res.status(404).json({ message: 'Route non trouvée' });
    });

    // Gestion globale des erreurs
    app.use((err, req, res, next) => {
      console.error('Erreur globale:', err);
      res.status(500).json({ 
        message: 'Erreur serveur', 
        error: process.env.NODE_ENV === 'development' ? err.message : undefined 
      });
    });

    // Lancer le serveur avec HTTP + Socket.io
    const server = http.createServer(app);
    initSocket(server);

    server.listen(port, () => {
      console.log(`🚀 Serveur lancé sur le port ${port} (HTTP + WebSocket)`);
      console.log(`📱 Compatible iOS/macOS`);
      console.log(`🌐 Environnement: ${process.env.NODE_ENV || 'development'}`);
    });

  } catch (err) {
    console.error('❌ Erreur de démarrage du serveur :', err);
    process.exit(1);
  }
};

startServer();