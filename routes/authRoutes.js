const express = require('express');
const userControllers = require ('../Controllers/usersControllers');

const router = express.Router();



router.post('/login',userControllers.login );
router.post('/signup', userControllers.signup);




module.exports = router;