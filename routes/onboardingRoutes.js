const express = require('express');
const router = express.Router();
const verifyToken = require('../Middlewares/verifyTokens');
const onboardingController = require('../Controllers/onboardingController');

// Get onboarding status (store + user)
router.get('/status', verifyToken, onboardingController.getOnboardingStatus);

// Step 1: profile
router.post('/profile', verifyToken, onboardingController.saveProfile);

// Step 2: store info
router.post('/store', verifyToken, onboardingController.saveStore);

// Step 3: delivery config
router.post('/delivery', verifyToken, onboardingController.saveDeliveryConfig);

module.exports = router;
