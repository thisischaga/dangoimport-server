const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { FedaPay, Transaction: FedapayTransaction } = require('fedapay');
const { configureFedapay } = require('../config/fedapay');
const verifyToken = require('../Middlewares/verifyTokens');
const TransactionModel = require('../Models/Transaction');
const ShopOrder = require('../Models/ShopOrder');
const Payment = require('../Models/Payment');
const QRCode = require('../Models/QRCode');
const WebhookLog = require('../Models/WebhookLog');
const OrderHistory = require('../Models/OrderHistory');
const Cart = require('../Models/Cart');
const Store = require('../Models/Store');
const VendorOrder = require('../Models/VendorOrder');
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

const createVendorOrdersForShopOrder = async ({ order, session }) => {
  const byVendor = order.items.reduce((acc, item) => {
    if (!item.vendorId) return acc;
    const vendorId = item.vendorId.toString();
    if (!acc[vendorId]) {
      acc[vendorId] = {
        vendorId: item.vendorId,
        vendorName: item.vendorName || 'Vendeur Indépendant',
        items: [],
        subtotal: 0,
      };
    }
    acc[vendorId].items.push(item);
    acc[vendorId].subtotal += Number(item.subtotal || item.price * item.quantity || 0);
    return acc;
  }, {});

  const createdOrders = [];
  for (const vendorGroup of Object.values(byVendor)) {
    const store = await Store.findOne({ userId: mongoose.Types.ObjectId(vendorGroup.vendorId) }).session(session);
    if (!store) continue;

    const shippingShare = order.subtotal ? Math.round(order.shippingCost * (vendorGroup.subtotal / order.subtotal)) : 0;
    const vendorTotal = vendorGroup.subtotal + shippingShare;

    const [vendorOrder] = await VendorOrder.create([
      {
        storeId: store._id,
        shopOrderId: order._id,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        total: vendorTotal,
        status: 'pending',
        items: vendorGroup.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          price: item.price,
        })),
      }
    ], { session });

    createdOrders.push(vendorOrder);
  }

  return createdOrders;
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

const createQRCodeRecords = async ({ order, transactionId, session }) => {
  // Group items by vendorId (null vendor -> platform)
  const byVendor = (order.items || []).reduce((acc, item) => {
    const vid = item.vendorId ? String(item.vendorId) : 'platform';
    if (!acc[vid]) acc[vid] = { vendorId: item.vendorId || null, vendorName: item.vendorName || 'Dango Import', items: [] };
    acc[vid].items.push(item);
    return acc;
  }, {});

  const qrDocsPayload = Object.values(byVendor).map((group) => {
    const vendorTotal = group.items.reduce((s, it) => s + Number(it.subtotal || it.price * it.quantity || 0), 0);
    const code = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return {
      code,
      orderId: order._id,
      transactionId,
      vendorId: group.vendorId,
      vendorName: group.vendorName,
      status: 'active',
      metadata: { vendorTotal },
      expiresAt,
    };
  });

  if (qrDocsPayload.length === 0) return [];
  const created = await QRCode.create(qrDocsPayload, { session });
  return created;
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

router.post('/checkout', verifyToken, async (req, res) => {
  const fedapayConfig = configureFedapay();
  if (!fedapayConfig.ok) {
    return res.status(503).json({ message: 'Paiement FedaPay non configuré.' });
  }

  const payload = req.body || {};
  const customerName = payload.customer?.firstname || payload.firstName || payload.userFirstname || '';
  const customerLastName = payload.customer?.lastname || payload.lastName || payload.userSurname || '';
  const userName = payload.userName || `${customerName} ${customerLastName}`.trim();
  const userEmail = payload.customer?.email || payload.userEmail || payload.email;
  const userNumber = payload.customer?.phone_number?.number || payload.customer?.phone_number || payload.userNumber || payload.userPhone || payload.phone;

  const items = Array.isArray(payload.items)
    ? payload.items
    : Array.isArray(payload.cartItems)
      ? payload.cartItems
      : [];

  const shippingAddress = payload.shippingAddress || {
    country: payload.selectedCountry || payload.country || 'Togo',
    city: payload.city || '',
    neighborhood: payload.neighborhood || '',
    fullAddress: payload.address || payload.fullAddress || '',
    postalCode: payload.postalCode || payload.postalCode || '',
    instructions: payload.instructions || '',
  };

  if (!userName || !userEmail || !userNumber || !items.length) {
    return res.status(400).json({ message: 'Données de paiement incomplètes.' });
  }

  try {
    const orderItems = [];
    let subtotal = 0;
    for (const item of items) {
      const product = await Product.findById(item.productId || item._id || item.id);
      if (!product) {
        return res.status(404).json({ message: `Produit introuvable: ${item.productId || item._id || item.id}` });
      }
      const unitPrice = Number(item.price || product.salePrice || product.price || 0);
      const quantity = Number(item.quantity || 1);
      const lineTotal = unitPrice * quantity;
      subtotal += lineTotal;

      orderItems.push({
        productId: product._id,
        productName: product.name,
        productImage: product.images?.[0]?.url || product.image || '',
        vendorId: product.vendorId || null,
        vendorName: product.vendorName || item.vendorName || 'Vendeur Indépendant',
        price: unitPrice,
        originalPrice: product.price,
        salePrice: product.salePrice || 0,
        category: product.category,
        quantity,
        selectedOptions: item.selectedOptions || {},
        subtotal: lineTotal,
      });
    }

    const shippingCost = Number(payload.shippingCost || payload.deliveryFee || 0);
    const discount = Number(payload.discount || 0);
    const tax = Number(payload.tax || 0);
    const total = Number(payload.total || payload.totalPrice || Math.max(0, subtotal + shippingCost + tax - discount));
    const shippingMethod = payload.shippingMethod || payload.shippingLabel || 'standard';

    const customer = {
      firstname: customerName || 'Client',
      lastname: customerLastName || 'Dango',
      email: userEmail,
      phone_number: {
        number: normalizePhoneNumber(userNumber),
        country: payload.countryCode || (shippingAddress.country === 'Togo' ? 'TG' : 'BJ') || 'BJ',
      },
    };

    const transactionPayload = {
      description: `Paiement Dango Import - ${customer.firstname} ${customer.lastname}`,
      amount: Math.round(total),
      currency: { iso: 'XOF' },
      callback_url: process.env.FEDAPAY_RETURN_URL || 'https://www.dangoimport.com/checkout',
      custom_metadata: {
        cartSource: 'frontend',
        shippingMethod,
        promoCode: payload.promoCode || '',
      },
      customer,
    };

    const fedapayTransaction = await FedapayTransaction.create(transactionPayload);
    const token = await fedapayTransaction.generateToken();

    const localTx = await createLocalTransaction({
      checkoutUrl: token.url,
      transactionId: fedapayTransaction.id,
      amount: Math.round(total),
      currency: 'XOF',
      user: customer,
      metadata: {
        userId: req.user?.id || payload.userId || null,
        shippingAddress,
        items: orderItems,
        subtotal,
        shippingCost,
        tax,
        discount,
        total,
        shippingMethod,
        promoCode: payload.promoCode || '',
      },
    });

    return res.status(201).json({
      success: true,
      url: token.url,
      transactionId: fedapayTransaction.id,
      localTransactionId: localTx._id,
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
        const qrDocs = await createQRCodeRecords({ order: createdOrder, transactionId, session });

        // attach QR ids to order
        createdOrder.qrCodeIds = (qrDocs || []).map((q) => q._id);
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

        const qrCode = (qrDocs || [])[0];

        // Notifications et emails
        await notifyCustomerAndVendors({ order: createdOrder, qrCode });
        await emailService.sendOrderConfirmedEmail({
          customerEmail: createdOrder.customerEmail,
          customerName: createdOrder.customerName,
          orderNumber: createdOrder.orderNumber,
          total: createdOrder.total,
          qrCode: qrCode?.code,
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
    const id = req.params.id;
    let transaction = null;

    // Try lookup by provider transaction ID stored in `transactionId` field first (e.g. "481454")
    transaction = await TransactionModel.findOne({ transactionId: String(id) });

    // If not found by transactionId and id is a valid 24-hex Mongo ObjectId, try findById
    if (!transaction && /^[0-9a-fA-F]{24}$/.test(String(id))) {
      transaction = await TransactionModel.findById(id);
    }

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
