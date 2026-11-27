const crypto = require('crypto');
const Product = require('../Models/AlibabaProduct');
const DropshippingCheckoutQuote = require('../Models/DropshippingCheckoutQuote');
const {
  isDropshippingProduct,
  toNumber,
  PLATFORM_VENDOR_NAME,
} = require('../utils/dropshippingCalculations');
const { resolveDropshipSellableStock } = require('../utils/cjCatalogHelpers');
const { assertProductPurchasable, buildShopOrderItem } = require('../utils/orderItemBuilder');
const {
  calculateImportPricing,
  calculateImportQuote,
  assertValidOrderQuantity,
  isAlibabaManagedProduct,
} = require('../utils/importPricing');
const { getImportPricingConfig } = require('./importPricingService');
const {
  getAlibabaFreightConfig,
  calculateAlibabaFreightQuote,
  inferFreightCategory,
} = require('./alibaba/alibabaFreightService');
const {
  getLocalDeliveryConfig,
  calculateLocalDeliveryQuote,
} = require('./localDeliveryPricingService');

const SUPPORTED_COUNTRIES = new Set(['TG', 'BJ', 'TOGO', 'BÉNIN', 'BENIN']);
const DANGO_TRANSIT_OPTION_ID = 'dango-import:transit';

function normalizeCountryCode(value) {
  const raw = String(value || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (raw === 'tg' || raw === 'togo') return 'TG';
  if (raw === 'bj' || raw === 'benin') return 'BJ';
  return String(value || '').trim().toUpperCase().slice(0, 2);
}

async function loadCheckoutProducts(items = [], config) {
  const pricingConfig = config || await getImportPricingConfig();
  const normalized = items.map((item) => ({
    productId: item.productId || item._id || item.id,
    quantity: Math.max(1, toNumber(item.quantity, 1)),
    selectedOptions: item.selectedOptions || {},
  })).filter((row) => row.productId);

  const products = await Product.find({
    _id: { $in: normalized.map((r) => r.productId) },
  }).lean();

  const byId = new Map(products.map((p) => [String(p._id), p]));
  const lines = [];

  for (const row of normalized) {
    const product = byId.get(String(row.productId));
    if (!product) {
      throw new Error('Produit introuvable dans le catalogue.');
    }
    assertProductPurchasable({ ...product, stock: resolveDropshipSellableStock(product) }, row.quantity, pricingConfig);
    assertValidOrderQuantity(product, row.quantity, pricingConfig);
    lines.push({ product, quantity: row.quantity, selectedOptions: row.selectedOptions });
  }

  return lines;
}

function mapTransitOption(quote) {
  return {
    id: DANGO_TRANSIT_OPTION_ID,
    provider: 'Dango Import',
    logisticName: quote.transport?.transportLabel || 'Importation / livraison',
    label: quote.transport?.transportLabel || 'Importation / livraison',
    cost: quote.shippingCost,
    currency: 'XOF',
    estimatedDelivery: quote.estimatedDeliveryLabel,
    estimatedDeliveryMin: quote.estimatedDays?.min ?? null,
    estimatedDeliveryMax: quote.estimatedDays?.max ?? null,
    transportMode: quote.transport?.transportMode || null,
  };
}

function publicImportBreakdown(quote) {
  return {
    productTotal: quote.productTotal,
    itemsTotal: quote.itemsTotal,
    internationalShippingCost: Number(quote.shippingBaseCost || 0),
    localDeliveryFee: Number(quote.localDeliveryFee || 0),
    shippingCost: quote.shippingCost,
    total: quote.total,
    localDelivery: quote.localDelivery ? {
      zoneName: quote.localDelivery.zoneName,
      category: quote.localDelivery.category,
      baseFee: quote.localDelivery.baseFee,
      fragileSurcharge: quote.localDelivery.fragileSurcharge,
      fee: quote.localDelivery.fee,
    } : null,
  };
}

async function getImportShippingQuote({ items = [], destination = {}, transportMode } = {}) {
  const countryCode = normalizeCountryCode(destination.country || destination.countryCode);
  const city = String(destination.city || '').trim();
  const district = String(destination.district || destination.neighborhood || '').trim();
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
  if (!district) {
    const err = new Error('Quartier requis pour calculer la livraison locale.');
    err.status = 400;
    throw err;
  }

  const config = await getImportPricingConfig();
  const lines = await loadCheckoutProducts(items, config);
  const quote = calculateImportQuote(lines, config);
  const alibabaLines = lines.filter((line) => isAlibabaManagedProduct(line.product));
  let freightConfig = null;
  if (alibabaLines.length > 0) {
    if (!transportMode) {
      const error = new Error('Choisissez un mode de transport avant de calculer les frais.');
      error.status = 400;
      error.code = 'TRANSPORT_MODE_REQUIRED';
      throw error;
    }
    freightConfig = await getAlibabaFreightConfig();
    const freight = calculateAlibabaFreightQuote(alibabaLines, countryCode, transportMode, freightConfig);
    const standardShipping = quote.items.reduce((sum, itemQuote, index) => (
      isAlibabaManagedProduct(lines[index]?.product)
        ? sum
        : sum + Number(itemQuote.shippingBaseCost || 0)
    ), 0);
    quote.transport = freight;
    quote.shippingBaseCost = freight.cost + standardShipping;
    quote.shippingRatePerKg = null;
    quote.ratePerKg = null;
    quote.billedWeight = freight.billableWeightKg;
    quote.totalWeightKg = freight.billableWeightKg;
    quote.estimatedDays = null;
    quote.estimatedDelivery = null;
    quote.estimatedDeliveryLabel = 'Délai d’acheminement non confirmé';
  }

  const localConfig = await getLocalDeliveryConfig();
  const localDelivery = calculateLocalDeliveryQuote({
    lines,
    countryCode,
    city,
    district,
    config: localConfig,
  });
  quote.localDelivery = localDelivery;
  quote.localDeliveryFee = localDelivery.fee;
  quote.shippingCost = Number(quote.shippingBaseCost || 0) + localDelivery.fee;
  quote.total = Math.round(quote.productTotal + quote.shippingCost);
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
    transportMode: quote.transport?.transportMode || null,
    options: [option],
    supplierName: PLATFORM_VENDOR_NAME,
    importBreakdown: publicImportBreakdown(quote),
    quoteSnapshot: {
      items: quote.items.map((row, index) => ({
        ...row,
        productId: String(lines[index]?.product?._id || ''),
      })),
      productTotal: quote.productTotal,
      internationalShippingCost: Number(quote.shippingBaseCost || 0),
      localDeliveryFee: localDelivery.fee,
      shippingCost: quote.shippingCost,
      total: quote.total,
      estimatedDays: quote.estimatedDays,
      estimatedDeliveryLabel: quote.estimatedDeliveryLabel,
      transportMode: quote.transport?.transportMode || null,
      importBreakdown: publicImportBreakdown(quote),
      localDelivery,
      pricingConfig: config,
      freightConfig,
      localDeliveryConfig: localConfig,
    },
  };
}

async function getAvailableTransportOptions({ items = [], countryCode } = {}) {
  const normalizedCountryCode = normalizeCountryCode(countryCode);
  const pricingConfig = await getImportPricingConfig();
  const lines = await loadCheckoutProducts(items, pricingConfig);
  const alibabaLines = lines.filter((line) => isAlibabaManagedProduct(line.product));
  if (!alibabaLines.length) {
    return { requiresSelection: false, options: [] };
  }

  const config = await getAlibabaFreightConfig();
  const destination = config.destinations[normalizedCountryCode];
  if (!destination) {
    const error = new Error('Destination non configurée pour le transport InterCargo.');
    error.status = 422;
    error.code = 'IMPORT_TRANSPORT_UNAVAILABLE';
    throw error;
  }

  const options = ['air', 'sea']
    .filter((modeKey) => {
      const mode = destination[modeKey];
      return mode.enabled && alibabaLines.every((line) => {
        const product = line.product;
        const allowedModes = product.logistics?.allowedTransportModes || [];
        if (allowedModes.length && !allowedModes.includes(modeKey)) return false;
        const categoryKey = inferFreightCategory(product, modeKey, mode.categories);
        return Number.isFinite(Number(mode.categories[categoryKey]?.rate))
          && Number(mode.categories[categoryKey].rate) > 0;
      });
    })
    .map((id) => ({
      id,
      label: id === 'air' ? 'Transport aérien' : 'Transport maritime',
    }));

  if (!options.length) {
    const error = new Error('Aucun mode de transport disponible pour ce panier et ce pays.');
    error.status = 422;
    error.code = 'IMPORT_TRANSPORT_UNAVAILABLE';
    throw error;
  }
  return { requiresSelection: true, countryCode: normalizedCountryCode, options };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function cartSignature(items = []) {
  const normalized = items.map((item) => ({
    productId: String(item.productId || item._id || item.id || ''),
    quantity: Math.max(1, toNumber(item.quantity, 1)),
    selectedOptions: item.selectedOptions || {},
  }));
  return crypto.createHash('sha256').update(stableStringify(normalized)).digest('hex');
}

function destinationSignature(destination = {}) {
  return stableStringify({
    country: normalizeCountryCode(destination.country || destination.countryCode),
    city: String(destination.city || '').trim().toLowerCase(),
    district: String(destination.district || destination.neighborhood || '').trim().toLowerCase(),
  });
}

async function createCheckoutQuote({ items, destination, transportMode, userId }) {
  const result = await getImportShippingQuote({ items, destination, transportMode });
  const quoteId = crypto.randomBytes(24).toString('hex');
  await DropshippingCheckoutQuote.create({
    quoteId,
    userId: userId || null,
    cartSignature: cartSignature(items),
    destinationSignature: destinationSignature(destination),
    snapshot: result.quoteSnapshot,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  });
  const { quoteSnapshot, ...publicResult } = result;
  return { ...publicResult, quoteId };
}

async function loadCheckoutQuote({ quoteId, items, destination, userId }) {
  const quote = await DropshippingCheckoutQuote.findOne({
    quoteId,
    expiresAt: { $gt: new Date() },
    ...(userId ? { userId } : {}),
  }).lean();
  if (!quote
    || quote.cartSignature !== cartSignature(items)
    || quote.destinationSignature !== destinationSignature(destination)) {
    const error = new Error('Le devis a expiré ou les informations du panier/adresse ont changé. Recalculez la livraison.');
    error.status = 409;
    error.code = 'DROPSHIPPING_QUOTE_INVALID';
    throw error;
  }
  return quote;
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
  transportMode,
  quoteId,
  userId,
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

  const resolvedDestination = {
    country: countryCode,
    city,
    district: destination.district || destination.neighborhood || shippingAddress.district || shippingAddress.neighborhood,
  };
  let quoteResult;
  let quoteSnapshot;
  if (quoteId) {
    const savedQuote = await loadCheckoutQuote({
      quoteId,
      items,
      destination: resolvedDestination,
      userId,
    });
    quoteSnapshot = savedQuote.snapshot;
    quoteResult = {
      shippingCost: quoteSnapshot.shippingCost,
      estimatedDeliveryLabel: quoteSnapshot.estimatedDeliveryLabel,
      estimatedDays: quoteSnapshot.estimatedDays,
      transportMode: quoteSnapshot.transportMode,
      importBreakdown: quoteSnapshot.importBreakdown,
    };
  } else {
    quoteResult = await getImportShippingQuote({
      items,
      destination: resolvedDestination,
      transportMode,
    });
    quoteSnapshot = quoteResult.quoteSnapshot;
  }
  const providedShipping = toNumber(shippingCost, 0);
  const savedShippingCost = quoteSnapshot?.shippingCost ?? quoteResult.shippingCost;
  if (providedShipping > 0 && Math.abs(savedShippingCost - providedShipping) > 1) {
    const err = new Error('Les frais d’importation ont changé. Veuillez actualiser le checkout.');
    err.status = 409;
    throw err;
  }

  const config = quoteSnapshot?.pricingConfig || await getImportPricingConfig();
  const lines = await loadCheckoutProducts(items, config);
  let subtotal = 0;
  const orderItems = [];
  const itemSnapshots = quoteSnapshot?.items || [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const pricing = itemSnapshots[index] || calculateImportPricing(line.product, {
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
      shipping: pricing.shipping || pricing.shippingBaseCost,
      total: pricing.total,
    };
    subtotal += built.subtotal;
    orderItems.push(built);
  }

  if (quoteSnapshot && Math.abs(subtotal - Number(quoteSnapshot.productTotal || 0)) > 1) {
    const err = new Error('Les prix des produits ne correspondent plus au devis. Recalculez la commande.');
    err.status = 409;
    throw err;
  }
  if (quoteSnapshot) subtotal = Number(quoteSnapshot.productTotal);
  const shippingCostFinal = Number(savedShippingCost);
  const total = Number(quoteSnapshot?.total ?? Math.round(subtotal + shippingCostFinal));

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
    baseCost: Number(quoteSnapshot?.internationalShippingCost ?? breakdown.internationalShippingCost ?? 0),
    markup: 0,
    shippingCost: shippingCostFinal,
    internationalShippingCost: Number(quoteSnapshot?.internationalShippingCost ?? breakdown.internationalShippingCost ?? 0),
    localDeliveryFee: Number(quoteSnapshot?.localDeliveryFee ?? breakdown.localDeliveryFee ?? 0),
    localDelivery: quoteSnapshot?.localDelivery ? {
      countryCode: quoteSnapshot.localDelivery.countryCode,
      zoneId: quoteSnapshot.localDelivery.zoneId,
      zoneName: quoteSnapshot.localDelivery.zoneName,
      category: quoteSnapshot.localDelivery.category,
      fee: quoteSnapshot.localDelivery.fee,
      revision: quoteSnapshot.localDelivery.revision,
    } : undefined,
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
    chinaDomesticShippingUsd: breakdown.chinaDomesticShippingUsd ?? breakdown.chinaDomesticShipping?.usd,
    chinaDomesticShippingFcfa: breakdown.chinaDomesticShippingFcfa ?? breakdown.chinaDomesticShipping?.fcfa,
    chinaDomesticShippingUsdPerGroup: breakdown.chinaDomesticShipping?.usdPerGroup,
    chinaDomesticShippingGroupCount: breakdown.chinaDomesticShipping?.groupCount,
    chinaDomesticShippingGroups: breakdown.chinaDomesticShipping?.groups,
    chinaDomesticShipping: breakdown.chinaDomesticShipping,
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
    estimatedDeliveryLabel: quoteSnapshot?.estimatedDeliveryLabel || quoteResult.estimatedDeliveryLabel,
    transportMode: quoteSnapshot?.transportMode || quoteResult.transportMode || null,
    importShipping,
    transportPricingSnapshot: quoteSnapshot || null,
    cjShipping: undefined,
    quote: quoteResult,
  };
}

async function getDropshippingShippingQuote(params) {
  return getImportShippingQuote({
    items: params.items,
    transportMode: params.transportMode,
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
  getAvailableTransportOptions,
  createCheckoutQuote,
  loadCheckoutQuote,
  getCjShippingOptions,
  getDropshippingShippingQuote,
  validateDropshippingCheckoutPayload,
  normalizeCountryCode,
  cartIsDropshippingOnly,
  loadCheckoutProducts,
};
