const crypto = require('crypto');
const { Webhook } = require('fedapay');
const WebhookLog = require('../Models/WebhookLog');
const { verifyWebhookSignature, getTransactionStatus } = require('./fedapayService');
const { findTransactionByProviderId, markTransactionFailed } = require('./paymentService');
const { createOrderFromTransaction, decrementStockForOrder, recordOrderHistory } = require('./orderService');
const { createQRCodesForOrder } = require('./qrCodeService');
const { sendNotification } = require('../utils/socket');
const emailService = require('../utils/emailService');
const Cart = require('../Models/Cart');
const ShopOrder = require('../Models/ShopOrder');
const TransactionModel = require('../Models/Transaction');
const { timingSafeEqual } = require('../Middlewares/securityHelpers');
const { alertIntrusion } = require('../utils/securityAlerts');

const logWebhookEvent = async ({ eventId, payload, signature, status, error }) => {
  return WebhookLog.create({ eventId, provider: 'fedapay', payload, signature, status, error });
};

const verifyFedapayWebhookSignature = async ({ req, payloadString, signature, secret, eventId, event }) => {
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && !secret) {
    await logWebhookEvent({
      eventId,
      payload: event,
      signature,
      status: 'failed',
      error: 'FEDAPAY_WEBHOOK_SECRET manquant en production',
    });
    const error = new Error('Webhook non configuré');
    error.statusCode = 503;
    throw error;
  }

  if (!secret || !signature) {
    if (isProduction) {
      await logWebhookEvent({
        eventId,
        payload: event,
        signature,
        status: 'failed',
        error: 'Signature webhook FedaPay manquante en production',
      });
      await alertIntrusion(req, 'Webhook FedaPay — signature manquante', {
        route: 'paymentRoutes/webhook',
      });
      const error = new Error('Signature webhook manquante');
      error.statusCode = 403;
      throw error;
    }

    console.warn('[webhookService] webhook non signé autorisé uniquement hors production', {
      eventId,
      signaturePresent: Boolean(signature),
      secretConfigured: Boolean(secret),
    });
    return;
  }

  let verified = false;
  try {
    Webhook.constructEvent(payloadString, signature, secret);
    verified = true;
  } catch (sdkErr) {
    console.warn('[webhookService] SDK signature validation failed, attempting HMAC fallback', {
      message: sdkErr.message,
    });
  }

  if (!verified) {
    try {
      verifyWebhookSignature({ payloadString, signature, secret });
      verified = true;
    } catch (hmacErr) {
      const expected = crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
      const raw = String(signature || '').trim();
      const normalized = raw.startsWith('sha256=') ? raw.slice(7) : raw;
      verified = timingSafeEqual(normalized, expected)
        || timingSafeEqual(raw, expected)
        || timingSafeEqual(raw, `sha256=${expected}`);
    }
  }

  if (!verified) {
    await logWebhookEvent({
      eventId,
      payload: event,
      signature,
      status: 'failed',
      error: 'Signature webhook FedaPay invalide',
    });
    await alertIntrusion(req, 'Webhook FedaPay — signature invalide', {
      route: 'paymentRoutes/webhook',
    });
    const error = new Error('Signature invalide');
    error.statusCode = 403;
    throw error;
  }
};

const handleWebhook = async ({ req, res }) => {
  const signature = req.headers['x-fedapay-signature']
    || req.headers['fedapay-signature']
    || req.headers['signature']
    || req.headers['x-signature']
    || null;
  const secret = process.env.FEDAPAY_WEBHOOK_SECRET;
  const payloadString = req.rawBody || JSON.stringify(req.body);
  const event = req.body;
  const eventId = event?.id || event?.event_id || crypto.createHash('sha256').update(payloadString).digest('hex');

  try {
    await verifyFedapayWebhookSignature({ req, payloadString, signature, secret, eventId, event });
  } catch (error) {
    const status = error.statusCode || 403;
    if (status === 403) {
      return res.status(403).send('Signature invalide');
    }
    return res.status(status).send('Webhook non configuré');
  }

  const existingWebhook = await WebhookLog.findOne({ eventId });
  if (existingWebhook) {
    existingWebhook.status = 'duplicate';
    await existingWebhook.save();
    return res.status(200).send('Duplicate webhook ignored');
  }

  const webhookLog = await logWebhookEvent({ eventId, payload: event, signature, status: 'received' });
  const transactionId = event?.entity?.id;
  if (!transactionId) {
    webhookLog.status = 'failed';
    webhookLog.error = 'Transaction ID absent dans le payload';
    await webhookLog.save();
    return res.status(400).send('Transaction ID absent');
  }

  const localTransaction = await findTransactionByProviderId(transactionId);
  if (!localTransaction) {
    webhookLog.status = 'failed';
    webhookLog.error = 'Transaction locale introuvable';
    await webhookLog.save();
    return res.status(404).send('Transaction introuvable');
  }

  if (localTransaction.webhookProcessed) {
    webhookLog.status = 'duplicate';
    await webhookLog.save();
    return res.status(200).send('Webhook déjà traité');
  }

  const entityStatus = getTransactionStatus(event?.entity);
  if (entityStatus === 'approved') {
    const session = await TransactionModel.startSession();
    session.startTransaction();
    try {
      const actualAmount = Number(event.entity.amount || 0);
      const actualCurrency = event.entity.currency?.iso || localTransaction.currency;

      if (actualAmount !== Number(localTransaction.amount) || actualCurrency !== localTransaction.currency) {
        throw new Error(`Montant ou devise incohérents (${actualAmount} ${actualCurrency}) attendu ${localTransaction.amount} ${localTransaction.currency}`);
      }

      const createdOrder = await createOrderFromTransaction({ transaction: localTransaction, session });
      const qrDocs = await createQRCodesForOrder({ order: createdOrder, transactionId, session });
      await decrementStockForOrder({ order: createdOrder, session });
      await TransactionModel.findByIdAndUpdate(localTransaction._id, { status: 'approved', orderId: createdOrder._id, webhookProcessed: true }, { session });
      await ShopOrder.findByIdAndUpdate(createdOrder._id, { qrCodeIds: qrDocs.map((q) => q._id) }, { session });

      await Cart.findOneAndUpdate({ userId: localTransaction.metadata.userId }, { items: [], totalItems: 0, totalPrice: 0 }, { session });

      await recordOrderHistory({ orderId: createdOrder._id, event: 'payment_confirmed', details: { transactionId, provider: 'FedaPay', amount: actualAmount }, session });

      if (createdOrder.customerId) {
        await sendNotification({ recipient: createdOrder.customerId.toString(), type: 'order', title: 'Paiement confirmé', message: `Votre commande ${createdOrder.orderNumber} a été confirmée.`, link: `/mes-commandes/${createdOrder._id}` });
      }

      const vendorIds = [...new Set(createdOrder.items.filter((item) => item.vendorId).map((item) => item.vendorId.toString()))];
      for (const vendorId of vendorIds) {
        await sendNotification({ recipient: vendorId, type: 'order', title: 'Nouvelle commande', message: `Une commande (${createdOrder.orderNumber}) a été payée.`, link: `/vendor/commandes/${createdOrder._id}` });
      }

      await emailService.sendOrderConfirmedEmail({
        customerEmail: createdOrder.customerEmail,
        customerName: createdOrder.customerName,
        orderNumber: createdOrder.orderNumber,
        total: createdOrder.total,
        qrCode: qrDocs[0]?.code,
        items: createdOrder.items,
        qrCodes: qrDocs,
      });
      await webhookLog.save({ session });
      await session.commitTransaction();
      session.endSession();
      return res.status(200).send('Webhook traité avec succès');
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      webhookLog.status = 'failed';
      webhookLog.error = error.message;
      await webhookLog.save();
      await markTransactionFailed(localTransaction, error.message);
      return res.status(500).send('Erreur interne pendant le traitement du webhook');
    }
  }

  if (entityStatus === 'failed') {
    await markTransactionFailed(localTransaction, 'Transaction annulée ou échouée');
    webhookLog.status = 'processed';
    await webhookLog.save();
    return res.status(200).send('Transaction échouée');
  }

  webhookLog.status = 'processed';
  await webhookLog.save();
  return res.status(200).send('Événement ignoré');
};

module.exports = {
  handleWebhook,
};
