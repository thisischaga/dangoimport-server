const express = require('express');

const router = express.Router();

const {
    login,
    signup,
    sendSignupOTP,
    googleLogin
} = require('../Controllers/usersControllers');


// Connexion classique
router.post('/login', login);

// Inscription classique
router.post('/signup', signup);

// Vérification email
router.post('/send-otp', sendSignupOTP);

// Connexion Google
router.post('/google', googleLogin);


module.exports = router;