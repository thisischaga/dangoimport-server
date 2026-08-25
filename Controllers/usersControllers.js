const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const User = require('../Models/User');
const { Resend } = require('resend');
const { generateOTP } = require('../utils/otp');

const {
    getGoogleAuthUrl,
    getGoogleUser
} = require('../utils/googleAuth');

dotenv.config();
const resend = new Resend(process.env.RESEND_API_KEY);

const { google } = require('googleapis');

const googleOAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL
);

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
        if (!user.isVerified) return res.status(403).json({ message: "Veuillez vérifier votre compte avant de vous connecter." });

        const isMatch = await bcrypt.compare(userPassword, user.userPassword);
        if (!isMatch) {
            return res.status(401).json({ message: "Mot de passe incorrect" });
        }

        const token = jwt.sign({ userId: user._id, role: user.role || 'customer' }, process.env.JWT_SECRET, { expiresIn: '24h' });
        res.status(200).json({
            message: 'connexion réussie',
            token,
            user: {
                id: user._id,
                userId: user._id,
                userFirstname: user.userFirstname,
                userSurname: user.userSurname,
                userEmail: user.userEmail,
                userPhone: user.userPhone || '',
                role: user.role || 'customer',
                isVendor: user.isVendor || (user.role === 'vendor'),
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
                from: `Dangoimport <${process.env.EMAIL || 'onboarding@resend.dev'}>`,
                to: userEmail,
                subject: 'Vérifiez votre compte Dangoimport',
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
            { userId: newUser._id, role: newUser.role || 'customer' },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.status(201).json({ 
            message: 'Compte créé et vérifié avec succès', 
            token,
            user: {
                id: newUser._id,
                userId: newUser._id,
                userFirstname: newUser.userFirstname,
                userSurname: newUser.userSurname,
                userEmail: newUser.userEmail,
                userPhone: newUser.userPhone || '',
                role: newUser.role || 'customer',
                isVendor: newUser.isVendor || (newUser.role === 'vendor'),
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

const { google } = require('googleapis');

const googleOAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL
);

const googleLogin = (req, res) => {
    console.log('GOOGLE_CLIENT_ID:', !!process.env.GOOGLE_CLIENT_ID);
    console.log('GOOGLE_CLIENT_SECRET:', !!process.env.GOOGLE_CLIENT_SECRET);
    console.log(
        'GOOGLE_CALLBACK_URL:',
        process.env.GOOGLE_CALLBACK_URL
    );

    const authUrl = googleOAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'openid',
            'email',
            'profile'
        ],
        prompt: 'select_account'
    });

    console.log('URL Google:', authUrl);

    res.redirect(authUrl);
};
const googleCallback = async (req, res) => {

    try {

        const { code, error } = req.query;


        // L'utilisateur a annulé Google
        if (error) {

            return res.redirect(
                `${process.env.FRONTEND_URL}/login?error=google_cancelled`
            );
        }


        if (!code) {

            return res.redirect(
                `${process.env.FRONTEND_URL}/login?error=google_no_code`
            );
        }


        // ============================
        // RÉCUPÉRER LE PROFIL GOOGLE
        // ============================

        const googleUser = await getGoogleUser(code);


        if (!googleUser.userEmail) {

            return res.redirect(
                `${process.env.FRONTEND_URL}/login?error=google_no_email`
            );
        }


        const email = googleUser.userEmail.toLowerCase();


        // ============================
        // 1. RECHERCHE PAR GOOGLE ID
        // ============================

        let user = await User.findOne({
            googleId: googleUser.googleId
        });


        // ============================
        // 2. SI GOOGLE ID INEXISTANT
        // ============================

        if (!user) {

            // Recherche d'un compte existant
            // avec le même email
            user = await User.findOne({
                userEmail: email
            });


            // ============================
            // COMPTE DÉJÀ EXISTANT
            // ============================

            if (user) {

                // Lier Google au compte existant
                user.googleId = googleUser.googleId;

                if (!user.authProviders.includes('google')) {
                    user.authProviders.push('google');
                }


                // Ajouter la photo Google seulement
                // si l'utilisateur n'a pas encore de photo
                if (!user.profileImage && googleUser.profileImage) {
                    user.profileImage =
                        googleUser.profileImage;
                }


                // Google a déjà vérifié l'email
                if (googleUser.emailVerified) {
                    user.isVerified = true;
                }


                user.updatedAt = new Date();

                await user.save();

            } else {

                // ============================
                // NOUVEL UTILISATEUR GOOGLE
                // ============================

                user = new User({

                    userFirstname:
                        googleUser.userFirstname ||
                        'Utilisateur',

                    userSurname:
                        googleUser.userSurname ||
                        '',

                    userEmail: email,

                    googleId:
                        googleUser.googleId,

                    authProviders: ['google'],

                    profileImage:
                        googleUser.profileImage || '',

                    isVerified:
                        googleUser.emailVerified || false,

                    role: 'customer',

                    isVendor: false

                });

                await user.save();
            }
        }


        // ============================
        // GÉNÉRATION DU JWT
        // ============================

        const token = jwt.sign(

            {
                userId: user._id,
                role: user.role || 'customer'
            },

            process.env.JWT_SECRET,

            {
                expiresIn: '24h'
            }

        );


        // ============================
        // REDIRECTION FRONTEND
        // ============================

        return res.redirect(

            `${process.env.FRONTEND_URL}/oauth-success?token=${encodeURIComponent(token)}`

        );

    } catch (error) {

        console.error(
            'Erreur Google OAuth callback:',
            error
        );

        return res.redirect(

            `${process.env.FRONTEND_URL}/login?error=google_failed`

        );
    }
};

const getCurrentUser = async (req, res) => {

    try {

        const user =
            await User.findById(
                req.userId
            );


        if (!user) {

            return res.status(404).json({
                message:
                    'Utilisateur non trouvé'
            });
        }


        return res.status(200).json({

            user: {

                id: user._id,

                userId: user._id,

                userFirstname:
                    user.userFirstname,

                userSurname:
                    user.userSurname,

                userEmail:
                    user.userEmail,

                userPhone:
                    user.userPhone || '',

                profileImage:
                    user.profileImage || '',

                role:
                    user.role || 'customer',

                isVendor:
                    user.isVendor ||
                    user.role === 'vendor',

                vendorName:
                    user.vendorName || '',

                balance:
                    user.balance || 0,

                bankDetails:
                    user.bankDetails || {}

            }

        });

    } catch (error) {

        console.error(
            'Erreur récupération utilisateur:',
            error
        );


        return res.status(500).json({
            message:
                'Erreur interne du serveur'
        });
    }
};

module.exports = {
    login,
    signup,
    sendSignupOTP,
    googleLogin,
    googleCallback,
    getCurrentUser
};