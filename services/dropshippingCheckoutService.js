const Product = require('../Models/Product');
const { cjConfig } = require('../config/cj');
const {
  isDropshippingProduct,
  toNumber,
  PLATFORM_VENDOR_NAME,
} = require('../utils/dropshippingCalculations');
const { resolveDropshipSellableStock } = require('../utils/cjCatalogHelpers');
const { assertProductPurchasable, buildShopOrderItem } = require('../utils/orderItemBuilder');
const {
  fetchCjShippingOptionsForLines,
  findShippingOptionById,
} = require('./cj/cjFreightService');

const SUPPORTED_COUNTRIES = new Set(['TG', 'BJ', 'TOGO', 'BÉNIN', 'BENIN']);

function normalizeCountryCode(value) {
  const raw = String(value || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (raw === 'tg' || raw === 'togo') return 'TG';
  if (raw === 'bj' || raw === 'benin') return 'BJ';
  return String(value || '').trim().toUpperCase().slice(0, 2);
}

function isCjSupplierProduct(product) {
  const platform = String(product?.supplier?.platform || '').toLowerCase();
  return platform === 'cj' || product?.importSourceType === 'CJ_API';
}

function mapOptionsForClient(options = []) {
  return options.map((opt) => ({
    id: opt.id,
    provider: opt.provider,
    logisticName: opt.logisticName,
    label: opt.logisticName,
    cost: opt.customerPrice,
    currency: opt.customerCurrency,
    supplierCurrency: opt.currency,
    supplierPrice: opt.price,
    estimatedDelivery: opt.estimatedDelivery?.label || null,
    estimatedDeliveryMin: opt.estimatedDelivery?.minDays ?? null,
    estimatedDeliveryMax: opt.estimatedDelivery?.maxDays ?? null,
    channelId: opt.channelId,
    optionId: opt.optionId,
  }));
}

async function loadCheckoutProducts(items = []) {
  const normalized = items.map((item) => ({
    productId: item.productId || item._id || item.id,
    quantity: Math.max(1, toNumber(item.quantity, 1)),
    selectedOptions: item.selectedOptions || {},
  })).filter((row) => row.productId);

  const products = await Product.find({
    _id: { $in: normalized.map((r) => r.productId) },
    sourceType: 'DROPSHIPPING',
  }).lean();

  const byId = new Map(products.map((p) => [String(p._id), p]));
  const lines = [];

  for (const row of normalized) {
    const product = byId.get(String(row.productId));
    if (!product) {
      throw new Error('Produit dropshipping introuvable.');
    }
    if (!isDropshippingProduct(product)) {
      throw new Error('Ce panier contient un produit non dropshipping.');
    }
    assertProductPurchasable({ ...product, stock: resolveDropshipSellableStock(product) }, row.quantity);
    lines.push({ product, quantity: row.quantity, selectedOptions: row.selectedOptions });
  }

  return lines;
}

function computeSubtotal(lines) {
  let subtotal = 0;
  for (const line of lines) {
    const unit = toNumber(line.product.salePrice || line.product.price, 0);
    subtotal += unit * line.quantity;
  }
  return Math.round(subtotal);
}

async function getCjShippingOptions({ items = [], destination = {} } = {}) {
  const countryCode = normalizeCountryCode(destination.country || destination.countryCode);
  const city = String(destination.city || '').trim();
  if (!SUPPORTED_COUNTRIES.has(countryCode) && !['TG', 'BJ'].includes(countryCode)) {
    const err = new Error('Destination non supportée pour la livraison dropshipping.');
    err.status = 400;
    throw err;
  }
  if (!city) {
    const err = new Error('Ville requise pour calculer les modes de livraison.');
    err.status = 400;
    throw err;
  }

  const lines = await loadCheckoutProducts(items);
  if (!lines.every((l) => isCjSupplierProduct(l.product))) {
    const err = new Error('Le calcul CJ ne s’applique qu’aux produits CJdropshipping.');
    err.status = 400;
    throw err;
  }

  if (!cjConfig.enabled) {
    const err = new Error('L’intégration CJdropshipping est désactivée sur le serveur.');
    err.status = 503;
    throw err;
  }

  let freightResult;
  try {
    freightResult = await fetchCjShippingOptionsForLines(lines, { countryCode, city });
  } catch (error) {
    const err = new Error('Impossible de récupérer les modes de livraison. Réessayez plus tard.');
    err.status = 502;
    err.cause = error;
    throw err;
  }

  const options = mapOptionsForClient(freightResult.options);
  const subtotal = computeSubtotal(lines);

  return {
    success: true,
    countryCode,
    city,
    currency: 'XOF',
    subtotal,
    options,
    supplierName: PLATFORM_VENDOR_NAME,
    message: options.length
      ? undefined
      : 'Aucun mode de livraison disponible pour cette destination.',
  };
}

async function resolveSelectedShippingOption({ items, destination, shippingOptionId }) {
  const quote = await getCjShippingOptions({ items, destination });
  const lines = await loadCheckoutProducts(items);
  const freight = await fetchCjShippingOptionsForLines(lines, destination);
  const selected = findShippingOptionById(freight.options, shippingOptionId);

  if (!selected) {
    const err = new Error('Les frais de livraison ont changé. Veuillez vérifier votre mode de livraison.');
    err.status = 409;
    throw err;
  }

  return { quote, selected };
}

async function validateDropshippingCheckoutPayload({
  items = [],
  shippingOptionId,
  shippingMethod,
  shippingCost = 0,
  destinationCountry = 'TG',
  destination = {},
  shippingAddress = {},
}) {
  const countryCode = normalizeCountryCode(
    destination.country || destination.countryCode || destinationCountry,
  );
  const city = String(destination.city || shippingAddress.city || '').trim();
  const optionId = shippingOptionId || (String(shippingMethod || '').startsWith('cj:') ? shippingMethod : null);

  if (!optionId) {
    const err = new Error('Mode de livraison requis.');
    err.status = 400;
    throw err;
  }

  const { quote, selected } = await resolveSelectedShippingOption({
    items,
    destination: { countryCode, city },
    shippingOptionId: optionId,
  });

  const expectedShipping = toNumber(selected.customerPrice, 0);
  const providedShipping = toNumber(shippingCost, 0);
  if (providedShipping > 0 && Math.abs(expectedShipping - providedShipping) > 1) {
    const err = new Error('Les frais de livraison ont changé. Veuillez vérifier votre mode de livraison.');
    err.status = 409;
    throw err;
  }

  const lines = await loadCheckoutProducts(items);
  let subtotal = 0;
  const orderItems = [];

  for (const line of lines) {
    const built = buildShopOrderItem(line.product, {
      quantity: line.quantity,
      selectedOptions: line.selectedOptions,
    });
    subtotal += built.subtotal;
    orderItems.push(built);
  }

  const total = Math.round(subtotal + expectedShipping);

  if (!String(shippingAddress.fullAddress || '').trim()) {
    const err = new Error('Adresse de livraison incomplète.');
    err.status = 400;
    throw err;
  }
  if (!city) {
    const err = new Error('Ville requise.');
    err.status = 400;
    throw err;
  }
  const district = String(shippingAddress.district || shippingAddress.neighborhood || '').trim();
  if (!district) {
    const err = new Error('Quartier requis.');
    err.status = 400;
    throw err;
  }

  const cjShipping = {
    provider: 'CJdropshipping',
    logisticName: selected.logisticName,
    optionId: selected.optionId || selected.id,
    channelId: selected.channelId || null,
    customerPrice: expectedShipping,
    supplierPrice: selected.price,
    supplierCurrency: 'USD',
    currency: 'XOF',
    estimatedDelivery: {
      minDays: selected.estimatedDelivery?.minDays ?? null,
      maxDays: selected.estimatedDelivery?.maxDays ?? null,
      label: selected.estimatedDelivery?.label || null,
    },
  };

  return {
    orderItems,
    subtotal: Math.round(subtotal),
    shippingCost: expectedShipping,
    total,
    shippingMethod: selected.id,
    shippingOptionId: selected.id,
    estimatedDeliveryLabel: selected.estimatedDelivery?.label || null,
    cjShipping,
    quote,
  };
}

/** @deprecated Utiliser getCjShippingOptions */
async function getDropshippingShippingQuote(params) {
  return getCjShippingOptions({
    items: params.items,
    destination: {
      country: params.destinationCountry,
      city: params.destinationCity,
    },
  });
}

function cartIsDropshippingOnly(items = []) {
  return items.length > 0 && items.every((item) => item.sourceType === 'DROPSHIPPING');
}

module.exports = {
  getCjShippingOptions,
  getDropshippingShippingQuote,
  validateDropshippingCheckoutPayload,
  normalizeCountryCode,
  cartIsDropshippingOnly,
  loadCheckoutProducts,
};
