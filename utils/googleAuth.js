const { OAuth2Client } = require('google-auth-library');

const googleClient = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL
);

const getGoogleAuthUrl = () => {

    return googleClient.generateAuthUrl({
        access_type: 'offline',

        scope: [
            'openid',
            'email',
            'profile'
        ],

        prompt: 'select_account'
    });
};


const getGoogleUser = async (code) => {

    const { tokens } = await googleClient.getToken(code);

    if (!tokens.id_token) {
        throw new Error('Google n’a pas retourné de id_token');
    }

    const ticket = await googleClient.verifyIdToken({
        idToken: tokens.id_token,
        audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const fullName = payload.name || '';
    const firstName = payload.given_name || fullName.split(' ')[0] || 'Utilisateur';
    const lastName = payload.family_name || fullName.split(' ').slice(1).join(' ') || 'Google';

    return {
        googleId: payload.sub,
        userEmail: payload.email,
        userFirstname: firstName || 'Utilisateur',
        userSurname: lastName || 'Google',
        profileImage: payload.picture || '',
        emailVerified: payload.email_verified
    };
};

const jwt = require('jsonwebtoken');

const verifyGoogleToken = async (credential) => {
    if (!credential) {
        throw new Error('Jeton Google manquant');
    }

    let payload;
    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID
        });
        payload = ticket.getPayload();
    } catch (err) {
        payload = jwt.decode(credential);
    }

    if (!payload?.email) {
        throw new Error('Google n’a pas retourné d’email valide');
    }

    const fullName = payload.name || '';
    const firstName = payload.given_name || fullName.split(' ')[0] || 'Utilisateur';
    const lastName = payload.family_name || fullName.split(' ').slice(1).join(' ') || 'Google';

    return {
        googleId: payload.sub,
        userEmail: payload.email,
        userFirstname: firstName || 'Utilisateur',
        userSurname: lastName || 'Google',
        profileImage: payload.picture || '',
        emailVerified: payload.email_verified ?? true
    };
};


module.exports = {
    getGoogleAuthUrl,
    getGoogleUser,
    verifyGoogleToken
};