const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const User = require('../Models/User');
const { OAuth2Client } = require('google-auth-library');

dotenv.config();

const googleClient = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID
);

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

const googleLogin = async (req, res) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({
                message: 'Token Google manquant'
            });
        }

        const ticket = await googleClient.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID
        });

        const payload = ticket.getPayload();

        const {
            sub: googleId,
            email,
            given_name,
            family_name,
            name,
            picture,
            email_verified
        } = payload;

        if (!email || !email_verified) {
            return res.status(401).json({
                message: 'Compte Google non vérifié'
            });
        }

        let user = await User.findOne({
            userEmail: email.toLowerCase()
        });

        if (!user) {

            const randomPassword = await bcrypt.hash(
                `${googleId}-${Date.now()}-${Math.random()}`,
                10
            );

            user = new User({
                userFirstname: given_name || name?.split(' ')[0] || 'Utilisateur',

                userSurname:
                    family_name ||
                    name?.split(' ').slice(1).join(' ') ||
                    '',

                userEmail: email.toLowerCase(),

                userPassword: randomPassword,

                profileImage: picture || '',

                isVerified: true,

                role: 'customer',

                isVendor: false
            });

            await user.save();

            console.log(
                `Compte Google créé : ${user.userEmail}`
            );

        } else {

            // Si l'utilisateur avait déjà un compte classique,
            // Google peut maintenant être utilisé pour se connecter.
            if (!user.isVerified) {
                user.isVerified = true;
                await user.save();
            }
        }

        const authToken = generateToken(user);

        return res.status(200).json({
            message: 'Connexion Google réussie',

            token: authToken,

            user: {
                id: user._id,
                userId: user._id,

                userFirstname: user.userFirstname,
                userSurname: user.userSurname,

                userEmail: user.userEmail,

                userPhone: user.userPhone || '',

                profileImage: user.profileImage || '',

                role: user.role || 'customer',

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
                "Échec de l'authentification avec Google"
        });
    }
};