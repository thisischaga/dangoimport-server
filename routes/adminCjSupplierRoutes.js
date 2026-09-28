const express = require('express');
const verifyToken = require('../Middlewares/verifyTokens');
const { requireAdminFromDb } = require('../Middlewares/securityHelpers');
const cjSupplierController = require('../Controllers/cjSupplierController');

const router = express.Router();

router.use(verifyToken, requireAdminFromDb);

router.get('/status', cjSupplierController.status);
router.post('/test', cjSupplierController.test);
router.get('/categories', cjSupplierController.getCategories);
router.post('/products/preview-pricing', cjSupplierController.previewProductPricing);
router.get('/products/:pid/import-status', cjSupplierController.getProductImportStatus);
router.get('/products/:pid', cjSupplierController.getProductDetail);
router.post('/products/:pid/import', cjSupplierController.importProduct);
router.post('/products/:pid/update', cjSupplierController.updateImportedProduct);
router.get('/products', cjSupplierController.searchProducts);
router.post('/import', cjSupplierController.importCatalog);
router.post('/import-selected', cjSupplierController.importSelected);
router.post('/sync', cjSupplierController.sync);
router.get('/sync-status', cjSupplierController.syncStatus);
router.get('/logs', cjSupplierController.logs);

module.exports = router;
