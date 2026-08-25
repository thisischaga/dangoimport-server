const express = require('express');

const router = express.Router();
const authMiddleware = require('../Middlewares/authMiddleware');

const {
    login,
    signup,
    sendSignupOTP,
    googleLogin,
    googleCallback,
    getCurrentUser
} = require('../Controllers/usersControllers');


console.log('GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? 'OK' : 'MANQUANT');

console.log(
    'GOOGLE_CLIENT_SECRET:',
    process.env.GOOGLE_CLIENT_SECRET ? 'OK' : 'MANQUANT'
);

console.log(
    'GOOGLE_CALLBACK_URL:',
    process.env.GOOGLE_CALLBACK_URL || 'MANQUANT'
);

// Auth classique
router.post('/login', login);

router.post('/signup', signup);

router.post('/send-otp', sendSignupOTP);


// =========================
// GOOGLE OAUTH
// =========================

router.get('/google', googleLogin);

router.get(
    '/google/callback',
    googleCallback
);

router.get(
    '/me',
    authMiddleware,
    getCurrentUser
);


module.exports = router;