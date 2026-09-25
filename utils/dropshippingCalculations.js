const PLATFORM_VENDOR_NAME = 'DANGO IMPORT';

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function calculateMargin({
  sellingPrice,
  supplierPrice = 0,
  supplierShippingCost = 0,
  otherCosts = 0,
}) {
  const sale = toNumber(sellingPrice);
  const supplier = toNumber(supplierPrice);
  const shipping = toNumber(supplierShippingCost);
  const other = toNumber(otherCosts);
  const totalCost = supplier + shipping + other;
  const estimatedProfit = sale - totalCost;
  const marginPercent = sale > 0 ? Math.round((estimatedProfit / sale) * 10000) / 100 : 0;

  return {
    totalCost,
    estimatedProfit,
    marginPercent,
  };
}

function isDropshippingProduct(product) {
  return product?.sourceType === 'DROPSHIPPING';
}

function getSupplierSnapshot(product) {
  if (!isDropshippingProduct(product)) return null;
  return {
    name: product?.supplier?.name || '',
    platform: product?.supplier?.platform || '',
    productId: product?.supplier?.productId || '',
    productUrl: product?.supplier?.productUrl || '',
    supplierPrice: toNumber(product?.supplier?.supplierPrice),
    supplierCurrency: product?.supplier?.supplierCurrency || 'XOF',
    shippingCost: toNumber(product?.supplier?.shippingCost),
    estimatedDeliveryDays: toNumber(product?.supplier?.estimatedDeliveryDays),
    lastSyncedAt: product?.supplier?.lastSyncedAt || null,
  };
}

module.exports = {
  PLATFORM_VENDOR_NAME,
  toNumber,
  calculateMargin,
  isDropshippingProduct,
  getSupplierSnapshot,
};
