const express = require('express');

const router = express.Router();

const {
    login,
    signup,
    sendSignupOTP,
    googleLogin
} = require('../Controllers/usersController');


router.post('/login', login);

router.post('/signup', signup);

router.post('/send-otp', sendSignupOTP);


// Google
router.post('/google', googleLogin);


module.exports = router;