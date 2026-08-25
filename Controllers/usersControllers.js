const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const { OAuth2Client } = require('google-auth-library');

const User = require('../Models/User');

dotenv.config();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

/**
 * Génère le JWT DangoImport
 */
const generateToken = (user) => {
    return jwt.sign(
        {
            userId: user._id,
            role: user.role || 'customer'
        },
        process.env.JWT_SECRET,
        {
            expiresIn: '24h'
        }
    );
};

/**
 * Connexion / inscription avec Google
 *
 * Le frontend envoie :
 * {
 *   token: response.credential
 * }
 */
const googleLogin = async (req, res) => {
    try {

        const { token } = req.body;

        // -------------------------------------------------
        // Vérification du token reçu
        // -------------------------------------------------

        if (!token) {
            return res.status(400).json({
                message: 'Token Google manquant.'
            });
        }

        if (!GOOGLE_CLIENT_ID) {
            console.error(
                'GOOGLE_CLIENT_ID est manquant dans les variables Render.'
            );

            return res.status(500).json({
                message: 'Configuration Google du serveur manquante.'
            });
        }

        // -------------------------------------------------
        // Vérification auprès de Google
        // -------------------------------------------------

        const ticket = await googleClient.verifyIdToken({
            idToken: token,
            audience: GOOGLE_CLIENT_ID
        });

        const payload = ticket.getPayload();

        if (!payload) {
            return res.status(401).json({
                message: 'Informations Google invalides.'
            });
        }

        const {
            sub: googleId,
            email,
            given_name,
            family_name,
            name,
            picture,
            email_verified
        } = payload;

        // -------------------------------------------------
        // Vérification du compte Google
        // -------------------------------------------------

        if (!email) {
            return res.status(401).json({
                message: 'Google n’a fourni aucune adresse email.'
            });
        }

        if (!email_verified) {
            return res.status(401).json({
                message: 'Votre adresse email Google n’est pas vérifiée.'
            });
        }

        const normalizedEmail = email.toLowerCase().trim();

        // -------------------------------------------------
        // Recherche de l'utilisateur
        // -------------------------------------------------

        let user = await User.findOne({
            userEmail: normalizedEmail
        });

        // -------------------------------------------------
        // Création du compte si inexistant
        // -------------------------------------------------

        if (!user) {

            const randomPassword = await bcrypt.hash(
                `${googleId}-${Date.now()}-${Math.random()}`,
                10
            );

            const firstname =
                given_name ||
                name?.split(' ')[0] ||
                'Utilisateur';

            const surname =
                family_name ||
                name?.split(' ').slice(1).join(' ') ||
                '';

            user = new User({
                userFirstname: firstname,
                userSurname: surname,
                userEmail: normalizedEmail,
                userPassword: randomPassword,
                profileImage: picture || '',
                isVerified: true,
                role: 'customer',
                isVendor: false
            });

            await user.save();

            console.log(
                `Compte Google créé : ${normalizedEmail}`
            );

        } else {

            // -------------------------------------------------
            // Compte existant
            // -------------------------------------------------

            if (!user.isVerified) {

                user.isVerified = true;

                await user.save();
            }

        }

        // -------------------------------------------------
        // Génération du JWT DangoImport
        // -------------------------------------------------

        const authToken = generateToken(user);

        // -------------------------------------------------
        // Réponse frontend
        // -------------------------------------------------

        return res.status(200).json({

            message: 'Connexion Google réussie',

            token: authToken,

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
            'Google authentication error:',
            error
        );

        return res.status(401).json({
            message:
                "Échec de l'authentification avec Google."
        });
    }
};

module.exports = {
    googleLogin,
    generateToken
};