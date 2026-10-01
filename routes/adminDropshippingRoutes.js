const express = require('express');
const verifyToken = require('../Middlewares/verifyTokens');
const { requireAdminFromDb } = require('../Middlewares/securityHelpers');
const dropshippingController = require('../Controllers/dropshippingController');

const router = express.Router();
const adminOnly = requireAdminFromDb;

router.use(verifyToken, adminOnly);

router.get('/', dropshippingController.list);
router.post('/preview-margin', dropshippingController.previewMargin);
router.get('/import-pricing', dropshippingController.getImportPricingConfig);
router.put('/import-pricing', dropshippingController.updateImportPricingConfig);
router.post('/import/csv', dropshippingController.importCsv);
router.post('/bulk-status', dropshippingController.bulkStatus);
router.post('/bulk-delete', dropshippingController.bulkDelete);
router.post('/bulk-translate', dropshippingController.bulkTranslate);
router.post('/translate-preview', dropshippingController.translatePreview);
router.post('/orders/:orderId/items/:itemIndex/supplier-order', dropshippingController.markSupplierOrdered);
router.post('/', dropshippingController.create);
router.get('/:id', dropshippingController.getById);
router.put('/:id', dropshippingController.update);
router.delete('/:id', dropshippingController.remove);
router.patch('/:id/status', dropshippingController.updateStatus);
router.post('/:id/sync', dropshippingController.syncProduct);
router.post('/:id/translate', dropshippingController.translateOne);

module.exports = router;
