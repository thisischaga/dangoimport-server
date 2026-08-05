const { FedaPay, Transaction: FedapayTransaction, Webhook } = require('fedapay');
const { configureFedapay } = require('../config/fedapay');

const ensureConfigured = () => {
  const boot = configureFedapay();
  if (!boot.ok) {
    throw new Error('FedaPay non configuré. Vérifiez FEDAPAY_SECRET_KEY et les variables d’environnement.');
  }
  return boot;
};

const createTransaction = async ({ description, amount, currency = 'XOF', callback_url, custom_metadata = {}, customer }) => {
  ensureConfigured();

  const transaction = await FedapayTransaction.create({
    description,
    amount,
    currency: { iso: currency },
    callback_url,
    custom_metadata,
    customer,
  });

  const token = await transaction.generateToken();
  return {
    transaction,
    transactionId: transaction.id,
    checkoutUrl: token.url,
    token: token.token,
  };
};

const retrieveTransaction = async (transactionId) => {
  ensureConfigured();
  return FedapayTransaction.retrieve(transactionId);
};

const verifyWebhookSignature = ({ payloadString, signature, secret }) => {
  if (!secret) {
    throw new Error('Clé de signature webhook FedaPay manquante.');
  }
  if (!signature) {
    throw new Error('Signature webhook FedaPay manquante.');
  }
  return Webhook.constructEvent(payloadString, signature, secret);
};

const getTransactionStatus = (entity = {}) => {
  const status = String(entity.status || '').toLowerCase();
  if (['approved', 'completed', 'paid', 'successful', 'success'].includes(status)) return 'approved';
  if (['canceled', 'cancelled', 'failed', 'rejected'].includes(status)) return 'failed';
  return 'pending';
};

module.exports = {
  ensureConfigured,
  createTransaction,
  retrieveTransaction,
  verifyWebhookSignature,
  getTransactionStatus,
};
