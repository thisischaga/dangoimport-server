const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateMargin,
  isDropshippingProduct,
  PLATFORM_VENDOR_NAME,
} = require('../utils/dropshippingCalculations');
const { toPublicProduct } = require('../utils/publicProduct');
const { buildShopOrderItem } = require('../utils/orderItemBuilder');

test('calculateMargin returns expected profit', () => {
  const margin = calculateMargin({
    sellingPrice: 25000,
    supplierPrice: 12000,
    supplierShippingCost: 3500,
    otherCosts: 500,
  });

  assert.equal(margin.totalCost, 16000);
  assert.equal(margin.estimatedProfit, 9000);
  assert.equal(margin.marginPercent, 36);
});

test('public product hides supplier data for dropshipping', () => {
  const publicProduct = toPublicProduct({
    _id: '64abc12345678901234567890',
    name: 'Montre',
    price: 25000,
    description: 'Test',
    sourceType: 'DROPSHIPPING',
    supplier: {
      supplierPrice: 12000,
      productUrl: 'https://secret.example.com',
      productId: 'SKU-1',
    },
    costPrice: 12000,
    estimatedProfit: 9000,
    vendorName: 'Hidden Vendor',
  });

  assert.equal(publicProduct.vendorName, PLATFORM_VENDOR_NAME);
  assert.equal(publicProduct.supplier, undefined);
  assert.equal(publicProduct.costPrice, undefined);
  assert.equal(publicProduct.estimatedProfit, undefined);
});

test('public CJ product keeps Dango Import certified and China origin', () => {
  const publicProduct = toPublicProduct({
    _id: '64abc12345678901234567890',
    name: 'Who Wear Leggings',
    price: 8000,
    sourceType: 'DROPSHIPPING',
    importSourceType: 'CJ_API',
    externalSourceKey: 'cj:123',
    supplier: {
      platform: 'cj',
      productId: '123',
      supplierPrice: 4.8,
      productNameEn: 'Who Wear Leggings',
    },
  });

  assert.equal(publicProduct.vendorName, PLATFORM_VENDOR_NAME);
  assert.equal(publicProduct.isVendorCertified, true);
  assert.equal(publicProduct.originLabel, 'Chine');
  assert.equal(publicProduct.supplier, undefined);
});

test('local product origin uses seller country', () => {
  const publicProduct = toPublicProduct({
    _id: '64abc12345678901234567891',
    name: 'Pagne',
    price: 5000,
    sourceType: 'LOCAL_SELLER',
    deliveryZones: [{ country: 'Togo', zoneName: 'Lomé' }],
  });
  assert.equal(publicProduct.originLabel, 'Togo');
});

test('buildShopOrderItem snapshots dropshipping fields', () => {
  const item = buildShopOrderItem(
    {
      _id: '64abc12345678901234567890',
      name: 'Montre',
      price: 25000,
      stock: 10,
      category: 'Accessoires',
      sourceType: 'DROPSHIPPING',
      supplier: {
        productId: 'SKU-1',
        platform: 'manual',
        supplierPrice: 12000,
        shippingCost: 3500,
      },
      otherCosts: 500,
    },
    { quantity: 2 }
  );

  assert.equal(item.sourceType, 'DROPSHIPPING');
  assert.equal(item.supplierProductId, 'SKU-1');
  assert.equal(item.supplierPlatform, 'manual');
  assert.equal(item.vendorName, PLATFORM_VENDOR_NAME);
  assert.equal(item.price, 15600);
  assert.equal(isDropshippingProduct({ sourceType: 'DROPSHIPPING' }), true);
});
