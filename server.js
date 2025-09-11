const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const connectDB = require('./Congfig/db');
const verifyToken = require('./Middlewares/verifyTokens');
const Commande = require('./Models/Commande');
const Admin = require('./Models/Admin');
const Achat = require('./Models/Achat');

const app = express();
const port = process.env.PORT || 8000;
app.use('/images', express.static('public/images'));

// Middlewares 
app.use(cors({
  origin: 'https://www.dangoimport.com',
  credentials: true,
}));
//app.use(cors());
app.use(express.json({ limit: '125mb' }));

// Route de test
app.get('/', (req, res) => {
  res.send('Serveur Dango Import fonctionne !');
});

// Création d'un admin par défaut si inexistant
/*const createDefaultAdmin = async () => {
  try {
    const existingAdmin = await Admin.findOne({ adminName: 'CHAGA@228' });

    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash('passwordChaga@2025', 10);
      const newAdmin = new Admin({
        adminFirstname: 'Chaga',
        adminSurname: 'Crédo',
        adminName: 'CHAGA@228',
        adminPassword: hashedPassword,
        role: 'dev',
      });
      await newAdmin.save();
      console.log('✅ Admin par défaut créé');
    }
  } catch (err) {
    console.error("❌ Erreur lors de la création de l'admin :", err);
  }
};*/

//  Point de départ du serveur
const startServer = async () => {
  try {
    connectDB(); 
    //await createDefaultAdmin(); 
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
        res.status(500).json({ message: 'Erreur serveur' });
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
        res.status(500).json({ message: 'Erreur serveur' });
      }
    });

    // Récupérer les données de l’admin connecté
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
    const productOne = {
        id: 1,
        productImg: 'https://dangoimport-server.onrender.com/images/product1.png',
        price: 12000,
        name: 'Gaecrolft',
        description: 'GAEGRLOF – Design Urbain & Confort Moderne. Affirme ton style avec ces sneakers GAEGRLOF au look audacieux ! Dotées d’une semelle épaisse et ergonomique, elles assurent un confort optimal tout au long de la journée. Leur design bicolore noir et blanc apporte une touche tendance et urbaine, parfaite pour les tenues streetwear. Le laçage épais et la finition soignée en font une paire à la fois stylée et résistante, idéale pour affronter la ville avec assurance.'
    };
    const productTwo = {
        id: 2,
        productImg: 'https://dangoimport-server.onrender.com/images/product2.png',
        price: 12000,
        name: 'Gaecrolft',
        description: 'GAEGRLOF – Design Urbain & Confort Moderne. Affirme ton style avec ces sneakers GAEGRLOF au look audacieux ! Dotées d’une semelle épaisse et ergonomique, elles assurent un confort optimal tout au long de la journée. Leur design bicolore noir et blanc apporte une touche tendance et urbaine, parfaite pour les tenues streetwear. Le laçage épais et la finition soignée en font une paire à la fois stylée et résistante, idéale pour affronter la ville avec assurance.'
    };
    const productThree = {
        id: 3,
        productImg: 'https://dangoimport-server.onrender.com/images/product3.png',
        price: 12000,
        name: 'GLECRLOF',
        description: 'Sneakers GLECRLOF Urban Rope . Ces baskets au design audacieux allient confort et originalité. Dotées d’une semelle épaisse pour un meilleur amorti, elles se distinguent par leurs lacets en corde surdimensionnés et un mélange de matières modernes : cuir synthétique blanc et tissu kaki respirant. Leur style streetwear chic s’adresse aux amateurs de mode urbaine à la recherche d’un look unique.'
    };
    const products = [
        productOne,
        productTwo,
        productThree
    ];
    app.get('/api/products', (req, res) => {
      res.json(products);
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
        res.status(201).json({ message: "Nous avons reçu votre commande, nous vous contacterons !" });
      } catch (error) {
        console.error("Erreur /commander :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });
    // Acheter
    app.post('/acheter', async (req, res) => {
      const { userName,
            userNumber,
            productQuantity,
            picture,
            userPref,
            selectedCountry,
            status, } = req.body;
      const date = new Date();

      if (!userNumber || !userName || !productQuantity || !picture || !userPref || !selectedCountry || !status) {
        return res.status(400).json({ message: "Champs manquants." });
      }

      try {
        const newAchat = new Achat({
            userName,
            userNumber,
            productQuantity,
            picture: image,
            userPref,
            selectedCountry,
            status,
            date,
        });

        await newAchat.save();
        res.status(201).json({ message: "Nous avons reçu votre commande, nous vous contacterons !" });
      } catch (error) {
        console.error("Erreur /achater :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // OTP
    const otpStore = new Map();

    function generateOTP() {
      return Math.floor(100000 + Math.random() * 900000).toString();
    }

    const transporter = nodemailer.createTransport({
      host: 'smtp.hostinger.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASS,
      }
    });

    app.post('/api/send-otp', (req, res) => {
      const { userEmail } = req.body;
      const otp = generateOTP();
      const expiration = Date.now() + 5 * 60 * 1000;

      otpStore.set(userEmail, { otp, expiration });
      /*client.messages
        .create({
          body: Votre code OTP est : ${otp},
          from: '+TON_NUM_TWILIO',
          to: phone
        })
        .then(() => res.send({ success: true }))
        .catch(err => res.status(500).send({ error: err.message }));*/

      const mailOptions = {
        from: `Dango Import <${process.env.EMAIL}>`,
        to: userEmail,
        subject: 'Confirmez votre adresse email',
        text: `Votre code OTP est : ${otp}`,
      };

      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error(error);
          return res.status(500).json({ message: 'Erreur envoi email' });
        } else {
          return res.status(200).json({ message: 'OTP envoyé avec succès' });
        }
      });
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
      /*if (otpStore[phone] === otp) {
        delete otpStore[phone];
        
        return res.status(200).json({ message: 'OTP vérifié avec succès' });
      }*/
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
        res.json(commandes);
      } catch (error) {
        console.error("Erreur /commandes :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // Modifier le statut d’une commande
    app.put('/status', async (req, res) => {
      const { orderId, status } = req.body;
      try {
        let newStatus = 'En attente';
        if (status === 'En attente') newStatus = 'Validée';
        else if (status === 'Validée') newStatus = 'Achevée';

        await Commande.findByIdAndUpdate(orderId, { status: newStatus });
        res.status(200).json({ message: `Statut mis à jour: ${newStatus}` });
      } catch (error) {
        console.error("Erreur /status :", error);
        res.status(500).json({ message: "Erreur mise à jour statut" });
      }
    });

    // Lancer le serveur
    app.listen(port, () => {
      console.log(`🚀 Serveur lancé sur le port ${port}`);
    });

  } catch (err) {
    console.error('❌ Erreur de démarrage du serveur :', err);
    process.exit(1);
  }
};

startServer();
