const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateImportPricing,
  calculateImportQuote,
  calculateImportOrderPricing,
  parseProductWeightKg,
} = require('../utils/importPricing');
const { DANGO_TRANSIT_OPTION_ID } = require('../services/dropshippingCheckoutService');
const { toPublicProduct } = require('../utils/publicProduct');

test('prix carte : 20000 × 1.30 = 26000, hors import', () => {
  const pricing = calculateImportPricing({
    supplier: { supplierPrice: 20000, supplierCurrency: 'XOF' },
    convertedSupplierPriceFCFA: 20000,
    weight: 0.5,
    shippingCategory: 'normal',
  });
  assert.equal(pricing.productPrice, 26000);
  assert.equal(pricing.shipping.ratePerKg, 13500);
  assert.equal(pricing.shippingCost, 6750);
  assert.equal(pricing.shippingMarkup, 0);
  assert.equal(pricing.total, 32750);
});

test('pas de plancher 1000 FCFA : 500 × 1.30 = 650', () => {
  const pricing = calculateImportPricing({
    supplier: { supplierPrice: 500, supplierCurrency: 'XOF' },
    convertedSupplierPriceFCFA: 500,
    weight: 0.1,
  });
  assert.equal(pricing.unitPrice, 650);
  assert.equal(pricing.productPrice, 650);
});

test('800 × 1.30 = 1040 reste 1040', () => {
  const pricing = calculateImportPricing({
    supplier: { supplierPrice: 800, supplierCurrency: 'XOF' },
    convertedSupplierPriceFCFA: 800,
  });
  assert.equal(pricing.unitPrice, 1040);
});

test('MOQ 5 : pack = (1200 × 5) × 1.30 = 7800, unité 1560', () => {
  const pricing = calculateImportPricing({
    supplier: { supplierPrice: 1200, supplierCurrency: 'XOF' },
    convertedSupplierPriceFCFA: 1200,
    minimumOrderQuantity: 5,
    quantityIncrement: 5,
    weight: 0.25,
  });
  assert.equal(pricing.unitPrice, 1560);
  assert.equal(pricing.packSize, 5);
  assert.equal(pricing.packPrice, 7800);
  assert.equal(pricing.soldAsLot, true);
});

test('produit < 1 kg et < 2000 F : MOQ auto (100 g → 10)', () => {
  const pricing = calculateImportPricing({
    supplier: { supplierPrice: 1200, supplierCurrency: 'XOF' },
    convertedSupplierPriceFCFA: 1200,
    weight: 0.1,
  });
  assert.equal(pricing.minimumOrderQuantity, 10);
  assert.equal(pricing.quantityIncrement, 10);
  assert.equal(pricing.packSize, 10);
  assert.equal(pricing.packPrice, 15600);
});

test('produit < 1 kg mais ≥ 2000 F : pas de MOQ auto', () => {
  const pricing = calculateImportPricing({
    convertedSupplierPriceFCFA: 2000,
    weight: 0.2,
  });
  assert.equal(pricing.unitPrice, 2600);
  assert.equal(pricing.minimumOrderQuantity, 1);
  assert.equal(pricing.packSize, 1);
});

test('checkout MOQ 5 : 7800 + 1.25 kg × 13500', () => {
  const quote = calculateImportOrderPricing([
    {
      quantity: 5,
      product: {
        name: 'Lot',
        supplier: { supplierPrice: 1200, supplierCurrency: 'XOF' },
        convertedSupplierPriceFCFA: 1200,
        minimumOrderQuantity: 5,
        quantityIncrement: 5,
        weight: 0.25,
      },
    },
  ]);
  assert.equal(quote.itemsTotal, 7800);
  assert.equal(quote.totalWeightKg, 1.25);
  assert.equal(quote.shippingCost, 16875);
  assert.equal(quote.total, 24675);
});

test('quantité 4 refusée si MOQ 5', () => {
  assert.throws(() => calculateImportOrderPricing([
    {
      quantity: 4,
      product: {
        name: 'Lot',
        minimumOrderQuantity: 5,
        quantityIncrement: 5,
        convertedSupplierPriceFCFA: 1200,
      },
    },
  ]), /lots de 5|minimale/i);
});

test('quantité 6 refusée si increment 5, 10 autorisée', () => {
  const product = {
    name: 'Lot',
    minimumOrderQuantity: 5,
    quantityIncrement: 5,
    convertedSupplierPriceFCFA: 1200,
    weight: 0.1,
  };
  assert.throws(() => calculateImportOrderPricing([{ quantity: 6, product }]));
  const quote = calculateImportOrderPricing([{ quantity: 10, product }]);
  assert.equal(quote.items[0].quantity, 10);
  assert.equal(quote.itemsTotal, 15600);
});

test('snapshot tarif inchangé si config change ensuite', () => {
  const product = {
    supplier: { supplierPrice: 20000, supplierCurrency: 'XOF' },
    convertedSupplierPriceFCFA: 20000,
    weight: 0.5,
  };
  const snapshot = calculateImportPricing(product);
  const later = calculateImportPricing(product, {
    config: { shippingRatePerKg: 20000 },
  });
  assert.equal(snapshot.shippingCost, 6750);
  assert.equal(later.shippingCost, 10000);
  assert.notEqual(snapshot.shippingCost, later.shippingCost);
});

test('option transit client n’est pas une méthode CJ', () => {
  assert.equal(DANGO_TRANSIT_OPTION_ID, 'dango-import:transit');
  assert.equal(DANGO_TRANSIT_OPTION_ID.startsWith('cj:'), false);
});

test('prix public hors frais d’import, pack MOQ exposé', () => {
  const publicProduct = toPublicProduct({
    _id: '64abc12345678901234567890',
    name: 'Montre',
    price: 999999,
    sourceType: 'DROPSHIPPING',
    convertedSupplierPriceFCFA: 20000,
    supplier: { supplierPrice: 20000, supplierCurrency: 'XOF' },
    weight: 0.5,
  });
  assert.equal(publicProduct.price, 26000);
  assert.equal(publicProduct.importFeesAtCheckout, true);
  assert.ok(publicProduct.price < 32750);
});

test('poids CJ en grammes et spec Poids', () => {
  assert.equal(parseProductWeightKg({ weight: '350' }), 0.35);
  assert.equal(parseProductWeightKg({ weight: '350 g' }), 0.35);
  assert.equal(parseProductWeightKg({
    weight: '',
    specifications: [{ key: 'Poids', value: '800 g' }],
  }), 0.8);
  assert.equal(parseProductWeightKg({
    weight: '0.5',
    specifications: [{ key: 'Poids', value: '80 g' }],
  }), 0.08);
  assert.equal(parseProductWeightKg({ weight: '1.2 kg' }), 1.2);
});

test('panier groupé : somme des kg × 13500, sans majoration 1.30', () => {
  const quote = calculateImportQuote([
    {
      quantity: 2,
      product: {
        supplier: { supplierPrice: 20000, supplierCurrency: 'XOF' },
        convertedSupplierPriceFCFA: 20000,
        weight: 1,
      },
    },
    {
      quantity: 1,
      product: {
        supplier: { supplierPrice: 10000, supplierCurrency: 'XOF' },
        convertedSupplierPriceFCFA: 10000,
        weight: 1.1,
      },
    },
  ]);
  assert.equal(quote.billedWeight, 3.1);
  assert.equal(quote.shippingMarkup, 0);
  assert.equal(quote.shippingCost, 41850);
  assert.equal(quote.productTotal, 65000);
  assert.equal(quote.total, 106850);
});

test('multi-produits : poids regroupé après MOQ auto < 1 kg', () => {
  const quote = calculateImportOrderPricing([
    {
      quantity: 10,
      product: {
        convertedSupplierPriceFCFA: 1200,
        weight: 0.1,
      },
    },
    {
      quantity: 4,
      product: {
        convertedSupplierPriceFCFA: 5000,
        weight: 0.3,
      },
    },
    {
      quantity: 20,
      product: {
        convertedSupplierPriceFCFA: 800,
        weight: 0.05,
      },
    },
  ]);
  assert.equal(quote.totalWeightKg, 3.2);
  assert.equal(quote.shippingCost, 43200);
});
