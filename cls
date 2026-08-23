[1mdiff --git a/routes/fedapayRoutes.js b/routes/fedapayRoutes.js[m
[1mindex e69de29..2f0f4d2 100644[m
[1m--- a/routes/fedapayRoutes.js[m
[1m+++ b/routes/fedapayRoutes.js[m
[36m@@ -0,0 +1,178 @@[m
[32m+[m[32mconst express = require('express');[m
[32m+[m[32mconst verifyToken = require('../Middlewares/verifyTokens');[m
[32m+[m[32mconst { configureFedapay } = require('../config/fedapay');[m
[32m+[m[32mconst { createTransaction, retrieveTransaction } = require('../services/fedapayService');[m
[32m+[m[32mconst { createLocalTransaction, findTransactionByProviderId, findTransactionById } = require('../services/paymentService');[m
[32m+[m[32mconst { handleWebhook } = require('../services/webhookService');[m
[32m+[m
[32m+[m[32mconst router = express.Router();[m
[32m+[m
[32m+[m[32mconst normalizePhoneNumber = (value) => {[m
[32m+[m[32m  const digits = String(value || '').replace(/\D/g, '');[m
[32m+[m[32m  const prefixes = ['229', '228', '225', '221', '226', '227', '223', '224', '220', '222', '230'];[m
[32m+[m[32m  for (const prefix of prefixes) {[m
[32m+[m[32m    if (digits.startsWith(prefix)) {[m
[32m+[m[32m      return digits.slice(prefix.length);[m
[32m+[m[32m    }[m
[32m+[m[32m  }[m
[32m+[m[32m  return digits;[m
[32m+[m[32m};[m
[32m+[m
[32m+[m[32mconst normalizeShippingCountry = (country) => {[m
[32m+[m[32m  const normalized = String(country || '').trim().toLowerCase();[m
[32m+[m[32m  if (['togo', 'tg'].includes(normalized)) return 'TG';[m
[32m+[m[32m  if (['benin', 'bj'].includes(normalized)) return 'BJ';[m
[32m+[m[32m  return 'BJ';[m
[32m+[m[32m};[m
[32m+[m
[32m+[m[32mrouter.post('/create', verifyToken, async (req, res) => {[m
[32m+[m[32m  const {[m
[32m+[m[32m    amount,[m
[32m+[m[32m    currency = 'XOF',[m
[32m+[m[32m    description,[m
[32m+[m[32m    callback_url,[m
[32m+[m[32m    customer,[m
[32m+[m[32m    userName,[m
[32m+[m[32m    userEmail,[m
[32m+[m[32m    userNumber,[m
[32m+[m[32m    shippingMethod,[m
[32m+[m[32m    shippingAddress,[m
[32m+[m[32m    items,[m
[32m+[m[32m    promoCode,[m
[32m+[m[32m    total,[m
[32m+[m[32m    custom_metadata = {},[m
[32m+[m[32m    deliveryCountry,[m
[32m+[m[32m  } = req.body;[m
[32m+[m
[32m+[m[32m  const customerPayload = customer || {[m
[32m+[m[32m    firstname: (userName || '').split(' ').slice(0, 1).join(' ') || 'Client',[m
[32m+[m[32m    lastname: (userName || '').split(' ').slice(1).join(' ') || 'Dango',[m
[32m+[m[32m    email: userEmail || '',[m
[32m+[m[32m    phone: userNumber || '',[m
[32m+[m[32m  };[m
[32m+[m
[32m+[m[32m  if (!amount || !customerPayload.email || !customerPayload.phone) {[m
[32m+[m[32m    return res.status(400).json({ message: 'Montant, email et téléphone requis pour le paiement.' });[m
[32m+[m[32m  }[m
[32m+[m
[32m+[m[32m  if (!process.env.FEDAPAY_SECRET_KEY) {[m
[32m+[m[32m    return res.status(503).json({ message: 'Paiement FedaPay non configuré.' });[m
[32m+[m[32m  }[m
[32m+[m
[32m+[m[32m  const fedapayConfig = configureFedapay();[m
[32m+[m[32m  if (!fedapayConfig.ok) {[m
[32m+[m[32m    return res.status(503).json({ message: 'Paiement FedaPay non configuré.' });[m
[32m+[m[32m  }[m
[32m+[m
[32m+[m[32m  try {[m
[32m+[m[32m    const phoneDigits = normalizePhoneNumber(customerPayload.phone);[m
[32m+[m[32m    const countryCode = normalizeShippingCountry(shippingAddress?.country || customerPayload.country || deliveryCountry || 'BJ');[m
[32m+[m
[32m+[m[32m    const transactionResponse = await createTransaction({[m
[32m+[m[32m      description: description || 'Paiement Dango Import',[m
[32m+[m[32m      amount: Math.round(Number(amount)),[m
[32m+[m[32m      currency: String(currency).toUpperCase(),[m
[32m+[m[32m      callback_url: callback_url || process.env.FEDAPAY_RETURN_URL || `${process.env.BASE_URL || 'https://www.dangoimport.com'}/checkout`,[m
[32m+[m[32m      custom_metadata: {[m
[32m+[m[32m        cartSource: 'frontend',[m
[32m+[m[32m        shippingMethod: shippingMethod || 'standard',[m
[32m+[m[32m        promoCode: promoCode || '',[m
[32m+[m[32m        orderType: custom_metadata.orderType || 'cart',[m
[32m+[m[32m        ...custom_metadata,[m
[32m+[m[32m      },[m
[32m+[m[32m      customer: {[m
[32m+[m[32m        firstname: customerPayload.firstname || 'Client',[m
[32m+[m[32m        lastname: customerPayload.lastname || 'Dango',[m
[32m+[m[32m        email: customerPayload.email,[m
[32m+[m[32m        phone_number: {[m
[32m+[m[32m          number: phoneDigits || '97000000',[m
[32m+[m[32m          country: countryCode,[m
[32m+[m[32m        },[m
[32m+[m[32m      },[m
[32m+[m[32m    });[m
[32m+[m
[32m+[m[32m    const localTransaction = await createLocalTransaction({[m
[32m+[m[32m      checkoutUrl: transactionResponse.checkoutUrl,[m
[32m+[m[32m      transactionId: transactionResponse.transactionId,[m
[32m+[m[32m      amount: Math.round(Number(amount)),[m
[32m+[m[32m      currency: String(currency).toUpperCase(),[m
[32m+[m[32m      user: {[m
[32m+[m[32m        firstname: customerPayload.firstname || 'Client',[m
[32m+[m[32m        lastname: customerPayload.lastname || 'Dango',[m
[32m+[m[32m        email: customerPayload.email,[m
[32m+[m[32m        phone_number: {[m
[32m+[m[32m          number: phoneDigits || '97000000',[m
[32m+[m[32m          country: countryCode,[m
[32m+[m[32m        },[m
[32m+[m[32m      },[m
[32m+[m[32m      metadata: {[m
[32m+[m[32m        userId: req.user?.id || null,[m
[32m+[m[32m        shippingMethod: shippingMethod || 'standard',[m
[32m+[m[32m        shippingAddress: shippingAddress || {},[m
[32m+[m[32m        items: Array.isArray(items) ? items : [],[m
[32m+[m[32m        total: Number(total || amount),[m
[32m+[m[32m        promoCode: promoCode || '',[m
[32m+[m[32m        deliveryCountry: deliveryCountry || null,[m
[32m+[m[32m        custom_metadata,[m
[32m+[m[32m      },[m
[32m+[m[32m      provider: 'fedapay',[m
[32m+[m[32m      orderId: custom_metadata?.orderId || null,[m
[32m+[m[32m    });[m
[32m+[m
[32m+[m[32m    return res.status(201).json({[m
[32m+[m[32m      success: true,[m
[32m+[m[32m      url: transactionResponse.checkoutUrl,[m
[32m+[m[32m      transactionId: transactionResponse.transactionId,[m
[32m+[m[32m      localTransactionId: localTransaction._id,[m
[32m+[m[32m    });[m
[32m+[m[32m  } catch (error) {[m
[32m+[m[32m    console.error('[fedapayRoutes] create payment error:', error);[m
[32m+[m[32m    return res.status(500).json({[m
[32m+[m[32m      message: 'Erreur lors de l’initialisation du paiement FedaPay.',[m
[32m+[m[32m      error: error.message,[m
[32m+[m[32m    });[m
[32m+[m[32m  }[m
[32m+[m[32m});[m
[32m+[m
[32m+[m[32mrouter.post('/webhook', async (req, res) => handleWebhook({ req, res }));[m
[32m+[m
[32m+[m[32mrouter.get('/verify/:transactionId', async (req, res) => {[m
[32m+[m[32m  try {[m
[32m+[m[32m    const transactionId = req.params.transactionId;[m
[32m+[m[32m    let transaction = await findTransactionByProviderId(transactionId);[m
[32m+[m[32m    if (!transaction && /^[0-9a-fA-F]{24}$/.test(transactionId)) {[m
[32m+[m[32m      transaction = await findTransactionById(transactionId);[m
[32m+[m[32m    }[m
[32m+[m[32m    if (!transaction) {[m
[32m+[m[32m      return res.status(404).json({ message: 'Transaction introuvable' });[m
[32m+[m[32m    }[m
[32m+[m
[32m+[m[32m    let externalTransaction = null;[m
[32m+[m[32m    try {[m
[32m+[m[32m      externalTransaction = await retrieveTransaction(transaction.transactionId);[m
[32m+[m[32m    } catch (err) {[m
[32m+[m[32m      console.warn('[fedapayRoutes] verify fetch remote transaction failed:', err.message);[m
[32m+[m[32m    }[m
[32m+[m
[32m+[m[32m    return res.json({[m
[32m+[m[32m      success: true,[m
[32m+[m[32m      data: {[m
[32m+[m[32m        local: transaction,[m
[32m+[m[32m        remote: externalTransaction,[m
[32m+[m[32m      },[m
[32m+[m[32m    });[m
[32m+[m[32m  } catch (error) {[m
[32m+[m[32m    console.error('[fedapayRoutes] verify transaction error:', error);[m
[32m+[m[32m    return res.status(500).json({ message: 'Erreur serveur', error: error.message });[m
[32m+[m[32m  }[m
[32m+[m[32m});[m
[32m+[m
[32m+[m[32m// IMPORTANT : on exporte le router LUI-MÊME (pas un objet {router, ...}),[m
[32m+[m[32m// pour que `const fedapayRouter = require('./routes/fedapayRoutes')` marche[m
[32m+[m[32m// directement quel que soit le style d'import utilisé dans server.js.[m
[32m+[m[32m// handleWebhook est attaché comme propriété du router (une fonction JS peut[m
[32m+[m[32m// porter des propriétés) pour rester accessible séparément si besoin :[m
[32m+[m[32m//   const fedapayRouter = require('./routes/fedapayRoutes');[m
[32m+[m[32m//   const fedapayWebhook = fedapayRouter.handleWebhook;[m
[32m+[m[32mrouter.handleWebhook = handleWebhook;[m
[32m+[m[32mmodule.exports = router;[m
\ No newline at end of file[m
