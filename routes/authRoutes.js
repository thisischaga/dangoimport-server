const express = require('express');

const router = express.Router();

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


module.exports = router;