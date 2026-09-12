const express = require('express');

const router = express.Router();

const {
    login,
    signup,
    sendSignupOTP,
    googleLogin
} = require('../Controllers/usersControllers');
const verifyToken = require('../Middlewares/verifyTokens');
const { sendVerificationLink, verifyEmail, getCurrentUser, updateCurrentUser } = require('../Controllers/usersControllers');


// Connexion classique
router.post('/login', login);

// Profil utilisateur courant
router.get('/me', verifyToken, getCurrentUser);
router.patch('/me', verifyToken, updateCurrentUser);

// Inscription classique
router.post('/signup', signup);

// Vérification email
router.post('/send-otp', sendSignupOTP);

// Send verification link (authenticated preferred)
router.post('/send-verification-link', verifyToken, sendVerificationLink);

// Verify token via link
router.get('/verify-email', verifyEmail);

// Connexion Google
router.get('/google', googleLogin);
router.post('/google', googleLogin);


module.exports = router;