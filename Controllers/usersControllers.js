const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const User = require('../Models/User');
const Driver = require('../Models/Driver');
const { Resend } = require('resend');
const { generateOTP } = require('../utils/otp');

const {
    getGoogleAuthUrl,
    getGoogleUser,
    verifyGoogleToken
} = require('../utils/googleAuth');

dotenv.config();
const resend = new Resend(process.env.RESEND_API_KEY);

const { google } = require('googleapis');


// Store OTPs in memory (Note: In production, use Redis or a DB)
const signupOtpStore = new Map();

const getPhoneVariants = (value = '') => {
    const digits = String(value).replace(/\D/g, '');
    if (!digits) return [];

    const variants = new Set();
    variants.add(digits);
    variants.add(`+${digits}`);

    if (digits.startsWith('229') && digits.length > 3) {
        variants.add(digits.slice(3));
        variants.add(`+${digits}`);
        variants.add(`+229${digits.slice(3)}`);
    }

    if (!digits.startsWith('229') && digits.length === 8) {
        variants.add(`229${digits}`);
        variants.add(`+229${digits}`);
    }

    if (digits.startsWith('0') && digits.length > 1) {
        variants.add(digits.slice(1));
        variants.add(`+${digits.slice(1)}`);
    }

    return [...variants];
};

const matchesPassword = async (candidatePassword, inputPassword) => {
    if (!candidatePassword) return false;
    if (String(candidatePassword) === String(inputPassword)) return true;
    try {
        return await bcrypt.compare(String(inputPassword), String(candidatePassword));
    } catch (error) {
        return false;
    }
};

const login = async (req, res) => {
    const {
        userEmail,
        userPhone,
        phone,
        userPassword,
        password,
        driverCode,
        userIdentifier,
        identifier,
    } = req.body || {};

    const rawIdentifier = (
        identifier ||
        userPhone ||
        phone ||
        userEmail ||
        driverCode ||
        userIdentifier ||
        ''
    ).toString().trim();
    const identifierValue = rawIdentifier.replace(/\s+/g, '');
    const cleanPassword = typeof (userPassword ?? password) === 'string'
        ? String(userPassword ?? password).trim()
        : (userPassword ?? password);

    if (!identifierValue || !cleanPassword || !String(cleanPassword).trim()) {
        return res.status(400).json({ message: "Veuillez fournir un numéro et un mot de passe." });
    }

    const normalizedIdentifier = identifierValue;

    try {
        let user = null;
        let resolvedDriverCode = null;

        if (normalizedIdentifier.includes('@')) {
            user = await User.findOne({ userEmail: normalizedIdentifier.toLowerCase() });
        }

        if (!user) {
            const phoneVariants = getPhoneVariants(normalizedIdentifier);
            const allPhoneVariants = [...new Set(phoneVariants.flatMap((value) => [
                value,
                value.replace(/^\+/, ''),
                value.startsWith('229') ? value.slice(3) : value,
                value.startsWith('0') ? value.replace(/^0/, '') : value,
            ]))];

            const candidateUsers = await User.find({ userPhone: { $in: allPhoneVariants } }).lean();

            for (const candidate of candidateUsers) {
                const driver = await Driver.findOne({ userId: candidate._id }).select('driverPassword').lean();
                const passwordsToCheck = [candidate.userPassword, driver?.driverPassword].filter(Boolean);

                for (const candidatePassword of passwordsToCheck) {
                    if (await matchesPassword(candidatePassword, cleanPassword)) {
                        user = candidate;
                        break;
                    }
                }

                if (user) break;
            }
        }

        if (!user && !normalizedIdentifier.includes('@')) {
            const driver = await Driver.findOne({ driverCode: normalizedIdentifier.toUpperCase() }).populate('userId');
            const candidateUser = driver?.userId;
            if (candidateUser) {
                const driverPassword = driver?.driverPassword;
                const passwordsToCheck = [candidateUser.userPassword, driverPassword].filter(Boolean);
                for (const candidatePassword of passwordsToCheck) {
                    if (await matchesPassword(candidatePassword, cleanPassword)) {
                        user = candidateUser;
                        resolvedDriverCode = driver.driverCode;
                        break;
                    }
                }
            }
        }

        if (!user) {
            return res.status(401).json({ message: "Utilisateur non trouvé !" });
        }

        const driver = await Driver.findOne({ userId: user._id }).lean();
        const token = jwt.sign({ userId: user._id, role: user.role || 'customer' }, process.env.JWT_SECRET, { expiresIn: '24h' });

        res.status(200).json({
            message: 'connexion réussie',
            token,
            driverCode: driver?.driverCode || resolvedDriverCode || null,
            user: {
                id: user._id,
                userId: user._id,
                userFirstname: user.userFirstname,
                userSurname: user.userSurname,
                userEmail: user.userEmail,
                userPhone: user.userPhone || '',
                role: user.role || 'customer',
                driverStatus: user.driverStatus || 'unavailable',
                isVendor: user.isVendor || (user.role === 'vendor'),
                isVerified: Boolean(user.isVerified),
                vendorName: user.vendorName || '',
                balance: user.balance || 0,
                bankDetails: user.bankDetails || {}
            }
        });
        console.log('Un utilisateur vient de se connecter ', normalizedIdentifier);

    } catch (error) {
        res.status(500).json({ message: 'Erreur interne du serveur' });
        console.log('Erreur', error);
    }
};

const crypto = require('crypto');
const emailService = require('../utils/emailService');

/**
 * POST /api/auth/send-verification-link
 * If authenticated (verifyToken), use req.userId, otherwise accept { email } in body.
 */
const sendVerificationLink = async (req, res) => {
    try {
        const User = require('../Models/User');
        let user;
        if (req.user && (req.user.userId || req.user.id)) {
            user = await User.findById(req.user.userId || req.user.id);
        } else {
            const { email } = req.body || {};
            if (!email) return res.status(400).json({ message: 'Email requis' });
            user = await User.findOne({ userEmail: String(email).toLowerCase() });
        }

        if (!user) return res.status(404).json({ message: 'Utilisateur introuvable.' });

        // Generate token and expiry
        const token = crypto.randomBytes(24).toString('hex');
        user.emailVerificationToken = token;
        user.emailVerificationTokenExpires = Date.now() + 24 * 3600 * 1000; // 24h
        await user.save();

        // Build verification URL that points to backend verify endpoint
        const backendBase = process.env.BACKEND_URL || (process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/$/, '') : null) || `http://localhost:${process.env.PORT || 8000}`;
        const clientRedirect = req.body?.redirectUrl || req.headers?.origin || '';
        const redirectParam = clientRedirect ? `&redirect=${encodeURIComponent(clientRedirect)}` : '';
        const verifyUrl = `${backendBase.replace(/\/$/, '')}/api/auth/verify-email?token=${encodeURIComponent(token)}${redirectParam}`;

        // Send email
        await emailService.sendVerificationEmail({ to: user.userEmail, verifyUrl, firstName: user.userFirstname });

        return res.status(200).json({ success: true, message: 'Email de vérification envoyé.' });
    } catch (error) {
        console.error('sendVerificationLink error:', error);
        return res.status(500).json({ message: 'Erreur lors de l envoi du lien de vérification.' });
    }
};

const verifyEmail = async (req, res) => {
    try {
        const { token, redirect } = req.query || {};
        let targetFrontend = redirect || process.env.FRONTEND_URL || 'http://localhost:5173';
        targetFrontend = targetFrontend.replace(/\/$/, '');

        if (!token) {
            return res.redirect(`${targetFrontend}/verification-success?error=${encodeURIComponent('Token requis')}`);
        }

        const User = require('../Models/User');
        const user = await User.findOne({ emailVerificationToken: String(token) });
        if (!user) {
            return res.redirect(`${targetFrontend}/verification-success?error=${encodeURIComponent('Token invalide ou introuvable')}`);
        }

        if (user.emailVerificationTokenExpires && user.emailVerificationTokenExpires < Date.now()) {
            user.emailVerificationToken = undefined;
            user.emailVerificationTokenExpires = undefined;
            await user.save();
            return res.redirect(`${targetFrontend}/verification-success?error=${encodeURIComponent('Token expiré. Veuillez demander un nouveau lien.')}`);
        }

        user.isVerified = true;
        user.emailVerificationToken = undefined;
        user.emailVerificationTokenExpires = undefined;
        await user.save();

        return res.redirect(`${targetFrontend}/verification-success?verified=1`);
    } catch (error) {
        console.error('verifyEmail error:', error);
        const targetFrontend = (req.query?.redirect || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
        return res.redirect(`${targetFrontend}/verification-success?error=${encodeURIComponent('Erreur serveur lors de la vérification.')}`);
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


const googleOAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL
);

const googleLogin = async (req, res) => {
    const isTokenFlow = req.method === 'POST' || Boolean(req.body?.token);

    if (isTokenFlow) {
        try {
            const { token } = req.body || {};

            if (!token) {
                return res.status(400).json({
                    message: 'Jeton Google manquant.'
                });
            }

            const googleUser = await verifyGoogleToken(token);
            const email = googleUser.userEmail.toLowerCase();

            let user = await User.findOne({
                googleId: googleUser.googleId
            });

            if (!user) {
                user = await User.findOne({
                    userEmail: email
                });
            }

            if (user) {
                user.googleId = googleUser.googleId;

                if (!user.authProviders.includes('google')) {
                    user.authProviders.push('google');
                }

                if (!user.profileImage && googleUser.profileImage) {
                    user.profileImage = googleUser.profileImage;
                }

                if (googleUser.emailVerified) {
                    user.isVerified = true;
                }

                user.updatedAt = new Date();
                await user.save();
            } else {
                user = new User({
                    userFirstname: googleUser.userFirstname || 'Utilisateur',
                    userSurname: googleUser.userSurname || '',
                    userEmail: email,
                    googleId: googleUser.googleId,
                    authProviders: ['google'],
                    profileImage: googleUser.profileImage || '',
                    isVerified: googleUser.emailVerified || false,
                    role: 'customer',
                    isVendor: false
                });

                await user.save();
            }

            const jwtToken = jwt.sign(
                {
                    userId: user._id,
                    role: user.role || 'customer'
                },
                process.env.JWT_SECRET,
                {
                    expiresIn: '24h'
                }
            );

            return res.status(200).json({
                message: 'Connexion Google réussie',
                token: jwtToken,
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

        } catch (error) {
            console.error('Erreur Google token login:', error);
            return res.status(401).json({
                message: 'Impossible de vérifier le compte Google.'
            });
        }
    }

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

    return res.redirect(authUrl);
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
        const userId = req.userId || req.user?.userId || req.user?.id;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({
                message: 'Utilisateur non trouvé'
            });
        }

        return res.status(200).json({
            user: {
                id: user._id,
                userId: user._id,
                userFirstname: user.userFirstname,
                userSurname: user.userSurname,
                userEmail: user.userEmail,
                userPhone: user.userPhone || '',
                profileImage: user.profileImage || '',
                role: user.role || 'customer',
                isVendor: user.isVendor || user.role === 'vendor',
                isVerified: Boolean(user.isVerified),
                vendorName: user.vendorName || '',
                balance: user.balance || 0,
                bankDetails: user.bankDetails || {}
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
    getCurrentUser,
    sendVerificationLink,
    verifyEmail
};