const TransactionModel = require('../Models/Transaction');

const createLocalTransaction = async ({ checkoutUrl, transactionId, amount, currency, user, metadata, provider = 'fedapay', orderId = null }) => {
  return TransactionModel.create({
    checkoutUrl,
    transactionId,
    amount,
    currency,
    customer: user,
    metadata,
    provider,
    status: 'pending',
    orderId,
  });
};

const findTransactionByProviderId = async (transactionId) => {
  return TransactionModel.findOne({ transactionId: String(transactionId) });
};

const findTransactionById = async (id) => {
  const Transaction = await TransactionModel.findById(id);
  return Transaction;
};

const markTransactionFailed = async (transaction, reason) => {
  transaction.status = 'failed';
  transaction.webhookProcessed = true;
  transaction.metadata = { ...transaction.metadata, failureReason: reason };
  await transaction.save();
  return transaction;
};

const markTransactionApproved = async (transaction, orderId) => {
  transaction.status = 'approved';
  transaction.orderId = orderId;
  transaction.webhookProcessed = true;
  await transaction.save();
  return transaction;
};

module.exports = {
  createLocalTransaction,
  findTransactionByProviderId,
  findTransactionById,
  markTransactionFailed,
  markTransactionApproved,
};
