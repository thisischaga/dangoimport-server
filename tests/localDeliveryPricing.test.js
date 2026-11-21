const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEFAULT_LOCAL_DELIVERY_CONFIG,
  calculateLocalDeliveryQuote,
  normalizeLocalDeliveryConfig,
} = require('../services/localDeliveryPricingService');

const config = normalizeLocalDeliveryConfig(DEFAULT_LOCAL_DELIVERY_CONFIG);
const destination = { countryCode: 'BJ', city: 'Cotonou', district: 'centre-ville' };

test('calculates the local rate for a configured zone and explicit parcel profile', () => {
  const quote = calculateLocalDeliveryQuote({
    lines: [{ quantity: 1, product: { name: 'Produit S', logistics: { localDeliveryProfile: 'S' } } }],
    ...destination,
    config,
  });

  assert.equal(quote.zoneName, 'Cotonou centre');
  assert.equal(quote.category, 'S');
  assert.equal(quote.fee, 1000);
});

test('classifies the whole measured basket from weight and dimensions', () => {
  const quote = calculateLocalDeliveryQuote({
    lines: [{
      quantity: 1,
      product: { name: 'Colis moyen', logistics: { grossWeight: 6, packageLength: 50, packageWidth: 10, packageHeight: 10, dimensionUnit: 'cm' } },
    }],
    ...destination,
    config,
  });

  assert.equal(quote.category, 'M');
  assert.equal(quote.fee, 1500);
});

test('adds the configured fragile handling charge once per basket', () => {
  const quote = calculateLocalDeliveryQuote({
    lines: [
      { quantity: 2, product: { logistics: { localDeliveryProfile: 'S', fragile: true } } },
      { quantity: 1, product: { logistics: { localDeliveryProfile: 'S', fragile: true } } },
    ],
    ...destination,
    config,
  });

  assert.equal(quote.fragileSurcharge, 300);
  assert.equal(quote.fee, 1300);
});

test('requires a quote when a destination or parcel category has no configured tariff', () => {
  assert.throws(
    () => calculateLocalDeliveryQuote({
      lines: [{ product: { logistics: { localDeliveryProfile: 'S' } } }],
      ...destination,
      district: 'destination hors grille',
      config,
    }),
    (error) => error.code === 'LOCAL_DELIVERY_QUOTE_REQUIRED',
  );
  assert.throws(
    () => calculateLocalDeliveryQuote({
      lines: [{ product: { logistics: { localDeliveryProfile: 'XL' } } }],
      ...destination,
      config,
    }),
    (error) => error.code === 'LOCAL_DELIVERY_QUOTE_REQUIRED',
  );
});

test('does not estimate a local category when both a profile and reliable measurements are missing', () => {
  assert.throws(
    () => calculateLocalDeliveryQuote({
      lines: [{ product: { name: 'Données manquantes', logistics: {} } }],
      ...destination,
      config,
    }),
    (error) => error.code === 'LOCAL_DELIVERY_PROFILE_REQUIRED',
  );
});
