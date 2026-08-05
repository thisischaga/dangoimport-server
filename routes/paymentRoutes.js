const express = require('express');
const verifyToken = require('../Middlewares/verifyTokens');
const { configureFedapay } = require('../config/fedapay');
const { createTransaction, retrieveTransaction } = require('../services/fedapayService');
const { createLocalTransaction, findTransactionByProviderId, findTransactionById } = require('../services/paymentService');
const { handleWebhook } = require('../services/webhookService');

const router = express.Router();

const normalizePhoneNumber = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  const prefixes = ['229', '228', '225', '221', '226', '227', '223', '224', '220', '222', '230'];
  for (const prefix of prefixes) {
    if (digits.startsWith(prefix)) {
      return digits.slice(prefix.length);
    }
  }
  return digits;
};

const normalizeShippingCountry = (country) => {
  const normalized = String(country || '').trim().toLowerCase();
  if (['togo', 'tg'].includes(normalized)) return 'TG';
  if (['benin', 'bj'].includes(normalized)) return 'BJ';
  return 'BJ';
};

router.post('/create', verifyToken, async (req, res) => {
  const {
    amount,
    currency = 'XOF',
    description,
    callback_url,
    customer,
    userName,
    userEmail,
    userNumber,
    shippingMethod,
    shippingAddress,
    items,
    promoCode,
    total,
    custom_metadata = {},
    deliveryCountry,
  } = req.body;

  const customerPayload = customer || {
    firstname: (userName || '').split(' ').slice(0, 1).join(' ') || 'Client',
    lastname: (userName || '').split(' ').slice(1).join(' ') || 'Dango',
    email: userEmail || '',
    phone: userNumber || '',
  };

  if (!amount || !customerPayload.email || !customerPayload.phone) {
    return res.status(400).json({ message: 'Montant, email et téléphone requis pour le paiement.' });
  }

  if (!process.env.FEDAPAY_SECRET_KEY) {
    return res.status(503).json({ message: 'Paiement FedaPay non configuré.' });
  }

  const fedapayConfig = configureFedapay();
  if (!fedapayConfig.ok) {
    return res.status(503).json({ message: 'Paiement FedaPay non configuré.' });
  }

  try {
    const phoneDigits = normalizePhoneNumber(customerPayload.phone);
    const countryCode = normalizeShippingCountry(shippingAddress?.country || customerPayload.country || deliveryCountry || 'BJ');

    const transactionResponse = await createTransaction({
      description: description || 'Paiement Dango Import',
      amount: Math.round(Number(amount)),
      currency: String(currency).toUpperCase(),
      callback_url: callback_url || process.env.FEDAPAY_RETURN_URL || `${process.env.BASE_URL || 'https://www.dangoimport.com'}/checkout`,
      custom_metadata: {
        cartSource: 'frontend',
        shippingMethod: shippingMethod || 'standard',
        promoCode: promoCode || '',
        orderType: custom_metadata.orderType || 'cart',
        ...custom_metadata,
      },
      customer: {
        firstname: customerPayload.firstname || 'Client',
        lastname: customerPayload.lastname || 'Dango',
        email: customerPayload.email,
        phone_number: {
          number: phoneDigits || '97000000',
          country: countryCode,
        },
      },
    });

    const localTransaction = await createLocalTransaction({
      checkoutUrl: transactionResponse.checkoutUrl,
      transactionId: transactionResponse.transactionId,
      amount: Math.round(Number(amount)),
      currency: String(currency).toUpperCase(),
      user: {
        firstname: customerPayload.firstname || 'Client',
        lastname: customerPayload.lastname || 'Dango',
        email: customerPayload.email,
        phone_number: {
          number: phoneDigits || '97000000',
          country: countryCode,
        },
      },
      metadata: {
        userId: req.user?.id || null,
        shippingMethod: shippingMethod || 'standard',
        shippingAddress: shippingAddress || {},
        items: Array.isArray(items) ? items : [],
        total: Number(total || amount),
        promoCode: promoCode || '',
        deliveryCountry: deliveryCountry || null,
        custom_metadata,
      },
      provider: 'fedapay',
      orderId: custom_metadata?.orderId || null,
    });

    return res.status(201).json({
      success: true,
      url: transactionResponse.checkoutUrl,
      transactionId: transactionResponse.transactionId,
      localTransactionId: localTransaction._id,
    });
  } catch (error) {
    console.error('[paymentRoutes] create payment error:', error);
    return res.status(500).json({
      message: 'Erreur lors de l’initialisation du paiement FedaPay.',
      error: error.message,
    });
  }
});

router.post('/webhook', async (req, res) => handleWebhook({ req, res }));

router.get('/verify/:transactionId', async (req, res) => {
  try {
    const transactionId = req.params.transactionId;
    let transaction = await findTransactionByProviderId(transactionId);
    if (!transaction && /^[0-9a-fA-F]{24}$/.test(transactionId)) {
      transaction = await findTransactionById(transactionId);
    }
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction introuvable' });
    }

    let externalTransaction = null;
    try {
      externalTransaction = await retrieveTransaction(transaction.transactionId);
    } catch (err) {
      console.warn('[paymentRoutes] verify fetch remote transaction failed:', err.message);
    }

    return res.json({
      success: true,
      data: {
        local: transaction,
        remote: externalTransaction,
      },
    });
  } catch (error) {
    console.error('[paymentRoutes] verify transaction error:', error);
    return res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
});

module.exports = router;
