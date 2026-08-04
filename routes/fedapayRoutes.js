const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { FedaPay, Transaction: FedapayTransaction } = require('fedapay');
const { configureFedapay } = require('../config/fedapay');
const TransactionModel = require('../Models/Transaction');
const ShopOrder = require('../Models/ShopOrder');
const Payment = require('../Models/Payment');
const QRCode = require('../Models/QRCode');
const WebhookLog = require('../Models/WebhookLog');
const OrderHistory = require('../Models/OrderHistory');
const Cart = require('../Models/Cart');
const Product = require('../Models/Product');
const User = require('../Models/User');
const Notification = require('../Models/Notification');
const emailService = require('../utils/emailService');
const { sendNotification } = require('../utils/socket');

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

const generateOrderNumber = () => {
  const timestamp = Date.now().toString();
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `DI-${random}-${timestamp.slice(-8)}`;
};

const createLocalTransaction = async ({ checkoutUrl, transactionId, amount, currency, user, metadata, provider = 'fedapay' }) => {
  return TransactionModel.create({
    checkoutUrl,
    transactionId,
    amount,
    currency,
    customer: user,
    metadata,
    provider,
    status: 'pending',
  });
};

const logWebhookEvent = async ({ eventId, payload, signature, status, error }) => {
  return WebhookLog.create({
    eventId,
    payload,
    signature,
    status,
    error,
  });
};

const orderDeliveryDate = (shippingMethod) => {
  const date = new Date();
  if (shippingMethod === 'express') date.setDate(date.getDate() + 2);
  else if (shippingMethod === 'pickup') date.setDate(date.getDate() + 1);
  else date.setDate(date.getDate() + 5);
  return date;
};

const buildOrder = ({ userId, customer, shippingAddress, items, subtotal, shippingCost, tax, discount, total, shippingMethod }) => ({
  orderNumber: generateOrderNumber(),
  customerId: mongoose.Types.ObjectId(userId),
  customerName: `${customer.firstname || 'Client'} ${customer.lastname || ''}`.trim(),
  customerEmail: customer.email,
  customerPhone: customer.phone_number?.number || '',
  shippingAddress,
  items,
  subtotal,
  shippingCost,
  tax,
  discount,
  total,
  shippingMethod,
  estimatedDelivery: orderDeliveryDate(shippingMethod),
  status: 'confirmed',
  paymentStatus: 'completed',
  paymentMethod: 'FedaPay',
  paymentDate: new Date(),
  history: ['Order created after payment confirmed'],
});

const createOrderFromTransaction = async ({ transaction, session }) => {
  const metadata = transaction.metadata || {};
  const userId = metadata.userId;
  const customer = transaction.customer;
  const shippingAddress = metadata.shippingAddress || {};
  const items = metadata.items || [];
  const subtotal = metadata.subtotal || transaction.amount;
  const shippingCost = metadata.shippingCost || 0;
  const tax = metadata.tax || 0;
  const discount = metadata.discount || 0;
  const total = metadata.total || transaction.amount;
  const shippingMethod = metadata.shippingMethod || 'standard';

  const orderItems = [];
  for (const item of items) {
    const product = await Product.findById(item.productId).session(session);
    if (!product) {
      throw new Error(`Produit introuvable : ${item.productId}`);
    }
    if (product.stock < item.quantity) {
      throw new Error(`Stock insuffisant pour le produit ${product.name}`);
    }
    orderItems.push({
      productId: product._id,
      productName: product.name,
      productImage: product.images?.[0]?.url || product.image || '',
      vendorId: product.vendorId,
      vendorName: product.vendorName || 'Vendeur Indépendant',
      price: product.salePrice || product.price,
      originalPrice: product.price,
      salePrice: product.salePrice || 0,
      category: product.category,
      quantity: item.quantity,
      selectedOptions: item.selectedOptions || {},
      subtotal: item.subtotal || (product.salePrice || product.price) * item.quantity,
      delivered: false,
    });
  }

  const orderPayload = buildOrder({
    userId,
    customer,
    shippingAddress,
    items: orderItems,
    subtotal,
    shippingCost,
    tax,
    discount,
    total,
    shippingMethod,
  });

  const order = await ShopOrder.create([orderPayload], { session });
  return order[0];
};

const createPaymentRecord = async ({ orderId, transaction }) => {
  return Payment.create({
    orderId,
    transactionId: transaction.transactionId,
    amount: transaction.amount,
    currency: transaction.currency,
    status: 'approved',
    paymentMethod: 'FedaPay',
    metadata: transaction.metadata || {},
  });
};

const createQRCodeRecord = async ({ orderId, transactionId }) => {
  const code = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return QRCode.create({
    code,
    orderId,
    transactionId,
    vendorId: null,
    status: 'active',
    expiresAt,
  });
};

const notifyCustomerAndVendors = async ({ order, qrCode }) => {
  if (order.customerId) {
    await sendNotification({
      recipient: order.customerId.toString(),
      type: 'order',
      title: 'Paiement confirmé',
      message: `Votre commande ${order.orderNumber} a été confirmée et votre QR Code est disponible.`,
      link: `/mes-commandes/${order._id}`,
    });
  }

  const vendorIds = [...new Set(order.items.filter((item) => item.vendorId).map((item) => item.vendorId.toString()))];
  for (const vendorId of vendorIds) {
    await sendNotification({
      recipient: vendorId,
      type: 'order',
      title: 'Nouvelle commande à préparer',
      message: `Une commande (${order.orderNumber}) contenant vos produits a été payée.`,
      link: `/vendor/commandes/${order._id}`,
    });
  }
};

router.post('/checkout', async (req, res) => {
  const fedapayConfig = configureFedapay();
  if (!fedapayConfig.ok) {
    return res.status(503).json({ message: 'Paiement FedaPay non configuré.' });
  }

  const {
    userId,
    customer,
    shippingAddress,
    items,
    promoCode,
    shippingMethod = 'standard',
  } = req.body;

  if (!userId || !customer || !customer.email || !customer.firstname || !customer.lastname || !customer.phone_number || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'Données de paiement incomplètes.' });
  }

  try {
    const orderItems = [];
    let subtotal = 0;
    for (const item of items) {
      const product = await Product.findById(item.productId);
      if (!product) {
        return res.status(404).json({ message: `Produit introuvable: ${item.productId}` });
      }
      const unitPrice = product.salePrice || product.price;
      const quantity = Number(item.quantity || 1);
      const lineTotal = unitPrice * quantity;
      subtotal += lineTotal;

      orderItems.push({
        productId: product._id,
        quantity,
        selectedOptions: item.selectedOptions || {},
        price: unitPrice,
        vendorId: product.vendorId,
        vendorName: product.vendorName || 'Vendeur Indépendant',
        subtotal: lineTotal,
      });
    }

    const shippingCost = Number(req.body.shippingCost || 0);
    const discount = Number(req.body.discount || 0);
    const tax = Number(req.body.tax || 0);
    const total = Math.max(0, subtotal + shippingCost + tax - discount);

    const transactionPayload = {
      description: `Paiement Dango Import - ${customer.firstname} ${customer.lastname}`,
      amount: Math.round(total),
      currency: { iso: 'XOF' },
      callback_url: process.env.FEDAPAY_RETURN_URL || 'https://www.dangoimport.com/checkout',
      custom_metadata: {
        transactionRef: crypto.randomBytes(8).toString('hex'),
      },
      customer: {
        firstname: customer.firstname,
        lastname: customer.lastname,
        email: customer.email,
        phone_number: {
          number: normalizePhoneNumber(customer.phone_number.number || customer.phone_number),
          country: customer.phone_number.country || 'BJ',
        },
      },
    };

    const fedapayTransaction = await FedapayTransaction.create(transactionPayload);
    const token = await fedapayTransaction.generateToken();

    const localTx = await createLocalTransaction({
      checkoutUrl: token.url,
      transactionId: fedapayTransaction.id,
      amount: Math.round(total),
      currency: 'XOF',
      user: transactionPayload.customer,
      metadata: {
        userId,
        shippingAddress,
        items: orderItems,
        subtotal,
        shippingCost,
        tax,
        discount,
        total,
        shippingMethod,
        promoCode,
      },
    });

    return res.status(201).json({
      success: true,
      checkoutUrl: token.url,
      transactionId: localTx._id,
    });
  } catch (error) {
    console.error('[fedapayRoutes] checkout error:', error);
    return res.status(500).json({ message: 'Erreur lors de l’initialisation du paiement FedaPay.', error: error.message });
  }
});

const handleFedapayWebhook = async (req, res) => {
  const fedapayConfig = configureFedapay();
  if (!fedapayConfig.ok) {
    return res.status(503).send('Paiement FedaPay non configuré.');
  }

  const signature = req.headers['x-fedapay-signature'];
  const secret = process.env.FEDAPAY_WEBHOOK_SECRET;
  const event = req.body;
  const eventId = event?.id || event?.entity?.id || crypto.randomBytes(12).toString('hex');

  try {
    if (secret && signature) {
      const hash = crypto.createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (hash !== signature) {
        await logWebhookEvent({ eventId, payload: event, signature, status: 'failed', error: 'Signature invalide' });
        console.error('[fedapayRoutes] signature invalid');
        return res.status(403).send('Signature invalide');
      }
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

    const localTransaction = await TransactionModel.findOne({ transactionId });
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

    const eventName = event?.name;
    const entity = event?.entity || {};
    if (eventName === 'transaction.approved' || entity.status === 'approved') {
      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        const expectedAmount = localTransaction.amount;
        const expectedCurrency = localTransaction.currency;
        const actualAmount = Number(entity.amount || 0);
        const actualCurrency = entity.currency?.iso || expectedCurrency;

        if (actualAmount !== expectedAmount || actualCurrency !== expectedCurrency) {
          throw new Error(`Montant ou devise incohérents (${actualAmount} ${actualCurrency}) attendu ${expectedAmount} ${expectedCurrency}`);
        }

        const createdOrder = await createOrderFromTransaction({ transaction: localTransaction, session });
        const payment = await createPaymentRecord({ orderId: createdOrder._id, transaction: localTransaction });
        const qrCode = await createQRCodeRecord({ orderId: createdOrder._id, transactionId });

        createdOrder.qrCodeId = qrCode._id;
        await createdOrder.save({ session });

        // Décrémenter les stocks
        for (const item of createdOrder.items) {
          await Product.findByIdAndUpdate(item.productId, {
            $inc: { stock: -item.quantity, totalSales: item.quantity },
          }, { session });
        }

        // Vider le panier du client
        await Cart.findOneAndUpdate({ userId: mongoose.Types.ObjectId(localTransaction.metadata.userId) }, {
          items: [],
          totalItems: 0,
          totalPrice: 0,
        }, { session });

        // Notifications et emails
        await notifyCustomerAndVendors({ order: createdOrder, qrCode });
        await emailService.sendOrderConfirmedEmail({
          customerEmail: createdOrder.customerEmail,
          customerName: createdOrder.customerName,
          orderNumber: createdOrder.orderNumber,
          total: createdOrder.total,
          qrCode: qrCode.code,
        });

        await OrderHistory.create([{
          orderId: createdOrder._id,
          event: 'payment_confirmed',
          details: {
            transactionId,
            provider: 'FedaPay',
            amount: actualAmount,
          },
          createdBy: 'system',
        }], { session });

        localTransaction.status = 'approved';
        localTransaction.orderId = createdOrder._id;
        localTransaction.webhookProcessed = true;
        await localTransaction.save({ session });

        webhookLog.status = 'processed';
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
        localTransaction.status = 'failed';
        localTransaction.webhookProcessed = true;
        await localTransaction.save();
        console.error('[fedapayRoutes] webhook processing failed:', error);
        return res.status(500).send('Erreur interne pendant le traitement du webhook');
      }
    }

    if (eventName === 'transaction.canceled' || entity.status === 'canceled' || entity.status === 'failed') {
      localTransaction.status = 'failed';
      localTransaction.webhookProcessed = true;
      await localTransaction.save();
      webhookLog.status = 'processed';
      await webhookLog.save();
      return res.status(200).send('Transaction annulée');
    }

    webhookLog.status = 'processed';
    await webhookLog.save();
    return res.status(200).send('Événement ignoré');
  } catch (error) {
    console.error('[fedapayRoutes] webhook error:', error);
    return res.status(500).send('Erreur serveur');
  }
};

router.post('/webhook', async (req, res) => handleFedapayWebhook(req, res));

router.get('/transaction/:id', async (req, res) => {
  try {
    const transaction = await TransactionModel.findById(req.params.id);
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction introuvable' });
    }
    return res.json({ success: true, data: transaction });
  } catch (error) {
    console.error('[fedapayRoutes] get transaction error:', error);
    return res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
});

module.exports = { router, handleWebhook: handleFedapayWebhook };
