const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateImportPricing, calculateImportQuote, parseProductWeightKg } = require('../utils/importPricing');
const { DANGO_TRANSIT_OPTION_ID } = require('../services/dropshippingCheckoutService');
const { toPublicProduct } = require('../utils/publicProduct');

test('Test 1: 20000 FCFA, 0.5 kg → 26000 + 8000 = 34000', () => {
  const pricing = calculateImportPricing({
    supplier: { supplierPrice: 20000, supplierCurrency: 'XOF' },
    convertedSupplierPriceFCFA: 20000,
    weight: 0.5,
    shippingCategory: 'normal',
  });
  assert.equal(pricing.productPrice, 26000);
  assert.equal(pricing.shipping.ratePerKg, 10000);
  assert.equal(pricing.shippingBaseCost, 5000);
  assert.equal(pricing.shippingMarkup, 3000);
  assert.equal(pricing.shippingCost, 8000);
  assert.equal(pricing.total, 34000);
});

test('Test 2: 10000 FCFA, 1 kg, telephone → 13000 + 13000 = 26000', () => {
  const pricing = calculateImportPricing({
    supplier: { supplierPrice: 10000, supplierCurrency: 'XOF' },
    convertedSupplierPriceFCFA: 10000,
    weight: 1,
    shippingCategory: 'telephone',
  });
  assert.equal(pricing.productPrice, 13000);
  assert.equal(pricing.shippingCost, 13000);
  assert.equal(pricing.total, 26000);
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
      shippingRates: { normal: { ratePerKg: 12000, minDays: 20, maxDays: 30 } },
    },
  });
  assert.equal(snapshot.shippingCost, 8000);
  assert.equal(later.shippingCost, 9000);
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
  assert.ok(publicProduct.price < 34000);
});

test('parses CJ gram weights and specification Poids', () => {
  assert.equal(parseProductWeightKg({ weight: '350' }), 0.35);
  assert.equal(parseProductWeightKg({ weight: '350 g' }), 0.35);
  assert.equal(parseProductWeightKg({
    weight: '',
    specifications: [{ key: 'Poids', value: '800 g' }],
  }), 0.8);
  assert.equal(parseProductWeightKg({ weight: '1.2 kg' }), 1.2);
});

test('grouped cart sums kg then applies 10000/kg + one 3000 markup', () => {
  const quote = calculateImportQuote([
    {
      quantity: 2,
      product: {
        supplier: { supplierPrice: 20000, supplierCurrency: 'XOF' },
        convertedSupplierPriceFCFA: 20000,
        weight: '400 g',
      },
    },
    {
      quantity: 1,
      product: {
        supplier: { supplierPrice: 10000, supplierCurrency: 'XOF' },
        convertedSupplierPriceFCFA: 10000,
        weight: 0.3,
      },
    },
  ]);
  assert.equal(quote.billedWeight, 1.1);
  assert.equal(quote.shippingBaseCost, 11000);
  assert.equal(quote.shippingMarkup, 3000);
  assert.equal(quote.shippingCost, 14000);
  assert.equal(quote.productTotal, 65000);
  assert.equal(quote.total, 79000);
});

