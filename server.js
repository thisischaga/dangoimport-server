const express = require('express');
const cors = require('cors');
//const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
//const africastalking = require('africastalking');
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
app.use('/images', express.static('public/images'));


app.use(cors({
  origin: ['http://localhost:3000', 'https://www.dangoimport.com'],
  credentials: true,
}));

app.use(express.json({ limit: '125mb' }));

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}


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
    
    
    app.get('/api/products', (req, res) => {
      const productOne = {
            id: 1,
            productImg: 'https://dangoimport-server.onrender.com/images/montre1.png',
            price: '13 000',
            name: 'G-Shock',
            description: "Les montres G-Shock sont des montres robustes et stylées, conçues pour résister aux chocs, à l’eau et aux conditions extrêmes tout en offrant un design moderne et sportif. Elles sont disponibles en toutes couleurs et aux prix forfaitaires de 13000f"
        };
        const productTwo = {
            id: 2,
            productImg: 'https://dangoimport-server.onrender.com/images/product2.png',
            price: '12 000',
            name: 'Gaecrolft',
            description: 'GAEGRLOF – Design Urbain & Confort Moderne. Affirme ton style avec ces sneakers GAEGRLOF au look audacieux ! Dotées d’une semelle épaisse et ergonomique, elles assurent un confort optimal tout au long de la journée. Leur design bicolore noir et blanc apporte une touche tendance et urbaine, parfaite pour les tenues streetwear. Le laçage épais et la finition soignée en font une paire à la fois stylée et résistante, idéale pour affronter la ville avec assurance.'
        };
        const productThree = {
            id: 3,
            productImg: 'https://dangoimport-server.onrender.com/images/montre2.png',
            price: '17 000',
            name: 'Poedagar',
            description: "La montre Poedagar est un accessoire élégant et robuste conçu pour ceux qui recherchent un style luxueux à prix abordable. Avec son boîtier en acier inoxydable et son verre minéral résistant aux rayures, elle s’adapte aussi bien aux environnements professionnels qu’aux sorties décontractées. Son mouvement à quartz (ou automatique selon le modèle) assure une précision fiable au quotidien. Dotée d’un bracelet en cuir ou en métal, elle offre un confort optimal et un look soigné. Son affichage analogique, parfois accompagné d’un indicateur de date ou de jour, la rend pratique et esthétique. Enfin, grâce à son étanchéité 3ATM, elle résiste aux éclaboussures, mais il est préférable d’éviter l’immersion."
        };
        const productFour = {
            id: 4,
            productImg: 'https://dangoimport-server.onrender.com/images/sac1.png',
            price: '3 000',
            name: 'Sac à nattes',
            description: "Sac pour toute genre d'usage durable, pratique, jolie, tout pour votre confort . Vous permet d'être élégant lors de vos petites sorties ou lors d'un voyage. Vous disposez d'un large choix de couleurs et de motifs en plus des différents formats petit sac pour transporter vos affaires : 500f 700f 1000f 2000f sac en valise 3000f 5000f sac en forme de panier parfait pour ranger votre linge, vos affaires 3000f 4000f 5000f. N'hésitez pas à préciser vos préferences dans la description du formulaire d'achat"
        };
        const productFive = {
            id: 5,
            productImg: 'https://dangoimport-server.onrender.com/images/blueberry.png',
            price: "1-20 : 500 fcfa l'unité,  20- 50 : 300 fcfa l'unité, 50- 100 : 200 fcfa l'unité",
            name: 'PUQUIANNA',
            description: "Masque de visage Naturel hydratant, rend la peau douce, élimine les acnés, les imperfections, les peau mortes, antirides etc... disponible"
        };
        const products = [
            productOne,
            productTwo,
            productThree,
            productFour,
            productFive
        ];
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
            userEmail,
            selectedCountry,
            status, } = req.body;
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
        res.status(201).json({ message: "Nous avons reçu votre commande, nous vous contacterons !" });
      } catch (error) {
        console.error("Erreur /achater :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });

    // OTP
    const otpStore = new Map();

    /*const transporter = nodemailer.createTransport({
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

      const mailOptions = {
        from: `Dango Import <${process.env.EMAIL}>`,
        to: userEmail,
        subject: 'Confirmez votre adresse email',
        text: `Votre code OTP est : ${otp} ce code est valide pendant 5 minutes.`,
      };

      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error(error);
          return res.status(500).json({ message: 'Erreur envoi email' });
        } else {
          return res.status(200).json({ message: 'OTP envoyé avec succès' });
        }
      });
    });*/

    
    app.post('/api/send-otp', async (req, res) => {
      const { userEmail } = req.body;
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
        return res.status(500).json({ message: 'Erreur envoi OTP' });
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
        res.json(commandes);
      } catch (error) {
        console.error("Erreur /commandes :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });
    // Récupérer toutes les achats
    app.get('/achats', verifyToken, async (req, res) => {
      try {
        const admin = await Admin.findById(req.user.userId);
        if (!admin) {
          return res.status(401).json({ message: "Admin non trouvé" });
        }

        const achats = await Achat.find().sort({ createdAt: 1 });
        res.json(achats);
      } catch (error) {
        console.error("Erreur /achats :", error);
        res.status(500).json({ message: "Erreur serveur" });
      }
    });
    // Modifier le statut d’une commande
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

        res.json(updatedCommande);
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

        res.json(updatedAchat);
      } catch (err) {
        console.error("Erreur maj achat:", err);
        res.status(500).json({ message: "Erreur serveur" });
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
