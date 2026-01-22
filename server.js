const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const connectDB = require('./Congfig/db');
const verifyToken = require('./Middlewares/verifyTokens');
const Commande = require('./Models/Commande');
const Admin = require('./Models/Admin');
const Achat = require('./Models/Achat');

const app = express();
const port = process.env.PORT || 8000;

// CONFIGURATION CORS AMÉLIORÉE POUR iOS/macOS
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'http://localhost:3000',
      'https://www.dangoimport.com',
      'http://localhost:3001', // pour le développement
    ];
    
    // Autoriser les requêtes sans origin (apps mobiles)
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

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

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

    // Connexion admin
    app.post('/login', async (req, res) => {
      const { adminName, adminPassword } = req.body;

      try {
        const admin = await Admin.findOne({ adminName });
        if (!admin) {
          return res.status(401).json({ message: "Admin non trouvé !" });
        }

        const isMatch = await bcrypt.compare(adminPassword, admin.adminPassword);
        if (!isMatch) {
          return res.status(401).json({ message: "Mot de passe incorrect" });
        }

        const token = jwt.sign(
          { userId: admin._id },
          process.env.JWT_SECRET,
          { expiresIn: '1h' }
        );

        res.status(200).json({ message: 'Connexion réussie', token });
      } catch (error) {
        console.error('Erreur /login :', error);
        res.status(500).json({ message: 'Erreur serveur', error: error.message });
      }
    });

    // Récupérer les données de l'admin connecté
    app.get('/admin_data', verifyToken, async (req, res) => {
      try {
        const admin = await Admin.findById(req.user.userId);
        if (!admin) {
          return res.status(401).json({ message: "Admin non trouvé" });
        }

        return res.status(200).json({
          username: admin.adminName,
          userId: admin._id,
          role: admin.role,
        });
      } catch (error) {
        console.error('Erreur /admin_data :', error);
        res.status(500).json({ message: "Erreur interne du serveur" });
      }
    });


    // Passer une commande
    app.post('/commander', async (req, res) => {
      const { userName, userEmail, categorie, productQuantity, picture, productDescription, selectedCountry, status } = req.body;
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
          date,
        });

        await newCommande.save();
        res.status(201).json({ 
          message: "Nous avons reçu votre commande, nous vous contacterons !",
          commandeId: newCommande._id
        });
      } catch (error) {
        console.error("Erreur /commander :", error);
        res.status(500).json({ message: "Erreur serveur", error: error.message });
      }
    });

    // Acheter
    app.post('/acheter', async (req, res) => {
      const { userName, userNumber, productQuantity, picture, userPref, userEmail, selectedCountry, status } = req.body;
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
          date,
        });

        await newAchat.save();
        res.status(201).json({ 
          message: "Nous avons reçu votre commande, nous vous contacterons !",
          achatId: newAchat._id
        });
      } catch (error) {
        console.error("Erreur /acheter :", error);
        res.status(500).json({ message: "Erreur serveur", error: error.message });
      }
    });

    // OTP
    const otpStore = new Map();

    app.post('/api/send-otp', async (req, res) => {
      const { userEmail } = req.body;
      
      if (!userEmail) {
        return res.status(400).json({ message: 'Email requis' });
      }

      const otp = generateOTP();
      const expiration = Date.now() + 5 * 60 * 1000;

      otpStore.set(userEmail, { otp, expiration });

      try {
        const data = await resend.emails.send({
          from: `Dango Import <${process.env.EMAIL}>`,
          to: userEmail,
          subject: 'Confirmez votre adresse email',
          text: `Votre code OTP est : ${otp}. Ce code est valide pendant 5 minutes.`,
        });

        console.log('✅ Email OTP envoyé via Resend :', data);
        return res.status(200).json({ message: 'OTP envoyé avec succès' });
      } catch (error) {
        console.error('❌ Erreur envoi OTP via Resend :', error);
        return res.status(500).json({ message: 'Erreur envoi OTP', error: error.message });
      }
    });

    app.post('/api/verify-otp', (req, res) => {
      const { userEmail, otp } = req.body;
      const record = otpStore.get(userEmail);

      if (!record) return res.status(400).json({ message: 'OTP non trouvé' });
      if (Date.now() > record.expiration) {
        otpStore.delete(userEmail);
        return res.status(400).json({ message: 'OTP expiré' });
      }
      if (record.otp !== otp) {
        return res.status(400).json({ message: 'OTP invalide' });
      }
      otpStore.delete(userEmail);
      return res.status(200).json({ message: 'OTP vérifié avec succès' });
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

    // Modifier le statut d'une commande
    app.put('/devis/status', async (req, res) => {
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

        res.status(200).json(updatedAchat);
      } catch (err) {
        console.error("Erreur maj achat:", err);
        res.status(500).json({ message: "Erreur serveur" });
      }
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

    // Lancer le serveur
    app.listen(port, () => {
      console.log(`🚀 Serveur lancé sur le port ${port}`);
      console.log(`📱 Compatible iOS/macOS`);
      console.log(`🌐 Environnement: ${process.env.NODE_ENV || 'development'}`);
    });

  } catch (err) {
    console.error('❌ Erreur de démarrage du serveur :', err);
    process.exit(1);
  }
};

startServer();