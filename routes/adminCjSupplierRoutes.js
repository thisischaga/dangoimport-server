const express = require('express');
const verifyToken = require('../Middlewares/verifyTokens');
const { requireAdminFromDb } = require('../Middlewares/securityHelpers');
const cjSupplierController = require('../Controllers/cjSupplierController');

const router = express.Router();

router.use(verifyToken, requireAdminFromDb);

router.get('/status', cjSupplierController.status);
router.post('/test', cjSupplierController.test);
router.get('/products', cjSupplierController.searchProducts);
router.post('/import', cjSupplierController.importCatalog);
router.post('/import-selected', cjSupplierController.importSelected);
router.post('/sync', cjSupplierController.sync);
router.get('/sync-status', cjSupplierController.syncStatus);
router.get('/logs', cjSupplierController.logs);

module.exports = router;
