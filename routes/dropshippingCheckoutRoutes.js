const express = require('express');
const verifyToken = require('../Middlewares/verifyTokens');
const {
  createCheckoutQuote,
  getAvailableTransportOptions,
  validateDropshippingCheckoutPayload,
} = require('../services/dropshippingCheckoutService');

const router = express.Router();

function checkoutErrorMessage(error, fallback) {
  if ([
    'IMPORT_PRODUCT_MEASUREMENTS_REQUIRED',
    'LOCAL_DELIVERY_MEASUREMENTS_REQUIRED',
  ].includes(error.code)) {
    return 'Une erreur est survenue.';
  }
  return error.message || fallback;
}

router.post('/transport-options', verifyToken, async (req, res) => {
  try {
    const { items, countryCode } = req.body || {};
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ success: false, message: 'Panier dropshipping vide.' });
    }
    const data = await getAvailableTransportOptions({ items, countryCode });
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: checkoutErrorMessage(error, 'Impossible de charger les modes de transport.'),
    });
  }
});

router.post('/shipping-options', verifyToken, async (req, res) => {
  try {
    const { items, destination, transportMode } = req.body || {};
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ success: false, message: 'Panier dropshipping vide.' });
    }
    const data = await createCheckoutQuote({
      items,
      destination,
      transportMode,
      userId: req.user?.id || req.user?.userId,
    });
    return res.json({ success: true, data });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: checkoutErrorMessage(error, 'Impossible de calculer la livraison.'),
    });
  }
});

router.post('/validate', verifyToken, async (req, res) => {
  try {
    const {
      items,
      destination,
      shippingOptionId,
      shippingAddress,
      transportMode,
      quoteId,
      shippingCost,
    } = req.body || {};
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ success: false, message: 'Panier dropshipping vide.' });
    }
    if (!quoteId) {
      return res.status(400).json({ success: false, message: 'Devis de livraison manquant. Recalculez les frais avant la validation.' });
    }
    const result = await validateDropshippingCheckoutPayload({
      items,
      destination,
      shippingOptionId,
      shippingAddress,
      transportMode,
      quoteId,
      shippingCost,
      userId: req.user?.id || req.user?.userId,
    });
    return res.json({
      success: true,
      data: {
        subtotal: result.subtotal,
        shipping: result.shippingCost,
        total: result.total,
        currency: 'XOF',
        shippingOptionId: result.shippingOptionId,
        quoteId,
        estimatedDeliveryLabel: result.estimatedDeliveryLabel,
        productTotal: result.subtotal,
        importShippingCost: result.shippingCost,
        importBreakdown: result.quote?.importBreakdown || null,
      },
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: checkoutErrorMessage(error, 'Validation checkout impossible.'),
    });
  }
});

/** @deprecated Préférer POST /shipping-options */
router.post('/quote', verifyToken, async (req, res) => {
  try {
    const { items, destinationCountry, destinationCity, destinationDistrict, transportMode } = req.body || {};
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ success: false, message: 'Panier dropshipping vide.' });
    }
    const data = await createCheckoutQuote({
      items,
      destination: {
        country: destinationCountry,
        city: destinationCity,
        district: destinationDistrict,
      },
      transportMode,
      userId: req.user?.id || req.user?.userId,
    });
    return res.json({ success: true, data });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: checkoutErrorMessage(error, 'Impossible de calculer la livraison.'),
    });
  }
});

module.exports = router;
