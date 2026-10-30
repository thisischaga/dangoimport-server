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
router.get('/products/:pid/raw', alibabaSupplierController.getProductRaw);
router.get('/raw', alibabaSupplierController.getProductRaw);
router.get('/products/:pid/import-status', alibabaSupplierController.getProductImportStatus);
router.get('/products/:pid', alibabaSupplierController.getProductDetail);
router.post('/products/:pid/import', alibabaSupplierController.importProduct);
router.get('/products', alibabaSupplierController.searchProducts);
router.post('/import-selected', alibabaSupplierController.importSelected);

// Gestion avancée des produits Alibaba importés
router.get('/imported', alibabaSupplierController.getImportedProducts);
router.get('/imported/:id', alibabaSupplierController.getImportedProductById);
router.patch('/imported/:id', alibabaSupplierController.updateCommercialData);
router.post('/imported/:id/sync', alibabaSupplierController.syncImportedProduct);
router.post('/imported/:id/validate-quality', alibabaSupplierController.validateQuality);

module.exports = router;
