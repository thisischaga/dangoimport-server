const express = require('express');
const { authLoginLimiter, otpLimiter, passwordResetLimiter } = require('../Middlewares/rateLimiters');

const router = express.Router();

const {
  login,
  signup,
  sendSignupOTP,
  googleLogin,
} = require('../Controllers/usersControllers');
const verifyToken = require('../Middlewares/verifyTokens');
const { sendVerificationLink, verifyEmail, getCurrentUser, updateCurrentUser, exchangeOAuthCode } = require('../Controllers/usersControllers');


// Connexion classique
router.post('/login', authLoginLimiter, login);

// Profil utilisateur courant
router.get('/me', verifyToken, getCurrentUser);
router.patch('/me', verifyToken, updateCurrentUser);

// Inscription classique
router.post('/signup', authLoginLimiter, signup);

// Vérification email
router.post('/send-otp', otpLimiter, sendSignupOTP);

// Send verification link (authenticated preferred)
router.post('/send-verification-link', passwordResetLimiter, verifyToken, sendVerificationLink);

// Verify token via link
router.get('/verify-email', verifyEmail);

// Échange code OAuth éphémère → JWT
router.post('/oauth-exchange', authLoginLimiter, exchangeOAuthCode);

// Connexion Google
router.get('/google', authLoginLimiter, googleLogin);
router.post('/google', authLoginLimiter, googleLogin);


module.exports = router;