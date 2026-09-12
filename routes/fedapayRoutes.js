// routes/fedapayRoutes.js
const express = require('express');
const crypto = require('crypto');
const slugify = require('slugify');
const mongoose = require('mongoose');
const { FedaPay, Transaction: FedapayTransaction, Webhook } = require('fedapay');
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
const { createLocalTransaction, findTransactionByProviderId, markTransactionFailed, markTransactionApproved } = require('../services/paymentService');
const { calculateDeliveryForItems } = require('../services/deliveryService');
const { alertIntrusion } = require('../utils/securityAlerts');
const { validatePromotion } = require('../utils/promoValidation');

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

const normalizeShippingMethod = (value) => {
  if (!value) return 'standard';
  const normalized = String(value).trim().toLowerCase();
  if (['standard', 'livraison standard', 'livraison_standarde', 'livraison_standard', 'standard_delivery'].includes(normalized)) return 'standard';
  if (['express', 'livraison express', 'livraison_express', 'express_delivery'].includes(normalized)) return 'express';
  if (['pickup', 'retrait', 'pickup_point', 'pick-up', 'retrait_sur_place', 'retrait_en_magasin'].includes(normalized)) return 'pickup';
  return 'standard';
};

const createVendorOrdersForShopOrder = async ({ order, session }) => {
  // Regrouper les items par vendorId
  const byVendor = (order.items || []).reduce((acc, item) => {
    const vid = item.vendorId ? String(item.vendorId) : 'platform';
    if (!acc[vid]) acc[vid] = { vendorId: item.vendorId || null, vendorName: item.vendorName || 'Dango Import', items: [], subtotal: 0 };
    acc[vid].items.push(item);
    acc[vid].subtotal += Number(item.subtotal || item.price * item.quantity || 0);
    return acc;
  }, {});

  const createdOrders = [];
  for (const vendorGroup of Object.values(byVendor)) {
    let store = await Store.findOne({ userId: vendorGroup.vendorId }).session(session);
    if (!store) {
      try {
        const vendorUser = vendorGroup.vendorId ? await User.findById(vendorGroup.vendorId).session(session) : null;
        const baseName = vendorGroup.vendorName || (vendorUser ? (vendorUser.vendorName || `${vendorUser.userFirstname || ''} ${vendorUser.userSurname || ''}`.trim()) : 'Ma boutique');
        const storeSlug = `${slugify(baseName || 'ma-boutique', { lower: true, strict: true })}-${crypto.randomBytes(3).toString('hex')}`;
        const createdStores = await Store.create([{ userId: vendorGroup.vendorId, slug: storeSlug, name: baseName, whatsapp: vendorUser ? vendorUser.userPhone : '' }], { session });
        store = Array.isArray(createdStores) ? createdStores[0] : createdStores;
      } catch (e) {
        console.error('[fedapayRoutes] failed to ensure vendor store:', e.message || e);
        continue;
      }
    }

    const shippingShare = order.subtotal ? Math.round((order.shippingCost || 0) * (vendorGroup.subtotal / (order.subtotal || 1))) : 0;
    const vendorTotal = (vendorGroup.subtotal || 0) + shippingShare;

    const vendorOrderDoc = {
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
    };

    const [vendorOrder] = await VendorOrder.create([vendorOrderDoc], { session });
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

const generateOrderNumber = () => {
  const timestamp = Date.now().toString();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `DI-${random}-${timestamp.slice(-8)}`;
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
  customerId: mongoose.isValidObjectId(userId) ? new mongoose.Types.ObjectId(userId) : null,
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
  const shippingMethod = normalizeShippingMethod(metadata.shippingMethod || 'standard');

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

  const existingOrder = transaction.orderId ? await ShopOrder.findById(transaction.orderId).session(session) : null;
  if (existingOrder) {
    existingOrder.items = orderItems;
    existingOrder.subtotal = subtotal;
    existingOrder.shippingCost = shippingCost;
    existingOrder.tax = tax;
    existingOrder.discount = discount;
    existingOrder.total = total;
    existingOrder.shippingMethod = shippingMethod;
    existingOrder.shippingAddress = shippingAddress;
    existingOrder.paymentMethod = 'FedaPay';
    existingOrder.status = 'confirmed';
    existingOrder.paymentStatus = 'completed';
    existingOrder.paymentDate = new Date();
    existingOrder.history = [...(existingOrder.history || []), 'Paiement confirmé par FedaPay'];
    await existingOrder.save({ session });
    return existingOrder;
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

  orderPayload.status = 'confirmed';
  orderPayload.paymentStatus = 'completed';
  orderPayload.paymentMethod = 'FedaPay';
  orderPayload.paymentDate = new Date();
  orderPayload.history = ['Order created after payment confirmed'];

  const order = await ShopOrder.create([orderPayload], { session });
  return order[0];
};

const createPendingShopOrder = async ({ transaction }) => {
  const metadata = transaction.metadata || {};
  const userId = metadata.userId;
  const customer = transaction.customer || {};
  const shippingAddress = metadata.shippingAddress || {};
  const items = metadata.items || [];
  const subtotal = metadata.subtotal || transaction.amount || 0;
  const shippingCost = metadata.shippingCost || 0;
  const tax = metadata.tax || 0;
  const discount = metadata.discount || 0;
  const total = metadata.total || Math.max(0, subtotal + shippingCost + tax - discount);
  const shippingMethod = normalizeShippingMethod(metadata.shippingMethod || 'standard');

  const orderPayload = buildOrder({
    userId,
    customer,
    shippingAddress,
    items,
    subtotal,
    shippingCost,
    tax,
    discount,
    total,
    shippingMethod,
  });

  orderPayload.status = 'pending';
  orderPayload.paymentStatus = 'pending';
  orderPayload.paymentMethod = 'FedaPay';
  orderPayload.history = [...(orderPayload.history || []), 'Commande en attente de paiement FedaPay'];

  const created = await ShopOrder.create([orderPayload]);
  return Array.isArray(created) ? created[0] : created;
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
  // Use insertMany with ordered:true when running inside a session/transaction
  // to avoid Mongoose limitation on Model.create with multiple docs + session
  const created = await QRCode.insertMany(qrDocsPayload, { session, ordered: true });
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
      const unitPrice = Number(product.salePrice || product.price || 0);
      if (item.price != null && Math.abs(Number(item.price) - unitPrice) > 0.01) {
        return res.status(400).json({ message: `Prix invalide pour ${product.name}.` });
      }
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

    // Compute shipping cost from payload if not provided explicitly
    let shippingCost = Number(payload.shippingCost || payload.deliveryFee || 0);
    try {
      if ((!shippingCost || shippingCost === 0) && (payload.lat || payload.lng || payload.clientLocation)) {
        const clientLocation = payload.clientLocation || (payload.lat && payload.lng ? { lat: Number(payload.lat), lng: Number(payload.lng) } : null);
        if (clientLocation) {
          try {
            const deliveryResult = await calculateDeliveryForItems({ items: orderItems, clientLocation });
            // Sum fees from groups
            if (deliveryResult && Array.isArray(deliveryResult.groups)) {
              shippingCost = deliveryResult.groups.reduce((s, g) => s + (Number(g.fee || 0)), 0);
            }
          } catch (dErr) {
            console.warn('[fedapayRoutes] delivery calculation failed, falling back to provided fee', dErr.message);
          }
        }
      }
    } catch (err) {
      console.warn('[fedapayRoutes] shipping cost compute error:', err.message);
    }

    const promoResult = await validatePromotion(
      payload.promoCode,
      subtotal,
      req.user?.id || payload.userId || null,
      orderItems,
    );
    if (promoResult.error) {
      return res.status(400).json({ message: promoResult.error });
    }
    const discount = promoResult.discount || 0;
    const tax = Number(payload.tax || 0);
    const total = Math.max(0, subtotal + shippingCost + tax - discount);
    const clientTotal = Number(payload.total || payload.totalPrice || 0);
    if (clientTotal > 0 && Math.abs(clientTotal - total) > 1) {
      return res.status(400).json({ message: 'Total de commande invalide.' });
    }
    const shippingMethod = normalizeShippingMethod(payload.shippingMethod || payload.shippingLabel || 'standard');

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
      description: `Paiement Dango Import pour achat de produit(s) sur la marketplace de Dangoimport par ${customer.firstname} ${customer.lastname}`,
      amount: Math.round(total),
      currency: { iso: 'XOF' },
      callback_url: process.env.FEDAPAY_RETURN_URL || 'https://dangoimport.com/checkout',
      custom_metadata: {
        cartSource: process.env.FRONTEND_URL || "dangoimport.com",
        promoCode: payload.promoCode || 'Pas de code promo',
      },
      customer,
    };

    const pendingOrder = await createPendingShopOrder({
      transaction: {
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
        customer,
      },
    });

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
        promoCode: payload.promoCode || 'Pas de code promo',
      },
      orderId: pendingOrder._id,
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

  // Rechercher la signature dans plusieurs variantes d'en-têtes courantes
  let signature = req.headers['x-fedapay-signature'] || req.headers['fedapay-signature'] || req.headers['signature'] || req.headers['x-signature'] || null;
  if (!signature) {
    // tenter de repérer dynamiquement une clé contenant 'fedapay' et 'signature'
    const foundKey = Object.keys(req.headers).find(k => k.toLowerCase().includes('fedapay') && k.toLowerCase().includes('signature'));
    if (foundKey) signature = req.headers[foundKey];
  }
  const secret = process.env.FEDAPAY_WEBHOOK_SECRET;
  const event = req.body;
  const eventName = event?.name || event?.event || 'unknown.event';
  const entityId = event?.entity?.id || event?.entity?.transaction_id || null;
  const payloadString = req.rawBody || JSON.stringify(req.body);
  const eventId = event?.id || event?.event_id || crypto.createHash('sha256').update(payloadString).digest('hex');

  try {
    const allowUnsignedWebhook = process.env.NODE_ENV !== 'production';
    if (process.env.NODE_ENV === 'production' && !secret) {
      await logWebhookEvent({ eventId, payload: event, signature, status: 'failed', error: 'FEDAPAY_WEBHOOK_SECRET manquant en production' });
      return res.status(503).send('Webhook non configuré');
    }

    if (secret && signature) {
      // Premièrement essayer la vérification via la librairie
      let verifiedBySdk = false;
      try {
        Webhook.constructEvent(payloadString, signature, secret);
        verifiedBySdk = true;
      } catch (sdkErr) {
        // SDK n'a pas accepté la signature — on va essayer une vérification HMAC simple
        console.warn('[fedapayRoutes] SDK signature validation failed, attempting HMAC fallback', { sdkErr: sdkErr.message });
      }

      if (!verifiedBySdk) {
        try {
          const expected = crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
          const raw = String(signature || '').trim();
          const { timingSafeEqual } = require('../Middlewares/securityHelpers');
          const normalized = raw.startsWith('sha256=') ? raw.slice(7) : raw;
          const ok = timingSafeEqual(normalized, expected) || timingSafeEqual(raw, expected) || timingSafeEqual(raw, `sha256=${expected}`);
          if (!ok) {
            await logWebhookEvent({ eventId, payload: event, signature, status: 'failed', error: `Signature invalide (fallback HMAC): expected ${expected.slice(0,8)}...` });
            await alertIntrusion(req, 'Webhook FedaPay — signature invalide', { eventName, entityId });
            console.error('[fedapayRoutes] webhook signature invalid after HMAC fallback', {
              signature: raw,
              expectedSnippet: expected.slice(0, 16) + '...',
              secretConfigured: Boolean(secret),
              eventName,
              entityId,
              payloadSnippet: payloadString && payloadString.slice ? payloadString.slice(0, 1000) : null,
            });
            return res.status(403).json({ error: 'Signature invalide', details: 'HMAC fallback mismatch' });
          }
        } catch (err) {
          await logWebhookEvent({ eventId, payload: event, signature, status: 'failed', error: `Signature invalide: ${err.message}` });
          console.error('[fedapayRoutes] webhook signature verification error', err.message, { eventName, entityId });
          return res.status(403).json({ error: 'Signature verification error', details: err.message });
        }
      }
    } else if (!allowUnsignedWebhook) {
      await logWebhookEvent({ eventId, payload: event, signature, status: 'failed', error: 'Signature webhook FedaPay manquante en production' });
      await alertIntrusion(req, 'Webhook FedaPay — signature manquante en production', { eventName, entityId });
      console.error('[fedapayRoutes] webhook signature missing in production', { signature, secretConfigured: Boolean(secret), eventName, entityId });
      return res.status(403).send('Signature invalide');
    } else {
      console.warn('[fedapayRoutes] skipping signature validation for unsigned local/test webhook', {
        eventName,
        entityId,
        signaturePresent: Boolean(signature),
        secretConfigured: Boolean(secret),
        nodeEnv: process.env.NODE_ENV,
      });
    }

    const existingWebhook = await WebhookLog.findOne({ eventId });
    if (existingWebhook) {
      existingWebhook.status = 'duplicate';
      await existingWebhook.save();
      return res.status(200).send('Duplicate webhook ignored');
    }

    const webhookLog = await logWebhookEvent({ eventId, payload: event, signature, status: 'received' });

    const transactionId = event?.entity?.id;
    console.log('[fedapayRoutes] webhook payload', {
      eventId,
      signaturePresent: Boolean(signature),
      eventName: event?.name,
      transactionId,
      entityStatus: event?.entity?.status,
      expectedSecretConfigured: Boolean(secret),
    });

    if (!transactionId) {
      webhookLog.status = 'failed';
      webhookLog.error = 'Transaction ID absent dans le payload';
      await webhookLog.save();
      console.error('[fedapayRoutes] webhook missing transaction id', { event, payloadSnippet: payloadString && payloadString.slice ? payloadString.slice(0, 1000) : null });
      return res.status(400).json({ error: 'Transaction ID absent', payload: event });
    }

    const localTransaction = await TransactionModel.findOne({ transactionId });
    console.log('[fedapayRoutes] local transaction lookup', { transactionId, localTransaction: localTransaction ? { id: localTransaction._id, status: localTransaction.status, webhookProcessed: localTransaction.webhookProcessed } : null, payloadSnippet: payloadString && payloadString.slice ? payloadString.slice(0, 500) : null });
    if (!localTransaction) {
      webhookLog.status = 'failed';
      webhookLog.error = 'Transaction locale introuvable';
      await webhookLog.save();
      console.error('[fedapayRoutes] local transaction not found', { transactionId, payloadSnippet: payloadString && payloadString.slice ? payloadString.slice(0, 2000) : null });
      return res.status(404).json({ error: 'Transaction introuvable', transactionId, exampleLocalQuery: { transactionId } });
    }

    if (localTransaction.webhookProcessed) {
      webhookLog.status = 'duplicate';
      await webhookLog.save();
      return res.status(200).send('Webhook déjà traité');
    }

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
        const vendorOrders = await createVendorOrdersForShopOrder({ order: createdOrder, session });

        console.debug('[fedapayRoutes] webhook debug - createdOrder:', createdOrder?._id || createdOrder);
        console.debug('[fedapayRoutes] webhook debug - qrDocs count:', Array.isArray(qrDocs) ? qrDocs.length : 0);
        console.debug('[fedapayRoutes] webhook debug - vendorOrders count:', Array.isArray(vendorOrders) ? vendorOrders.length : 0);

        createdOrder.qrCodeIds = (qrDocs || []).map((q) => q._id);
        await createdOrder.save({ session });

        // Décrémenter les stocks
        for (const item of createdOrder.items) {
          await Product.findByIdAndUpdate(item.productId, {
            $inc: { stock: -item.quantity, totalSales: item.quantity },
          }, { session });
        }

        // Vider le panier du client
        // FIX: mongoose.Types.ObjectId doit être appelé avec `new` depuis Mongoose 6+/driver bson récent,
        // sinon: "Class constructor ObjectId cannot be invoked without 'new'".
        // On laisse Mongoose caster automatiquement la string userId — plus simple et robuste.
        // Vider le panier du client
        if (localTransaction.metadata?.userId) {
          await Cart.findOneAndUpdate({ userId: localTransaction.metadata.userId }, {
            items: [],
            totalItems: 0,
            totalPrice: 0,
          }, { session });
        }

        const qrCode = (qrDocs || [])[0];

        // Create an order history entry within the transaction
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

        // Update transaction record inside the DB transaction so the commit guarantees persistence
        localTransaction.status = 'approved';
        localTransaction.orderId = createdOrder._id;
        localTransaction.webhookProcessed = true;
        await localTransaction.save({ session });

        webhookLog.status = 'processed';
        await webhookLog.save({ session });

        // Commit the DB transaction before sending external notifications/emails
        await session.commitTransaction();
        session.endSession();

        // Notifications and emails are sent after commit to avoid sending confirmations when DB commit fails
        try {
          await notifyCustomerAndVendors({ order: createdOrder, qrCode });
        } catch (notifyErr) {
          console.error('[fedapayRoutes] notifyCustomerAndVendors failed after commit', notifyErr);
        }

        try {
          await emailService.sendOrderConfirmedEmail({
            customerEmail: createdOrder.customerEmail,
            customerName: createdOrder.customerName,
            orderNumber: createdOrder.orderNumber,
            total: createdOrder.total,
            qrCode: qrCode?.code,
            items: createdOrder.items,
            qrCodes: qrDocs,
          });
        } catch (emailErr) {
          console.error('[fedapayRoutes] sendOrderConfirmedEmail failed after commit', emailErr);
        }

        return res.status(200).send('Webhook traité avec succès');
      } catch (error) {
        await session.abortTransaction();
        session.endSession();
        webhookLog.status = 'failed';
        webhookLog.error = error.message;
        await webhookLog.save();

        // If the external entity reports failed/canceled, mark transaction failed.
        // Otherwise leave the transaction status as-is (or pending) so it can be reconciled/retried.
        try {
          if (entity.status === 'failed' || entity.status === 'canceled') {
            localTransaction.status = 'failed';
            localTransaction.webhookProcessed = true;
          } else {
            // do not mark failed when external status was approved; allow retry/reconciliation
            localTransaction.webhookProcessed = false;
          }
          await localTransaction.save();
        } catch (saveErr) {
          console.error('[fedapayRoutes] failed to update localTransaction after abort', saveErr);
        }

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

router.get('/transaction/:id', verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    let transaction = null;

    transaction = await TransactionModel.findOne({ transactionId: String(id) });

    if (!transaction && /^[0-9a-fA-F]{24}$/.test(String(id))) {
      transaction = await TransactionModel.findById(id);
    }

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction introuvable' });
    }

    const userId = String(req.user?.id || req.user?.userId || '');
    const userEmail = String(req.user?.userEmail || '').toLowerCase();
    const txUserId = String(transaction.metadata?.userId || transaction.userId || '');
    const txEmail = String(transaction.customer?.email || transaction.user?.email || '').toLowerCase();
    const isOwner = (userId && txUserId && userId === txUserId)
      || (userEmail && txEmail && userEmail === txEmail);
    const isAdmin = ['admin', 'dev-admin', 'superadmin', 'manager'].includes(req.user?.role);

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: 'Accès refusé.' });
    }

    return res.json({
      success: true,
      data: {
        id: transaction._id,
        transactionId: transaction.transactionId,
        status: transaction.status,
        amount: transaction.amount,
        currency: transaction.currency,
        orderId: transaction.orderId,
      },
    });
  } catch (error) {
    console.error('[fedapayRoutes] get transaction error:', error);
    return res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = { router, handleWebhook: handleFedapayWebhook };