const express = require('express');
const verifyToken = require('../Middlewares/verifyTokens');
const { paymentLimiter } = require('../Middlewares/rateLimiters');
const { retrieveTransaction } = require('../services/fedapayService');
const { findTransactionByProviderId, findTransactionById } = require('../services/paymentService');
const { handleWebhook } = require('../services/webhookService');
const { sendServerError } = require('../utils/apiError');

const router = express.Router();

router.post('/create', paymentLimiter, verifyToken, async (req, res) => {
  return res.status(410).json({
    message: 'Paiement libre désactivé. Utilisez le checkout marketplace (/api/fedapay/checkout).',
  });
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
    return sendServerError(res, error, 'Erreur serveur');
  }
});

module.exports = router;
