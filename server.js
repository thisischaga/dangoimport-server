require('dotenv').config();

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

const { buildProductPayload } = require('./utils/productPayload');
const { normalizeProductImages } = require('./utils/imageStorage');
const {
  resolveSkuForCreate,
  resolveSkuForUpdate,
  isDuplicateKeyError,
  duplicateFieldMessage,
} = require('./utils/productIdentifiers');
const { configureFedapay, getFedapayStatus } = require('./config/fedapay');
const connectDB = require('./Congfig/db');
const verifyToken = require('./Middlewares/verifyTokens');
const { verifyAdmin } = require('./Middlewares/verifyTokens');
const Commande = require('./Models/Commande');
const Admin = require('./Models/Admin');
const Achat = require('./Models/Achat');
const Product = require('./Models/Product');
const Devis = require('./Models/Devis');
const Newsletter = require('./Models/Newsletter');
const VendorRequest = require('./Models/VendorRequest');
const WithdrawalRequest = require('./Models/WithdrawalRequest');
const User = require('./Models/User');
const authRoutes = require('./routes/authRoutes');
const orderRoutes = require('./routes/orderRoutes');
const { notifyAdmins } = require('./utils/notifications');
const { sendNotification } = require('./utils/socket');
const slugify = require('slugify');


const app = express();
app.set('trust proxy', 1);
app.use(compression({
  filter: (req, res) => {
    // Ne pas compresser les uploads multipart (évite ERR_HTTP2_PROTOCOL_ERROR)
    if (req.headers['content-type']?.includes('multipart/form-data')) return false;
    if (req.path?.startsWith('/api/upload')) return false;
    return compression.filter(req, res);
  },
}));

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
const fedapayBoot = configureFedapay();
if (fedapayBoot.ok) {
  console.log(`✅ FedaPay configuré (mode: ${fedapayBoot.environment}, clé: ${fedapayBoot.keyType})`);
} else {
  console.warn('⚠️ FEDAPAY_SECRET_KEY manquante — paiement FedaPay désactivé.');
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
      'http://localhost:5174',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5174',
      'https://www.dangoimport.com',
      'https://dangoimport.com',
      'https://dangoimport-admin.vercel.app',
      'https://vendeur.dangoimport.com',
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
  // Cache désactivé uniquement pour les routes privées (panier, commandes, auth)
  const isPrivate = /^\/api\/(cart|orders|auth|admin|users)/.test(req.path)
    || req.headers.authorization;
  if (isPrivate) {
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.header('Pragma', 'no-cache');
    res.header('Expires', '0');
  }
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
    await connectDB();

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

    // Créer un paiement FedaPay pour le devis
    // Créer un paiement FedaPay pour le devis
    app.post('/api/devis/create-invoice', devisUpload.single('photo'), async (req, res) => {
      try {
        const { name, phone, productLink, quantity, description, studyFee } = req.body;
        if (!name || !phone || !quantity) {
          return res.status(400).json({ message: 'Nom, téléphone et quantité sont obligatoires.' });
        }
        if (!productLink?.trim() && !req.file) {
          return res.status(400).json({ message: 'Indiquez un lien produit ou joignez une photo.' });
        }

        const linkValue = productLink?.trim() || 'Photo fournie par le client';
        const bypassFedaPay = false; // Activation du paiement FedaPay pour les devis

        if (bypassFedaPay) {
          const photoUrl = req.file ? `${req.protocol}://${req.get('host')}/uploads/devis/${req.file.filename}` : undefined;
          const photoFilename = req.file ? req.file.filename : undefined;

          const newDevis = new Devis({
            name: name.trim(),
            phone: phone.trim(),
            productLink: linkValue,
            quantity: Number(quantity),
            description: description ? description.trim() : '',
            studyFee: 0,
            photoUrl,
            photoFilename,
            status: 'paid', // Directement marqué comme payé/validé pour l'étude
          });
          await newDevis.save();

          // Notification Admin
          await notifyAdmins({
            subject: '📝 Nouvelle demande de Devis (Étude Gratuite)',
            html: `
              <h2>Nouvelle demande de devis reçue (Frais Offerts)</h2>
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
            title: '📝 Nouveau Devis (Gratuit)',
            message: `Demande de ${name} pour ${quantity} article(s).`,
            link: '/devis'
          });

          return res.status(201).json({
            success: true,
            message: 'Votre demande de devis gratuit a été enregistrée avec succès. Nos agents vous contacteront bientôt.',
            devisId: newDevis._id,
          });
        }

        const amount = Number(studyFee) || 5000;
        const photoUrl = req.file ? `${req.protocol}://${req.get('host')}/uploads/devis/${req.file.filename}` : undefined;
        const photoFilename = req.file ? req.file.filename : undefined;

        const newDevis = new Devis({
          name: name.trim(),
          phone: phone.trim(),
          productLink: linkValue,
          quantity: Number(quantity),
          description: description ? description.trim() : '',
          studyFee: amount,
          photoUrl,
          photoFilename,
          status: 'pending_payment',
        });
        await newDevis.save();

        const nameParts = name.trim().split(' ');
        const firstname = nameParts[0] || 'Client';
        const lastname = nameParts.slice(1).join(' ') || 'Dango';
        const returnUrl = process.env.PAYDUNYA_RETURN_URL || 'https://www.dangoimport.com/';

        const transaction = await Transaction.create({
          description: `Frais d'étude de devis - ${name}`,
          amount,
          currency: { iso: 'XOF' },
          callback_url: returnUrl,
          custom_metadata: { orderId: newDevis._id.toString(), type: 'devis' },
          customer: {
            firstname,
            lastname,
            email: 'client@dangoimport.com',
            phone_number: {
              number: phone,
              country: 'BJ'
            }
          }
        });

        const token = await transaction.generateToken();

        // Notification Admin
        await notifyAdmins({
          subject: '💳 Nouveau Devis en attente de paiement',
          html: `
            <h2>Paiement de devis initié (FedaPay)</h2>
            <p><strong>Client :</strong> ${name}</p>
            <p><strong>Montant :</strong> ${amount} FCFA</p>
            <p><strong>Produit :</strong> <a href="${productLink}">${productLink}</a></p>
            <hr/>
            <p><a href="http://localhost:5173/devis">Voir dans le panel admin</a></p>
          `
        });

        return res.status(201).json({
          message: 'Devis enregistré. Redirection vers FedaPay.',
          url: token.url,
          devisId: newDevis._id,
        });
      } catch (error) {
        console.error('Erreur POST /api/devis/create-invoice (FedaPay) :', error);
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
        console.error("[server.js] Erreur capturée :", error);
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
        console.error("[server.js] Erreur capturée :", error);
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
        console.error("[server.js] Erreur capturée :", error);
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
        console.error("[server.js] Erreur capturée :", error);
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
        console.error("[server.js] Erreur capturée :", error);
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
    app.get('/api/fedapay/status', (req, res) => {
      res.json(getFedapayStatus());
    });

    app.post('/api/payment/create', async (req, res) => {
      const {
        amount,
        currency = 'XOF',
        description,
        callback_url,
        customer,
        deliveryCountry = 'Togo',
        custom_metadata,
      } = req.body;

      if (!amount || !customer?.email || !customer?.phone) {
        return res.status(400).json({ message: 'Montant, email et téléphone requis pour le paiement.' });
      }

      if (!process.env.FEDAPAY_SECRET_KEY) {
        return res.status(503).json({ message: 'Paiement FedaPay non configuré.' });
      }

      const fedapayConfig = configureFedapay();
      if (!fedapayConfig.ok) {
        return res.status(503).json({ message: 'Paiement FedaPay non configuré.' });
      }

      try {
        const phoneDigits = String(customer.phone).replace(/\D/g, '');
        const normalizedPhone = phoneDigits.startsWith('229') || phoneDigits.startsWith('228') || phoneDigits.startsWith('225') || phoneDigits.startsWith('221') || phoneDigits.startsWith('226') || phoneDigits.startsWith('227') || phoneDigits.startsWith('223') || phoneDigits.startsWith('224') || phoneDigits.startsWith('220') || phoneDigits.startsWith('222') || phoneDigits.startsWith('230')
          ? phoneDigits.replace(/^(229|228|225|221|226|227|223|224|220|222|230)/, '')
          : phoneDigits;

        const countryCode = deliveryCountry === 'Togo' ? 'TG' : 'BJ';
        const transactionPayload = {
          description: description || 'Paiement Dango Import',
          amount: Math.round(Number(amount)),
          currency: { iso: String(currency).toUpperCase() },
          callback_url: callback_url || process.env.FEDAPAY_RETURN_URL || 'https://www.dangoimport.com/checkout',
          customer: {
            firstname: customer.firstname || 'Client',
            lastname: customer.lastname || 'Dango',
            email: customer.email,
            phone_number: {
              number: normalizedPhone || '97000000',
              country: countryCode,
            }
          }
        };

        if (custom_metadata && typeof custom_metadata === 'object') {
          transactionPayload.custom_metadata = custom_metadata;
        }

        const transaction = await Transaction.create(transactionPayload);

        const token = await transaction.generateToken();
        return res.status(201).json({
          message: 'Paiement initialisé.',
          payment_url: token.url,
          paymentUrl: token.url,
          transactionId: transaction.id,
        });
      } catch (error) {
        console.error('=== Erreur /api/payment/create ===');
        console.error(error.message);
        return res.status(500).json({
          message: 'Erreur lors de l’initialisation du paiement FedaPay.',
          error: error.message,
        });
      }
    });

    // Sourcing — enregistré tôt (même zone que payment) pour éviter 404 si le mount tardif échoue
    {
      const sourcingRoutesEarly = require('./routes/sourcingRoutes');
      app.use('/api/sourcing', sourcingRoutesEarly);

      const uploadRoutesEarly = require('./routes/uploadRoutes');
      app.use('/api/upload', uploadRoutesEarly);
    }

    app.post('/api/payment/webhook', express.json(), async (req, res) => {
      try {
        const signature = req.headers['x-fedapay-signature'];
        const secret = process.env.FEDAPAY_WEBHOOK_SECRET;

        if (secret && signature) {
          const hash = crypto.createHmac('sha256', secret)
            .update(JSON.stringify(req.body))
            .digest('hex');
          if (hash !== signature) {
            console.error('Signature FedaPay invalide !');
            return res.status(403).send('Signature invalide');
          }
        }

        const event = req.body;
        if (event?.name === 'transaction.approved') {
          const transaction = event.entity;
          const meta = transaction?.custom_metadata || {};
          const { orderId, type } = meta;

          if (type === 'cart') {
            await Commande.findByIdAndUpdate(orderId, { status: 'Payé' });
          } else if (type === 'devis') {
            await Devis.findByIdAndUpdate(orderId, { status: 'paid', paymentToken: transaction.id });
          } else if (type === 'sourcing') {
            const SourcingRequest = require('./Models/SourcingRequest');
            await SourcingRequest.findByIdAndUpdate(orderId, {
              status: 'paid',
              paymentTransactionId: String(transaction.id || ''),
            });
          } else {
            await Achat.findByIdAndUpdate(orderId, { status: 'Payé' });
          }
        }

        return res.status(200).send('Webhook traité avec succès');
      } catch (err) {
        console.error('Erreur Webhook paiement :', err);
        return res.status(500).send('Erreur webhook paiement');
      }
    });

    app.post('/api/fedapay/checkout', async (req, res) => {
      const { userName, userNumber, productQuantity, picture, userPref, userEmail, selectedCountry, lat, lng, deliveryFee, address, city, totalPrice, productPrice, description, type, vendorName } = req.body;
      const date = new Date();

      if (!userNumber || !userName || !userEmail || !totalPrice) {
        return res.status(400).json({ message: "Champs manquants pour FedaPay." });
      }

      if (!process.env.FEDAPAY_SECRET_KEY) {
        return res.status(503).json({ message: "Paiement FedaPay non configuré." });
      }

      const fedapayConfig = configureFedapay();
      if (!fedapayConfig.ok) {
        return res.status(503).json({ message: "Paiement FedaPay non configuré." });
      }

      try {
        let newOrder;

        const phoneDigits = String(userNumber).replace(/\D/g, '');
        const phoneAsNumber = parseInt(phoneDigits.slice(-8), 10) || 97000000;
        const safePicture = picture && String(picture).trim() ? picture : 'https://www.dangoimport.com/logo.png';
        const orderDate = date instanceof Date ? date.toISOString() : String(date);

        const achatPayload = {
          userName,
          userNumber: phoneAsNumber,
          productQuantity: productQuantity || 1,
          userPref: userPref || description || (type === 'cart' ? 'Commande panier' : 'Achat direct'),
          selectedCountry: selectedCountry || 'Benin',
          picture: safePicture,
          userEmail,
          status: 'En attente',
          lat: lat || 6.37,
          lng: lng || 2.43,
          deliveryFee: deliveryFee || 0,
          paymentMethod: 'FedaPay',
          address: address || 'Non précisé',
          city: city || 'Non précisé',
          totalPrice,
          productPrice: productPrice || totalPrice,
          date: orderDate,
          vendorName: vendorName || 'Dango Import',
        };

        newOrder = new Achat(achatPayload);
        await newOrder.save();

        const nameParts = userName.trim().split(' ');
        const firstname = nameParts[0] || 'Client';
        const lastname = nameParts.slice(1).join(' ') || 'Dango';
        const returnUrl = process.env.FEDAPAY_RETURN_URL
          || process.env.PAYDUNYA_RETURN_URL
          || 'https://www.dangoimport.com/checkout';

        // Normalisation du numero : react-phone-input-2 envoie le code pays inclus
        // ex: 22901234567 -> FedaPay attend 01234567 (sans prefixe 229)
        let phoneNumber = String(userNumber).replace(/\D/g, '');
        const prefixes = ['229', '228', '225', '221', '226', '227', '223', '224', '220', '222', '230'];
        for (const pfx of prefixes) {
          if (phoneNumber.startsWith(pfx)) { phoneNumber = phoneNumber.slice(pfx.length); break; }
        }
        if (phoneNumber.length < 8) phoneNumber = '97000000';

        const transaction = await Transaction.create({
          description: description || 'Commande Dango Import',
          amount: Math.round(Number(totalPrice)),
          currency: { iso: 'XOF' },
          callback_url: returnUrl,
          custom_metadata: { orderId: newOrder._id.toString(), type: type || 'achat' },
          customer: {
            firstname,
            lastname,
            email: userEmail || 'client@dangoimport.com',
            phone_number: {
              number: phoneNumber,
              country: 'BJ'
            }
          }
        });

        const token = await transaction.generateToken();

        res.status(201).json({ url: token.url, orderId: newOrder._id });
      } catch (error) {
        console.error('=== Erreur FedaPay Checkout ===');
        console.error('Message:', error.message);
        console.error('Errors:', JSON.stringify(error.errors || error.body || {}, null, 2));

        const isAuthError = String(error.message || '').includes('401');
        res.status(isAuthError ? 502 : 500).json({
          message: isAuthError
            ? 'Configuration FedaPay incorrecte sur le serveur (clé ou mode live/sandbox).'
            : "Erreur lors de l'initialisation FedaPay",
          error: error.message,
          details: error.errors || error.body || null
        });
      }
    });

    app.post('/api/fedapay/direct-pay', async (req, res) => {
      const { userName, userNumber, network, countryCode, productQuantity, picture, userPref, userEmail, selectedCountry, lat, lng, deliveryFee, address, city, totalPrice, productPrice, description, type, vendorName } = req.body;
      const date = new Date();

      if (!userNumber || !userName || !userEmail || !totalPrice || !network) {
        return res.status(400).json({ message: "Champs manquants pour FedaPay Direct (network requis)." });
      }

      if (!process.env.FEDAPAY_SECRET_KEY) {
        return res.status(503).json({ message: "Paiement FedaPay non configuré." });
      }

      const fedapayConfig = configureFedapay();
      if (!fedapayConfig.ok) {
        return res.status(503).json({ message: "Paiement FedaPay non configuré." });
      }

      try {
        let newOrder;

        const phoneDigits = String(userNumber).replace(/\D/g, '');
        const phoneAsNumber = parseInt(phoneDigits.slice(-8), 10) || 97000000;
        const safePicture = picture && String(picture).trim() ? picture : 'https://www.dangoimport.com/logo.png';
        const orderDate = date instanceof Date ? date.toISOString() : String(date);

        const achatPayload = {
          userName,
          userNumber: phoneAsNumber,
          productQuantity: productQuantity || 1,
          userPref: userPref || description || (type === 'cart' ? 'Commande panier' : 'Achat direct'),
          selectedCountry: selectedCountry || 'Benin',
          picture: safePicture,
          userEmail,
          status: 'En attente',
          lat: lat || 6.37,
          lng: lng || 2.43,
          deliveryFee: deliveryFee || 0,
          paymentMethod: 'FedaPay (USSD)',
          address: address || 'Non précisé',
          city: city || 'Non précisé',
          totalPrice,
          productPrice: productPrice || totalPrice,
          date: orderDate,
          vendorName: vendorName || 'Dango Import',
        };

        newOrder = new Achat(achatPayload);
        await newOrder.save();

        const nameParts = userName.trim().split(' ');
        const firstname = nameParts[0] || 'Client';
        const lastname = nameParts.slice(1).join(' ') || 'Dango';
        const returnUrl = process.env.FEDAPAY_RETURN_URL || 'https://www.dangoimport.com/';

        // Nettoyage du numéro
        let phoneNumber = String(userNumber).replace(/\D/g, '');
        const prefixes = ['229', '228', '225', '221', '226', '227', '223', '224', '220', '222', '230'];
        for (const pfx of prefixes) {
          if (phoneNumber.startsWith(pfx)) { phoneNumber = phoneNumber.slice(pfx.length); break; }
        }
        if (phoneNumber.length < 8) phoneNumber = '97000000';

        const transaction = await Transaction.create({
          description: description || 'Commande Dango Import',
          amount: Math.round(Number(totalPrice)),
          currency: { iso: 'XOF' },
          callback_url: returnUrl,
          custom_metadata: { orderId: newOrder._id.toString(), type: type || 'achat' },
          customer: {
            firstname,
            lastname,
            email: userEmail || 'client@dangoimport.com',
            phone_number: {
              number: phoneNumber,
              country: countryCode || 'BJ'
            }
          }
        });

        const token = await transaction.generateToken();
        const sendResult = await transaction.sendNowWithToken(network, token.token);

        res.status(201).json({ 
          message: "Demande de paiement envoyée.",
          transactionId: transaction.id, 
          orderId: newOrder._id 
        });
      } catch (error) {
        console.error('=== Erreur FedaPay Direct ===');
        console.error('Message:', error.message);
        console.error('Errors:', JSON.stringify(error.errors || error.body || {}, null, 2));

        const isAuthError = String(error.message || '').includes('401');
        res.status(isAuthError ? 502 : 500).json({
          message: "Erreur lors de l'initialisation du paiement direct FedaPay",
          error: error.message,
          details: error.errors || error.body || null
        });
      }
    });

    app.get('/api/fedapay/transaction/:id', async (req, res) => {
      try {
        const fedapayConfig = configureFedapay();
        if (!fedapayConfig.ok) {
          return res.status(503).json({ message: "Paiement FedaPay non configuré." });
        }
        const transaction = await Transaction.retrieve(req.params.id);
        
        // Mettre à jour la base de données si c'est approuvé
        if (transaction && transaction.status === 'approved') {
           const meta = transaction.custom_metadata || {};
           const orderId = meta.orderId;
           if (orderId) {
             if (meta.type === 'cart') {
               await Commande.findByIdAndUpdate(orderId, { status: 'Payé' });
             } else if (meta.type === 'devis') {
               await Devis.findByIdAndUpdate(orderId, { status: 'paid', paymentToken: transaction.id });
             } else {
               await Achat.findByIdAndUpdate(orderId, { status: 'Payé' });
             }
           }
        }
        
        res.json({ status: transaction.status, id: transaction.id });
      } catch (error) {
        console.error('Erreur status FedaPay:', error.message);
        res.status(500).json({ message: 'Erreur lors de la récupération du statut', error: error.message });
      }
    });

    app.post('/api/fedapay/webhook', express.json(), async (req, res) => {
      try {
        const signature = req.headers['x-fedapay-signature'];
        const secret = process.env.FEDAPAY_WEBHOOK_SECRET;

        // Vérification de la signature si la clé est configurée
        if (secret && signature) {
          const hash = crypto.createHmac('sha256', secret)
            .update(JSON.stringify(req.body))
            .digest('hex');
          if (hash !== signature) {
            console.error("Signature FedaPay invalide !");
            return res.status(403).send('Signature invalide');
          }
        }

        const event = req.body;

        if (event && event.name === 'transaction.approved') {
          const transaction = event.entity;
          if (transaction && transaction.custom_metadata) {
            const { orderId, type } = transaction.custom_metadata;

            if (type === 'cart') {
              await Commande.findByIdAndUpdate(orderId, { status: 'Payé' });
            } else if (type === 'devis') {
              await Devis.findByIdAndUpdate(orderId, { status: 'paid', paymentToken: transaction.id });
            } else if (type === 'sourcing') {
              const SourcingRequest = require('./Models/SourcingRequest');
              await SourcingRequest.findByIdAndUpdate(orderId, {
                status: 'paid',
                paymentTransactionId: String(transaction.id || ''),
              });
            } else {
              await Achat.findByIdAndUpdate(orderId, { status: 'Payé' });
            }

            console.log(`✅ Commande ${orderId} (${type}) marquée comme payée via Webhook FedaPay.`);
          }
        }
        res.status(200).send('Webhook traité avec succès');
      } catch (err) {
        console.error("Erreur Webhook FedaPay:", err);
        res.status(500).send('Erreur Webhook');
      }
    });

    app.post('/acheter', async (req, res) => {
      const { userName, userNumber, productQuantity, picture, userPref, userEmail, selectedCountry, status, lat, lng, deliveryFee, paymentMethod, address, city, totalPrice, productPrice, vendorName } = req.body;
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
          vendorName,
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

    // --- DASHBOARD CLIENT & VENDEUR ROUTES ---
    app.get('/api/user-activities/:email', async (req, res) => {
      try {
        const email = req.params.email;
        const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);
        const [achats, commandes] = await Promise.all([
          Achat.find({ userEmail: email }).sort({ date: -1 }).limit(limit).lean(),
          Commande.find({ userEmail: email }).sort({ date: -1 }).limit(limit).lean(),
        ]);
        res.status(200).json({ achats, commandes });
      } catch (error) {
        console.error("Erreur GET /api/user-activities :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    app.get('/api/vendor-dashboard/:vendorName', async (req, res) => {
      try {
        const vendorName = req.params.vendorName.trim();
        const vendorRegex = new RegExp(`^${vendorName}$`, 'i');
        const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);
        const [achats, commandes, products] = await Promise.all([
          Achat.find({ vendorName: vendorRegex }).sort({ date: -1 }).limit(limit).lean(),
          Commande.find({ vendorName: vendorRegex }).sort({ date: -1 }).limit(limit).lean(),
          Product.find({ vendorName: vendorRegex, isPublished: true })
            .sort({ createdAt: -1 })
            .limit(limit)
            .select('name salePrice price category images image vendorName stock rating')
            .lean(),
        ]);
        res.status(200).json({ achats, commandes, products });
      } catch (error) {
        console.error("Erreur GET /api/vendor-dashboard :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // --- VENDOR REQUEST ROUTES ---
    app.post('/api/vendor-requests', async (req, res) => {
      try {
        const { name, businessName, phone, email, city, description, rccmImage } = req.body;
        if (!name || !businessName || !email || !rccmImage) {
          return res.status(400).json({ message: "Champs obligatoires manquants." });
        }
        const newReq = new VendorRequest({ name, businessName, phone, email, city, description, rccmImage });
        await newReq.save();
        res.status(201).json({ message: "Demande enregistrée avec succès." });
      } catch (error) {
        console.error("Erreur POST /api/vendor-requests :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    app.get('/api/vendor-requests', async (req, res) => {
      try {
        const requests = await VendorRequest.find().sort({ date: -1 });
        res.status(200).json(requests);
      } catch (error) {
        console.error("[server.js] Erreur capturée :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    app.put('/api/vendor-requests/:id/validate', async (req, res) => {
      try {
        const request = await VendorRequest.findById(req.params.id);
        if (!request) return res.status(404).json({ message: "Demande introuvable" });

        request.status = 'approved';
        await request.save();

        // Mettre à jour l'utilisateur correspondant
        const user = await User.findOne({ userEmail: request.email });
        if (user) {
          user.isVendor = true;
          user.vendorName = request.businessName;
          await user.save();
        }

        res.status(200).json({ message: "Vendeur approuvé avec succès !", request, userUpdated: !!user });
      } catch (error) {
        console.error("Erreur PUT /validate :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    app.put('/api/vendor-requests/:id/reject', async (req, res) => {
      try {
        const { reason } = req.body;
        const request = await VendorRequest.findById(req.params.id);
        if (!request) return res.status(404).json({ message: "Demande introuvable" });

        request.status = 'rejected';
        request.rejectionReason = reason || '';
        await request.save();

        res.status(200).json({ message: "Demande rejetée avec succès !", request });
      } catch (error) {
        console.error("Erreur PUT /reject :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    app.get('/api/users/me/:email', async (req, res) => {
      try {
        const user = await User.findOne({ userEmail: req.params.email });
        if (!user) return res.status(404).json({ message: "Utilisateur non trouvé" });

        // Retourner SEULEMENT les champs nécessaires
        res.status(200).json({
          _id: user._id,
          userFirstname: user.userFirstname,
          userSurname: user.userSurname,
          userEmail: user.userEmail,
          isVendor: user.isVendor,
          vendorName: user.vendorName,
          balance: user.balance,
          bankDetails: user.bankDetails,
          isVerified: user.isVerified,
          date: user.date
        });
      } catch (error) {
        console.error("[server.js] Erreur capturée :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // --- WITHDRAWAL ROUTES ---

    // Créer une demande de retrait
    app.post('/api/withdrawal-requests', async (req, res) => {
      try {
        const { vendorEmail, amount, accountHolder, accountNumber, bankName, iban } = req.body;

        if (!vendorEmail || !amount || !accountHolder || !accountNumber || !bankName) {
          return res.status(400).json({ message: "Champs obligatoires manquants." });
        }

        const user = await User.findOne({ userEmail: vendorEmail });
        if (!user) return res.status(404).json({ message: "Vendeur non trouvé" });

        if (amount <= 0) {
          return res.status(400).json({ message: "Le montant doit être supérieur à 0" });
        }

        if (user.balance < amount) {
          return res.status(400).json({ message: "Solde insuffisant" });
        }

        const withdrawalRequest = new WithdrawalRequest({
          userId: user._id,
          vendorEmail,
          amount,
          bankDetails: {
            accountHolder,
            accountNumber,
            bankName,
            iban: iban || ''
          }
        });

        await withdrawalRequest.save();

        res.status(201).json({
          message: "Demande de retrait créée avec succès.",
          withdrawalRequest
        });
      } catch (error) {
        console.error("Erreur POST /withdrawal-requests :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Récupérer les demandes de retrait d'un vendeur
    app.get('/api/withdrawal-requests/:email', async (req, res) => {
      try {
        const requests = await WithdrawalRequest.find({ vendorEmail: req.params.email }).sort({ date: -1 });
        res.status(200).json(requests);
      } catch (error) {
        console.error("Erreur GET /withdrawal-requests :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Récupérer toutes les demandes de retrait (admin)
    app.get('/api/withdrawal-requests/admin/all', async (req, res) => {
      try {
        const requests = await WithdrawalRequest.find().sort({ date: -1 });
        res.status(200).json(requests);
      } catch (error) {
        console.error("Erreur GET /admin/all :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Approuver une demande de retrait
    app.put('/api/withdrawal-requests/:id/approve', async (req, res) => {
      try {
        const { transactionReference } = req.body;
        const request = await WithdrawalRequest.findById(req.params.id);
        if (!request) return res.status(404).json({ message: "Demande introuvable" });

        request.status = 'approved';
        request.transactionReference = transactionReference || '';
        request.processedAt = Date.now();
        await request.save();

        // Déduire le montant du solde du vendeur
        const user = await User.findOne({ userEmail: request.vendorEmail });
        if (user) {
          user.balance -= request.amount;
          await user.save();
        }

        res.status(200).json({ message: "Retrait approuvé avec succès !", request });
      } catch (error) {
        console.error("Erreur PUT /approve :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Rejeter une demande de retrait
    app.put('/api/withdrawal-requests/:id/reject', async (req, res) => {
      try {
        const { reason } = req.body;
        const request = await WithdrawalRequest.findById(req.params.id);
        if (!request) return res.status(404).json({ message: "Demande introuvable" });

        request.status = 'rejected';
        request.rejectionReason = reason || '';
        request.processedAt = Date.now();
        await request.save();

        res.status(200).json({ message: "Retrait rejeté avec succès !", request });
      } catch (error) {
        console.error("Erreur PUT /reject :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // --- MARKETPLACE ROUTES ---

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
        console.error("[server.js] Erreur capturée :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Marquer comme lu
    app.put('/api/notifications/:id/read', async (req, res) => {
      try {
        await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
        res.status(200).json({ message: "Marqué comme lu" });
      } catch (error) {
        console.error("[server.js] Erreur capturée :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Route pour la newsletter (MailerLite Integration)
    app.post('/api/newsletter/subscribe', async (req, res) => {
      const { email } = req.body;
      if (!email) return res.status(400).json({ message: "Email requis." });

      try {
        const existing = await Newsletter.findOne({ email });
        if (existing) return res.status(400).json({ message: "Cet email est déjà inscrit !" });

        const newSub = new Newsletter({ email });
        await newSub.save();

        // ─── MAILERLITE INTEGRATION ───
        if (process.env.MAILERLITE_API_KEY) {
          try {
            await axios.post('https://api.mailerlite.com/api/v2/subscribers', {
              email: email
            }, {
              headers: {
                'X-MailerLite-ApiKey': process.env.MAILERLITE_API_KEY,
                'Content-Type': 'application/json'
              }
            });
            console.log("✅ Inscription MailerLite réussie pour :", email);
          } catch (mlError) {
            console.error("❌ Erreur MailerLite :", mlError.response ? mlError.response.data : mlError.message);
          }
        }

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
        console.error("Erreur POST /api/newsletter/subscribe :", error);
        res.status(500).json({ message: "Erreur serveur lors de l'inscription à la newsletter." });
      }
    });

    // Ajouter un produit (admin uniquement — pas depuis le site public)
    app.post('/api/products', verifyAdmin, async (req, res) => {
      const isBlob = (url) => typeof url === 'string' && url.startsWith('blob:');
      const hasValidImage =
        (req.body.image && !isBlob(req.body.image)) ||
        (Array.isArray(req.body.images) &&
          req.body.images.some((img) => {
            const url = typeof img === 'string' ? img : img?.url;
            return url && !isBlob(url);
          }));

      if (!req.body.name || !req.body.price || !req.body.category || !hasValidImage) {
        return res.status(400).json({
          message: "Champs requis manquants (nom, prix, catégorie, image). L'image doit être uploadée (URL https ou base64), pas une URL blob locale.",
        });
      }

      try {
        let payload = buildProductPayload(req.body);
        payload.sku = await resolveSkuForCreate(payload.sku);
        payload = await normalizeProductImages(payload, { existingProduct: null });
        payload.vendorId = req.admin ? req.admin._id : (req.user.userId || req.user.id);
        const newProduct = new Product(payload);
        await newProduct.save();
        const cache = require('./utils/cache');
        cache.delPrefix('products:');
        res.status(201).json({ message: "Produit publié avec succès !", product: newProduct });
      } catch (error) {
        console.error("Erreur POST /api/products :", error);
        if (error.statusCode === 409 || isDuplicateKeyError(error)) {
          return res.status(409).json({
            message: error.message || duplicateFieldMessage(error.keyPattern),
          });
        }
        res.status(500).json({
          message: error.message || "Erreur serveur lors de la publication",
          error: error.message,
        });
      }
    });



    // Auth Routes
    app.use('/api/auth', authRoutes);

    // Vendor Routes
    const vendorRoutes = require('./routes/vendorRoutes');
    app.use('/api/vendor', vendorRoutes);

    // Order Routes
    app.use('/api/orders', orderRoutes);

    // Product Routes
    const productRoutes = require('./routes/productRoutes');
    app.use('/api/products', productRoutes);

    // Mettre à jour un produit (admin only)
    app.put('/api/products/:id', verifyAdmin, async (req, res) => {
      try {
        const existing = await Product.findById(req.params.id);
        if (!existing) return res.status(404).json({ message: "Produit introuvable" });

        let payload = buildProductPayload(req.body, { existingProduct: existing });
        payload.sku = await resolveSkuForUpdate(payload.sku, existing._id, existing.sku);
        payload = await normalizeProductImages(payload, { existingProduct: existing });
        const updated = await Product.findByIdAndUpdate(req.params.id, payload, { new: true });
        const cache = require('./utils/cache');
        cache.delPrefix('products:');

        res.status(200).json({ message: "Produit mis à jour", product: updated });
      } catch (error) {
        console.error("Erreur PUT /api/products/:id :", error);
        if (error.statusCode === 409 || isDuplicateKeyError(error)) {
          return res.status(409).json({
            message: error.message || duplicateFieldMessage(error.keyPattern),
          });
        }
        res.status(500).json({ message: error.message || "Erreur serveur" });
      }
    });

    // Supprimer un produit (admin only)
    app.delete('/api/products/:id', verifyAdmin, async (req, res) => {
      try {
        const deleted = await Product.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ message: "Produit introuvable" });
        const cache = require('./utils/cache');
        cache.delPrefix('products:');
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
        console.error("[server.js] Erreur capturée :", error);
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
        console.error("[server.js] Erreur capturée :", error);
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
        console.error("[server.js] Erreur capturée :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Statistiques globales (admin only)
    app.get('/api/admin/stats', verifyToken, async (req, res) => {
      try {
        const admin = await Admin.findById(req.user.userId);
        if (!admin) return res.status(401).json({ message: "Non autorisé" });
        const UserModel = require('./Models/User');
        const [products, commandes, achats, users, allCommandes, allAchats] = await Promise.all([
          Product.countDocuments(),
          Commande.countDocuments(),
          Achat.countDocuments(),
          UserModel.countDocuments(),
          Commande.find({ status: { $in: ['Payé', 'Validée', 'Achevée'] } }, 'totalPrice'),
          Achat.find({ status: { $in: ['Payé', 'Validée', 'Achevée'] } }, 'totalPrice'),
        ]);
        const recentCommandes = await Commande.find().sort({ date: -1 }).limit(5);
        const recentAchats = await Achat.find().sort({ date: -1 }).limit(5);

        const revenue = [...allCommandes, ...allAchats].reduce((sum, item) => sum + (Number(item.totalPrice) || 0), 0);

        res.status(200).json({ products, commandes, achats, users, recentCommandes, recentAchats, revenue });
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

        const limit = Math.min(200, parseInt(req.query.limit, 10) || 100);
        const commandes = await Commande.find().sort({ createdAt: -1 }).limit(limit).lean();
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

        const limit = Math.min(200, parseInt(req.query.limit, 10) || 100);
        const achats = await Achat.find().sort({ createdAt: -1 }).limit(limit).lean();
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