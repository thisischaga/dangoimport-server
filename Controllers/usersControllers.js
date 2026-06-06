const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const User = require('../Models/User');
const { Resend } = require('resend');
const { generateOTP } = require('../utils/otp');

dotenv.config();
const resend = new Resend(process.env.RESEND_API_KEY);

// Store OTPs in memory (Note: In production, use Redis or a DB)
const signupOtpStore = new Map();

const login = async (req, res) => {
    const { userEmail, userPassword } = req.body;

    if (!userEmail || !userPassword) {
        return res.status(400).json({ message: "Veuillez fournir un email et un mot de passe." });
    }

    try {
        const user = await User.findOne({ userEmail });

        if (!user) {
            return res.status(401).json({ message: "Utilisateur non trouvé !" });
        }

        // Vérifier si le compte est vérifié (si on décide d'utiliser isVerified)
        // if (!user.isVerified) return res.status(403).json({ message: "Veuillez vérifier votre compte avant de vous connecter." });

        const isMatch = await bcrypt.compare(userPassword, user.userPassword);
        if (!isMatch) {
            return res.status(401).json({ message: "Mot de passe incorrect" });
        }

        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.status(200).json({
            message: 'connexion réussie',
            token,
            user: {
                userFirstname: user.userFirstname,
                userSurname: user.userSurname,
                userEmail: user.userEmail,
                isVendor: user.isVendor || false,
                vendorName: user.vendorName || '',
                balance: user.balance || 0,
                bankDetails: user.bankDetails || {}
            }
        });
        console.log('Un utilisateur vient de se connecter ', userEmail);

    } catch (error) {
        res.status(500).json({ message: 'Erreur interne du serveur' });
        console.log('Erreur', error);
    }
};

const sendSignupOTP = async (req, res) => {
    const { userEmail } = req.body;

    if (!userEmail) return res.status(400).json({ message: "Email requis" });

    try {
        const existingUser = await User.findOne({ userEmail });
        if (existingUser) return res.status(400).json({ message: "Cet email est déjà utilisé." });

        const otp = generateOTP();
        const expiration = Date.now() + 10 * 60 * 1000; // 10 minutes

        signupOtpStore.set(userEmail, { otp, expiration });

        // Log the OTP for local development/debugging
        console.log(`\n================================`);
        console.log(`🔐 OTP pour ${userEmail} : ${otp}`);
        console.log(`================================\n`);

        try {
            await resend.emails.send({
                from: `Dango Import <${process.env.EMAIL || 'onboarding@resend.dev'}>`,
                to: userEmail,
                subject: 'Vérifiez votre compte Dango Import',
                text: `Votre code de vérification est : ${otp}. Il expire dans 10 minutes.`,
            });
        } catch (emailError) {
            console.log("Attention: l'envoi de l'email via Resend a échoué (clé API manquante ?). L'OTP est disponible dans la console du serveur.");
        }

        res.status(200).json({ message: "OTP envoyé avec succès" });
    } catch (error) {
        console.error("Erreur sendSignupOTP:", error);
        res.status(500).json({ message: "Erreur lors de la préparation de l'OTP" });
    }
};

const signup = async (req, res) => {
    const { userFirstname, userSurname, userEmail, userPassword, otp } = req.body;

    try {
        // 1. Vérifier l'OTP
        const record = signupOtpStore.get(userEmail);
        if (!record) return res.status(400).json({ message: "Session expirée ou email non trouvé. Veuillez renvoyer le code." });
        
        if (Date.now() > record.expiration) {
            signupOtpStore.delete(userEmail);
            return res.status(400).json({ message: "Code expiré." });
        }

        if (record.otp !== otp) {
            return res.status(400).json({ message: "Code de vérification incorrect." });
        }

        // 2. Vérification si l'email existe déjà (double check)
        const existingUser = await User.findOne({ userEmail });
        if (existingUser) {
            return res.status(400).json({ message: "L'email est déjà utilisé !" });
        }

        // 3. Création de l'utilisateur
        const hashedPassword = await bcrypt.hash(userPassword, 10);
        const newUser = new User({ 
            userFirstname, 
            userSurname, 
            userEmail, 
            userPassword: hashedPassword,
            isVerified: true 
        });
        await newUser.save();

        signupOtpStore.delete(userEmail);

        const token = jwt.sign(
            { userId: newUser._id },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.status(201).json({ 
            message: 'Compte créé et vérifié avec succès', 
            token,
            user: {
                userFirstname: newUser.userFirstname,
                userSurname: newUser.userSurname,
                userEmail: newUser.userEmail,
                isVendor: newUser.isVendor || false,
                vendorName: newUser.vendorName || '',
                balance: newUser.balance || 0,
                bankDetails: newUser.bankDetails || {}
            }
        });

    } catch (error) {
        console.log('Erreur du serveur signup', error);
        res.status(500).json({ message: 'Erreur interne du serveur' });
    }
};

module.exports = { login, signup, sendSignupOTP };
