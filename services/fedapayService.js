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
  const allowUnsignedWebhook = process.env.NODE_ENV !== 'production' || !secret;

  if (!secret) {
    if (allowUnsignedWebhook) return true;
    throw new Error('Clé de signature webhook FedaPay manquante.');
  }

  if (!signature) {
    if (allowUnsignedWebhook) return true;
    throw new Error('Signature webhook FedaPay manquante.');
  }

  return Webhook.constructEvent(payloadString, signature, secret);
};

const FEDAPAY_MM_MODES = new Set([
  'mtn',
  'moov',
  'moov_tg',
  'togocel',
  'celtiis',
  'bestcash',
  'coris',
]);

function normalizeFedapayNetwork(network, countryCode = 'BJ') {
  const raw = String(network || '').trim().toLowerCase();
  const country = String(countryCode || 'BJ').trim().toUpperCase();
  if (raw === 'moov' && country === 'TG') return 'moov_tg';
  if (raw === 't-money' || raw === 'tmoney') return 'togocel';
  if (FEDAPAY_MM_MODES.has(raw)) return raw;
  return '';
}

async function sendMobileMoneyPush(transaction, { network, phone, countryCode } = {}) {
  if (!transaction || typeof transaction.sendNow !== 'function') {
    throw new Error('Transaction FedaPay invalide pour le Mobile Money.');
  }
  const mode = normalizeFedapayNetwork(network, countryCode);
  const number = String(phone || '').replace(/\D/g, '').slice(-8);
  if (!mode) {
    throw new Error('Choisissez un opérateur Mobile Money (MTN, Moov, T-Money…).');
  }
  if (number.length < 8) {
    throw new Error('Numéro Mobile Money invalide.');
  }
  return transaction.sendNow(mode, {
    phone_number: {
      number,
      country: String(countryCode || 'BJ').slice(0, 2).toLowerCase(),
    },
  });
}

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
  normalizeFedapayNetwork,
  sendMobileMoneyPush,
};
