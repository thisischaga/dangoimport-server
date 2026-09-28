const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateImportPricing } = require('../utils/importPricing');
const { DANGO_TRANSIT_OPTION_ID } = require('../services/dropshippingCheckoutService');
const { toPublicProduct } = require('../utils/publicProduct');

test('Test 1: 20000 FCFA, 0.5 kg → 26000 + 53000 = 79000', () => {
  const pricing = calculateImportPricing({
    supplier: { supplierPrice: 20000, supplierCurrency: 'XOF' },
    convertedSupplierPriceFCFA: 20000,
    weight: 0.5,
    shippingCategory: 'normal',
  });
  assert.equal(pricing.productPrice, 26000);
  assert.equal(pricing.shipping.ratePerKg, 100000);
  assert.equal(pricing.shippingBaseCost, 50000);
  assert.equal(pricing.shippingMarkup, 3000);
  assert.equal(pricing.shippingCost, 53000);
  assert.equal(pricing.total, 79000);
});

test('Test 2: 10000 FCFA, 1 kg, telephone → 13000 + 103000 = 116000', () => {
  const pricing = calculateImportPricing({
    supplier: { supplierPrice: 10000, supplierCurrency: 'XOF' },
    convertedSupplierPriceFCFA: 10000,
    weight: 1,
    shippingCategory: 'telephone',
  });
  assert.equal(pricing.productPrice, 13000);
  assert.equal(pricing.shippingCost, 103000);
  assert.equal(pricing.total, 116000);
});

test('Test 3: order snapshot keeps old transit rate after config change', () => {
  const product = {
    supplier: { supplierPrice: 20000, supplierCurrency: 'XOF' },
    convertedSupplierPriceFCFA: 20000,
    weight: 0.5,
    shippingCategory: 'normal',
  };
  const snapshot = calculateImportPricing(product);
  const later = calculateImportPricing(product, {
    config: {
      shippingRates: { normal: { ratePerKg: 120000, minDays: 20, maxDays: 30 } },
    },
  });
  assert.equal(snapshot.shippingCost, 53000);
  assert.equal(later.shippingCost, 63000);
  assert.notEqual(snapshot.shippingCost, later.shippingCost);
});

test('Test 4: client transit option is not a CJ shipping method', () => {
  assert.equal(DANGO_TRANSIT_OPTION_ID, 'dango-import:transit');
  assert.equal(DANGO_TRANSIT_OPTION_ID.startsWith('cj:'), false);
});

test('Test 5: public product card price excludes import fees', () => {
  const publicProduct = toPublicProduct({
    _id: '64abc12345678901234567890',
    name: 'Montre',
    price: 999999,
    sourceType: 'DROPSHIPPING',
    convertedSupplierPriceFCFA: 20000,
    supplier: { supplierPrice: 20000, supplierCurrency: 'XOF' },
    weight: 0.5,
    shippingCategory: 'normal',
  });
  assert.equal(publicProduct.price, 26000);
  assert.equal(publicProduct.importFeesAtCheckout, true);
  assert.ok(publicProduct.price < 79000);
});
