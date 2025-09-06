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

mongoose.set('bufferCommands', false);

const app = express();
const port = process.env.PORT || 8000;

app.use(cors({
  origin: 'https://www.dangoimport.com',
  credentials: true,
}));
app.use(express.json({ limit: '125mb' }));

//  Fonction d'admin par défaut
const createDefaultAdmin = async () => {
  const existingAdmin = await Admin.findOne({ adminName: 'CHAGA@228' });

  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash('passwordChaga@2025', 10);
    const newAdmin = new Admin({
      adminFirstname: 'Chaga',
      adminSurname: 'Crédo',
      adminName: 'CHAGA@228',
      adminPassword: hashedPassword,
      role: 'dev'
    });
    await newAdmin.save();
    console.log('Admin par défaut créé');
  }
};

// Fonction principale de lancement
const startServer = async () => {
  try {
    await connectDB();
    console.log('✅ Connecté à MongoDB');

    //await createDefaultAdmin();

    //ROUTE POUR L'AJOUTER UN ADMIN
    app.post('/add_admin', async (req, res) => {
        const {adminFirstname, adminSurname, adminName, adminPassword, role} = req.body;
        try {
            const existingAdmin = await Admin.findOne({adminName});
            if (existingAdmin) {
                res.status(400).json({message: "Ce nom d'admin existe déjà !"})
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
                {userId: newAdmin._id},
                process.env.JWT_SECRET,
                {expiresIn: '1h'}

            )
            res.status(201).json({ message: 'Vous avez ajouté une membre', token });
            console.log('Un admin a été ajputé', adminFirstname, adminSurname);

        } catch (error) {
            console.log('Erreur du serveur', error)
            res.status(500).json({ message: 'Erreur interne du serveur' });
        }
    });

    // ROUTE POUR LA GESTION DES LOGIN
    app.post('/login', async (req,res) =>{
        const {adminName, adminPassword} = req.body;

        try {
            const admin = await Admin.findOne({adminName});
            if (!admin) {
                return res.status(401).json({message: "Admin non trouvé ! "});
            }
            const isMatch = await bcrypt.compare(adminPassword, admin.adminPassword);
            if (!isMatch) {
                return res.status(401).json({ message: "Mot de passe incorrect" });
            }
            
            // Générer un token JWT
            const token = jwt.sign(
                {userId: admin._id},
                process.env.JWT_SECRET,
                {expiresIn: '1h'}
        
            )
            res.status(200).json({message: 'connexion réussie',token });
            console.log("Un admin s'est connecté, ", adminName);
            

        } catch (error) {
            res.status(500).json({ message: 'Erreur interne du serveur' });
            console.log('Erreur', error)
        }

    });
    // Route pour récupérer les données de l'admin connecté
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
            res.status(500).json({ message: "Erreur interne du serveur" });
            console.log('Erreur:', error);
        }
    });
    // Route pour commander
    app.post('/commander', async (req, res) => {
    const { userName, userEmail, categorie, productQuantity, picture, selectedCountry, status} = req.body;
    const date = new Date();

    // Validation des champs requis
    if (!userEmail || !userName || !categorie || !productQuantity || !picture || !selectedCountry || !status) {
        return res.status(400).json({ message: "Champs manquants. Veuillez remplir tous les champs obligatoires." });
    }

    try {
        const newCommande = new Commande({
            userName,
            userEmail,
            categorie,
            productQuantity,
            picture,
            selectedCountry,
            status,
            date,
        });

        await newCommande.save();

        res.status(201).json({ message: "Votre commande est bien envoyée !" });
    } catch (error) {
        console.error("Erreur:", error);
        res.status(500).json({ message: "Erreur interne du serveur" });
    }
    });
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

    // Route pour envoyer l'OTP
    app.post('/api/send-otp', (req, res) => {
    const { userEmail } = req.body;
    const otp = generateOTP();
    const expiration = Date.now() + 5 * 60 * 1000;

    otpStore.set(userEmail, { otp, expiration });
    const mailOptions = {
        from: 'Dango Import <'+process.env.EMAIL+'>',
        to:userEmail,
        subject: 'Confirmer votre adresse email',
        text: `Votre code OTP est : ${otp}`,
        
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
        console.log(error);
        return res.status(500).json({ message: 'Erreur envoi email' });
        } else{
            res.status(200).json({message: 'otp envoyé'});
        }
    });
    });

    // Route pour vérifier l'OTP
    app.post('/api/verify-otp', (req, res) => {
    const { userEmail, otp } = req.body;
    console.log(userEmail, otp);
    const record = otpStore.get(userEmail);

    if (!record) return res.status(400).json({ message: 'Aucun OTP trouvé' });

    if (Date.now() > record.expiration) {
        otpStore.delete(userEmail);
        return res.status(400).json({ message: 'OTP expiré' });
    }

    if (record.otp !== otp) {
        return res.status(400).json({ message: 'OTP invalide' });
    }

    otpStore.delete(userEmail); 
    return res.json({ message: 'OTP vérifié avec succès !' });
    });

    // Routes pour récupérer les commandes
    app.get('/commandes', verifyToken, async(req,res) =>{
        const admin = await Admin.findById(req.user.userId);
        if (!admin) {
            return res.status(401).json({ message: "Admin non trouvé" });
        }
        console.log(admin);
        try {
            const commandes = await Commande.find().sort({createdAt: 1});
            res.json(commandes);
        } catch (error) {
            res.status(500).json({ message: "Erreur interne du serveur" });
            console.log('Erreur:', error);
        }
    });
    //Modifier la status de la commande
    app.put('/status', async(req,res) => {
        const {orderId, status} = req.body;
        try {
            if (status === 'En attente') {
                await Commande.findByIdAndUpdate(orderId, {status: 'Validée'});
            } else if (status === 'Validée') {
                await Commande.findByIdAndUpdate(orderId, {status: 'Achevée'});
            } else if (status === 'Achevée') {
                await Commande.findByIdAndUpdate(orderId, {status: 'En attente'});
            }
            
        } catch (error) {
            console.log('Erreur : ', error);
        }
    });
    // Lancement du serveur
    app.listen(port, () => {
      console.log(`🚀 Serveur lancé sur le port ${port}`);
    });

  } catch (err) {
    console.error('❌ Erreur de démarrage du serveur :', err);
    process.exit(1);
  }
};

startServer(); 
