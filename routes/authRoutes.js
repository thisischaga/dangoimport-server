const express = require('express');

const router = express.Router();
const authMiddleware = require('../Middleware/authMiddleware');

const {
    login,
    signup,
    sendSignupOTP,
    googleLogin,
    googleCallback
} = require('../Controllers/authController');


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