const {
  isDropshippingProduct,
  calculateMargin,
  PLATFORM_VENDOR_NAME,
  toNumber,
} = require('./dropshippingCalculations');

function buildShopOrderItem(product, { quantity = 1, selectedOptions = {}, unitPriceOverride } = {}) {
  if (!product) {
    throw new Error('Produit introuvable pour la ligne de commande.');
  }

  const qty = Math.max(1, toNumber(quantity, 1));
  const unitPrice = unitPriceOverride != null
    ? toNumber(unitPriceOverride)
    : toNumber(product.salePrice || product.price);

  const dropship = isDropshippingProduct(product);
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
    item.supplierProductId = product.supplier?.productId || '';
    item.supplierPlatform = product.supplier?.platform || '';
    item.supplierCost = margin.totalCost;
    item.supplierShippingCost = supplierShipping;
    item.estimatedProfit = margin.estimatedProfit * qty;
  }

  return item;
}

function assertProductPurchasable(product, quantity = 1) {
  if (!product) {
    throw new Error('Produit introuvable.');
  }

  if (product.sourceType === 'DROPSHIPPING') {
    if (!product.isDropshippingActive) {
      throw new Error(`Le produit ${product.name} n'est pas disponible.`);
    }
    if (product.isPublished === false) {
      throw new Error(`Le produit ${product.name} n'est pas publié.`);
    }
  }

  const qty = Math.max(1, toNumber(quantity, 1));
  if (toNumber(product.stock) < qty) {
    throw new Error(`Stock insuffisant pour le produit ${product.name}`);
  }
}

module.exports = {
  buildShopOrderItem,
  assertProductPurchasable,
};
