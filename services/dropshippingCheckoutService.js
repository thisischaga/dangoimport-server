const Product = require('../Models/Product');
const {
  isDropshippingProduct,
  toNumber,
  PLATFORM_VENDOR_NAME,
} = require('../utils/dropshippingCalculations');
const { resolveDropshipSellableStock } = require('../utils/cjCatalogHelpers');
const { assertProductPurchasable, buildShopOrderItem } = require('../utils/orderItemBuilder');
const { calculateImportPricing, calculateImportQuote, assertValidOrderQuantity } = require('../utils/importPricing');
const { getImportPricingConfig } = require('./importPricingService');

const SUPPORTED_COUNTRIES = new Set(['TG', 'BJ', 'TOGO', 'BÉNIN', 'BENIN']);
const DANGO_TRANSIT_OPTION_ID = 'dango-import:transit';

function normalizeCountryCode(value) {
  const raw = String(value || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (raw === 'tg' || raw === 'togo') return 'TG';
  if (raw === 'bj' || raw === 'benin') return 'BJ';
  return String(value || '').trim().toUpperCase().slice(0, 2);
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
    assertValidOrderQuantity(product, row.quantity);
    lines.push({ product, quantity: row.quantity, selectedOptions: row.selectedOptions });
  }

  return lines;
}

function mapTransitOption(quote) {
  return {
    id: DANGO_TRANSIT_OPTION_ID,
    provider: 'Dango Import',
    logisticName: 'Importation / livraison',
    label: 'Importation / livraison',
    cost: quote.shippingCost,
    currency: 'XOF',
    estimatedDelivery: quote.estimatedDeliveryLabel,
    estimatedDeliveryMin: quote.estimatedDays.min,
    estimatedDeliveryMax: quote.estimatedDays.max,
    billedWeight: quote.billedWeight,
    ratePerKg: quote.ratePerKg,
    shippingRatePerKg: quote.shippingRatePerKg || quote.ratePerKg,
    shippingBaseCost: quote.shippingBaseCost,
    shippingMarkup: 0,
  };
}

function publicImportBreakdown(quote) {
  return {
    productTotal: quote.productTotal,
    itemsTotal: quote.itemsTotal,
    billedWeight: quote.billedWeight,
    totalWeightKg: quote.totalWeightKg,
    ratePerKg: quote.ratePerKg,
    shippingRatePerKg: quote.shippingRatePerKg || quote.ratePerKg,
    shippingBaseCost: quote.shippingBaseCost,
    shippingMarkup: 0,
    shippingCost: quote.shippingCost,
    total: quote.total,
    estimatedDays: quote.estimatedDays,
    estimatedDelivery: quote.estimatedDelivery,
    estimatedDeliveryLabel: quote.estimatedDeliveryLabel,
    items: (quote.items || []).map((row) => ({
      productPrice: row.productPrice,
      unitPrice: row.unitPrice,
      packPrice: row.packPrice,
      packSize: row.packSize,
      quantity: row.quantity,
      productLineTotal: row.productLineTotal,
      minimumOrderQuantity: row.minimumOrderQuantity,
      quantityIncrement: row.quantityIncrement,
      soldAsLot: row.soldAsLot,
      weight: row.weight,
      unitWeight: row.unitWeight,
      billedWeight: row.shipping?.billedWeight,
      ratePerKg: row.shipping?.ratePerKg,
      shippingBaseCost: row.shippingBaseCost,
      shippingCost: row.shippingCost,
    })),
  };
}

async function getImportShippingQuote({ items = [], destination = {} } = {}) {
  const countryCode = normalizeCountryCode(destination.country || destination.countryCode);
  const city = String(destination.city || '').trim();
  if (!SUPPORTED_COUNTRIES.has(countryCode) && !['TG', 'BJ'].includes(countryCode)) {
    const err = new Error('Destination non supportée pour la livraison dropshipping.');
    err.status = 400;
    throw err;
  }
  if (!city) {
    const err = new Error('Ville requise pour calculer les frais d’importation.');
    err.status = 400;
    throw err;
  }

  const lines = await loadCheckoutProducts(items);
  const config = await getImportPricingConfig();
  const quote = calculateImportQuote(lines, config);
  const option = mapTransitOption(quote);

  return {
    success: true,
    countryCode,
    city,
    currency: 'XOF',
    subtotal: quote.productTotal,
    shippingCost: quote.shippingCost,
    total: quote.total,
    estimatedDays: quote.estimatedDays,
    estimatedDeliveryLabel: quote.estimatedDeliveryLabel,
    options: [option],
    supplierName: PLATFORM_VENDOR_NAME,
    importBreakdown: publicImportBreakdown(quote),
  };
}

/** Conservé pour compatibilité des routes existantes — n’expose plus les méthodes CJ. */
async function getCjShippingOptions(params) {
  return getImportShippingQuote(params);
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
  const optionId = shippingOptionId || shippingMethod || DANGO_TRANSIT_OPTION_ID;

  if (optionId && optionId !== DANGO_TRANSIT_OPTION_ID && String(optionId).startsWith('cj:')) {
    const err = new Error('Les modes d’expédition fournisseur ne sont plus disponibles. Utilisez l’importation Dango Import.');
    err.status = 400;
    throw err;
  }

  const quoteResult = await getImportShippingQuote({
    items,
    destination: { country: countryCode, city },
  });
  const providedShipping = toNumber(shippingCost, 0);
  if (providedShipping > 0 && Math.abs(quoteResult.shippingCost - providedShipping) > 1) {
    const err = new Error('Les frais d’importation ont changé. Veuillez actualiser le checkout.');
    err.status = 409;
    throw err;
  }

  const lines = await loadCheckoutProducts(items);
  const config = await getImportPricingConfig();
  let subtotal = 0;
  const orderItems = [];
  const itemSnapshots = [];

  for (const line of lines) {
    const pricing = calculateImportPricing(line.product, {
      quantity: line.quantity,
      config,
      includeShippingMarkup: false,
    });
    const built = buildShopOrderItem(line.product, {
      quantity: line.quantity,
      selectedOptions: line.selectedOptions,
      unitPriceOverride: pricing.productPrice,
    });
    built.importPricing = {
      productPrice: pricing.productPrice,
      shipping: pricing.shipping,
      total: pricing.total,
    };
    subtotal += built.subtotal;
    orderItems.push(built);
    itemSnapshots.push(pricing);
  }

  const shippingCostFinal = quoteResult.shippingCost;
  const total = Math.round(subtotal + shippingCostFinal);

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

  const primary = itemSnapshots[0] || {};
  const breakdown = quoteResult.importBreakdown || {};
  const importShipping = {
    category: 'normal',
    weight: breakdown.billedWeight,
    billedWeight: breakdown.billedWeight,
    totalWeight: breakdown.totalWeightKg || breakdown.billedWeight,
    ratePerKg: breakdown.ratePerKg,
    shippingRatePerKg: breakdown.shippingRatePerKg || breakdown.ratePerKg,
    baseCost: breakdown.shippingBaseCost,
    markup: 0,
    shippingCost: shippingCostFinal,
    customerCost: shippingCostFinal,
    productPrice: primary.productPrice,
    productTotal: subtotal,
    itemsTotal: subtotal,
    total,
    productMarkupMultiplier: primary.productMarkupMultiplier,
    minimumProductPrice: primary.minimumProductPrice,
    estimatedDays: quoteResult.estimatedDays,
    estimatedDeliveryMinDays: quoteResult.estimatedDays?.min,
    estimatedDeliveryMaxDays: quoteResult.estimatedDays?.max,
    items: itemSnapshots.map((row) => ({
      productPrice: row.productPrice,
      quantity: row.quantity,
      minimumOrderQuantity: row.minimumOrderQuantity,
      quantityIncrement: row.quantityIncrement,
      unitWeight: row.unitWeight || row.weight,
      totalWeight: row.shipping?.billedWeight,
      billedWeight: row.shipping?.billedWeight,
      shipping: row.shipping,
      productLineTotal: row.productLineTotal,
    })),
  };

  return {
    orderItems,
    subtotal: Math.round(subtotal),
    shippingCost: shippingCostFinal,
    total,
    shippingMethod: DANGO_TRANSIT_OPTION_ID,
    shippingOptionId: DANGO_TRANSIT_OPTION_ID,
    estimatedDeliveryLabel: quoteResult.estimatedDeliveryLabel,
    importShipping,
    cjShipping: undefined,
    quote: quoteResult,
  };
}

async function getDropshippingShippingQuote(params) {
  return getImportShippingQuote({
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
  DANGO_TRANSIT_OPTION_ID,
  getImportShippingQuote,
  getCjShippingOptions,
  getDropshippingShippingQuote,
  validateDropshippingCheckoutPayload,
  normalizeCountryCode,
  cartIsDropshippingOnly,
  loadCheckoutProducts,
};
