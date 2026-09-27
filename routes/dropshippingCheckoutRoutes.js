const express = require('express');
const verifyToken = require('../Middlewares/verifyTokens');
const {
  getCjShippingOptions,
  validateDropshippingCheckoutPayload,
} = require('../services/dropshippingCheckoutService');

const router = express.Router();

router.post('/shipping-options', verifyToken, async (req, res) => {
  try {
    const { items, destination } = req.body || {};
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ success: false, message: 'Panier dropshipping vide.' });
    }
    const data = await getCjShippingOptions({ items, destination });
    return res.json({ success: true, data });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: error.message || 'Impossible de calculer la livraison.',
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
    } = req.body || {};
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ success: false, message: 'Panier dropshipping vide.' });
    }
    const result = await validateDropshippingCheckoutPayload({
      items,
      destination,
      shippingOptionId,
      shippingAddress,
    });
    return res.json({
      success: true,
      data: {
        subtotal: result.subtotal,
        shipping: result.shippingCost,
        total: result.total,
        currency: 'XOF',
        shippingOptionId: result.shippingOptionId,
        estimatedDeliveryLabel: result.estimatedDeliveryLabel,
      },
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: error.message || 'Validation checkout impossible.',
    });
  }
});

/** @deprecated Préférer POST /shipping-options */
router.post('/quote', verifyToken, async (req, res) => {
  try {
    const { items, destinationCountry, destinationCity } = req.body || {};
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ success: false, message: 'Panier dropshipping vide.' });
    }
    const data = await getCjShippingOptions({
      items,
      destination: {
        country: destinationCountry,
        city: destinationCity,
      },
    });
    return res.json({ success: true, data });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: error.message || 'Impossible de calculer la livraison.',
    });
  }
});

module.exports = router;
