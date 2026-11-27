const {
  isDropshippingProduct,
  calculateMargin,
  PLATFORM_VENDOR_NAME,
  toNumber,
  applyProductMarkup,
} = require('./dropshippingCalculations');
const { resolveDropshipSellableStock } = require('./cjCatalogHelpers');
const {
  calculateImportPricing,
  assertValidOrderQuantity,
  convertSupplierPriceFcfa,
  isAlibabaManagedProduct,
} = require('./importPricing');
const { getImportPricingConfigSync } = require('../services/importPricingService');

function buildShopOrderItem(product, { quantity = 1, selectedOptions = {}, unitPriceOverride } = {}) {
  if (!product) {
    throw new Error('Produit introuvable pour la ligne de commande.');
  }

  const qty = Math.max(1, toNumber(quantity, 1));
  const dropship = isDropshippingProduct(product);
  const importPricing = dropship
    ? calculateImportPricing(product, { quantity: qty, config: getImportPricingConfigSync() })
    : null;
  const unitPrice = unitPriceOverride != null
    ? toNumber(unitPriceOverride)
    : (importPricing
      ? importPricing.productPrice
      : toNumber(product.salePrice || product.price));
  const supplierPrice = toNumber(product.supplier?.supplierPrice || product.costPrice);
  const supplierShipping = toNumber(product.supplier?.shippingCost);
  const otherCosts = toNumber(product.otherCosts);
  const margin = calculateMargin({
    sellingPrice: unitPrice,
    supplierPrice,
    supplierShippingCost: supplierShipping,
    otherCosts,
  });

  const item = {
    productId: product._id,
    productName: product.name,
    productImage: product.images?.[0]?.url || product.image || '',
    vendorId: dropship ? null : product.vendorId || null,
    vendorName: dropship ? PLATFORM_VENDOR_NAME : (product.vendorName || 'Vendeur Indépendant'),
    price: unitPrice,
    sellingPrice: unitPrice,
    originalPrice: product.price,
    salePrice: product.salePrice || 0,
    category: product.category,
    quantity: qty,
    selectedOptions: selectedOptions || {},
    subtotal: unitPrice * qty,
    delivered: false,
    sourceType: product.sourceType || 'LOCAL_SELLER',
    fulfillmentStatus: 'PENDING_PAYMENT',
  };

  if (dropship) {
    const variant = selectedOptions?.selectedVariant || selectedOptions?.variant;
    item.supplierProductId = product.supplier?.productId || '';
    item.supplierPlatform = product.supplier?.platform || 'cj';
    item.supplierName = product.supplier?.name || 'CJdropshipping';
    item.supplierCost = margin.totalCost;
    item.supplierShippingCost = supplierShipping;
    item.estimatedProfit = margin.estimatedProfit * qty;
    item.externalVariantId = String(
      variant?.attributes?.externalVariantId
      || selectedOptions?.externalVariantId
      || variant?.sku
      || '',
    ).trim();
    item.variantLabel = String(
      variant?.name
      || selectedOptions?.selectedColor
      || selectedOptions?.selectedSize
      || '',
    ).trim();
  }

  return item;
}

function resolveProductPurchasablePrice(product, quantity = 1, config = getImportPricingConfigSync()) {
  if (!product) return 0;
  const direct = toNumber(product.price || product.salePrice || product.unitPrice, 0);
  if (direct > 0) return direct;

  try {
    const importPricing = calculateImportPricing(product, {
      quantity: Math.max(1, toNumber(quantity, 1)),
      config,
    });
    if (importPricing && importPricing.productPrice > 0) {
      return importPricing.productPrice;
    }
  } catch {
    /* ignore */
  }

  const converted = convertSupplierPriceFcfa(product);
  if (converted > 0) {
    return applyProductMarkup(converted, toNumber(product.productMarkupMultiplier, 1.3), 0);
  }

  return 0;
}

function assertProductPurchasable(product, quantity = 1, config = getImportPricingConfigSync()) {
  if (!product) {
    throw new Error('Produit introuvable.');
  }

  const validPrice = resolveProductPurchasablePrice(product, quantity, config);
  if (validPrice <= 0) {
    throw new Error(`Le produit "${product.name}" n'a pas un prix valide.`);
  }

  if (toNumber(product.price, 0) <= 0) {
    product.price = validPrice;
  }
  if (toNumber(product.salePrice, 0) <= 0) {
    product.salePrice = validPrice;
  }

  if (product.sourceType === 'DROPSHIPPING') {
    if (!product.isDropshippingActive && !isAlibabaManagedProduct(product)) {
      throw new Error(`Le produit ${product.name} n'est pas disponible.`);
    }
    if (product.isPublished === false) {
      throw new Error(`Le produit ${product.name} n'est pas publié.`);
    }
  }

  const qty = Math.max(1, toNumber(quantity, 1));
  if (product.sourceType === 'DROPSHIPPING') {
    assertValidOrderQuantity(product, qty, config);
  }
  const isImport = isDropshippingProduct(product);
  const available = isImport
    ? resolveDropshipSellableStock(product)
    : toNumber(product.stock, 0);
  const effectiveStock = (isImport && available <= 0) ? 9999 : available;
  if (effectiveStock < qty) {
    throw new Error(`Stock insuffisant pour le produit ${product.name}`);
  }
}

module.exports = {
  buildShopOrderItem,
  assertProductPurchasable,
};
