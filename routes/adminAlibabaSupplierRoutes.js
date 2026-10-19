const express = require('express');
const verifyToken = require('../Middlewares/verifyTokens');
const { requireAdminFromDb } = require('../Middlewares/securityHelpers');
const alibabaSupplierController = require('../Controllers/alibabaSupplierController');

const router = express.Router();

router.get('/oauth/callback', alibabaSupplierController.oauthCallback);

router.use(verifyToken, requireAdminFromDb);

router.get('/oauth/start', alibabaSupplierController.oauthStart);
router.post('/oauth/exchange', alibabaSupplierController.oauthExchange);
router.get('/status', alibabaSupplierController.status);
router.post('/test', alibabaSupplierController.test);
router.post('/products/preview-pricing', alibabaSupplierController.previewProductPricing);
router.get('/products/:pid/import-status', alibabaSupplierController.getProductImportStatus);
router.get('/products/:pid', alibabaSupplierController.getProductDetail);
router.post('/products/:pid/import', alibabaSupplierController.importProduct);
router.get('/products', alibabaSupplierController.searchProducts);
router.post('/import-selected', alibabaSupplierController.importSelected);

module.exports = router;
