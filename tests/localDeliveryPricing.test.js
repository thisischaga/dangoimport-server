const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEFAULT_LOCAL_DELIVERY_CONFIG,
  calculateLocalDeliveryQuote,
  normalizeLocalDeliveryConfig,
} = require('../services/localDeliveryPricingService');

const config = normalizeLocalDeliveryConfig(DEFAULT_LOCAL_DELIVERY_CONFIG);
const destination = { countryCode: 'BJ', city: 'Cotonou', district: 'centre-ville' };

test('uses stored weight and volume for any city or district without a manual parcel profile', () => {
  const quote = calculateLocalDeliveryQuote({
    lines: [{
      quantity: 1,
      product: { name: 'Produit S', logistics: { weight: 2, weightUnit: 'kg', volumeCm3: 27000 } },
    }],
    countryCode: 'BJ',
    city: 'Ville hors grille',
    district: 'Quartier hors grille',
    config,
  });

  assert.equal(quote.zoneName, 'Tarif national Bénin');
  assert.equal(quote.category, 'S');
  assert.equal(quote.fee, 1000);
});

test('uses admin-configured country rates and rejects unsupported countries', () => {
  const customConfig = normalizeLocalDeliveryConfig({
    ...config,
    countryRates: {
      ...config.countryRates,
      BJ: { ...config.countryRates.BJ, S: 1750 },
    },
  });
  const quote = calculateLocalDeliveryQuote({
    lines: [{ product: { logistics: { weight: 2, weightUnit: 'kg', volumeCm3: 27000 } } }],
    countryCode: 'BJ',
    city: 'Toute ville',
    district: 'Tout quartier',
    config: customConfig,
  });
  assert.equal(quote.fee, 1750);
  assert.throws(
    () => calculateLocalDeliveryQuote({
      lines: [{ product: { logistics: { weight: 2, weightUnit: 'kg', volumeCm3: 27000 } } }],
      countryCode: 'XX',
      config: customConfig,
    }),
    (error) => error.code === 'LOCAL_DELIVERY_COUNTRY_UNSUPPORTED',
  );
});

test('classifies the whole basket from stored weight and volume without dimensions', () => {
  const quote = calculateLocalDeliveryQuote({
    lines: [{
      quantity: 1,
      product: { name: 'Colis moyen', logistics: { grossWeight: 6, weightUnit: 'kg', volumeCm3: 30000 } },
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
      { quantity: 2, product: { logistics: { grossWeight: 1, weightUnit: 'kg', volumeCm3: 10000, fragile: true } } },
      { quantity: 1, product: { logistics: { grossWeight: 2, weightUnit: 'kg', volumeCm3: 10000, fragile: true } } },
    ],
    ...destination,
    config,
  });

  assert.equal(quote.fragileSurcharge, 300);
  assert.equal(quote.fee, 1300);
});

test('requires a quote when the parcel category has no country tariff', () => {
  assert.throws(
    () => calculateLocalDeliveryQuote({
      ...destination,
      lines: [{ product: { logistics: { grossWeight: 31, weightUnit: 'kg', volumeCm3: 310000 } } }],
      config,
    }),
    (error) => error.code === 'LOCAL_DELIVERY_QUOTE_REQUIRED',
  );
});

test('reports product rows with missing stored weight or volume', () => {
  assert.throws(
    () => calculateLocalDeliveryQuote({
      lines: [{
        product: { name: 'Produit sans volume', logistics: { weight: 1, weightUnit: 'kg' } },
      }],
      ...destination,
      config,
    }),
    (error) => error.code === 'LOCAL_DELIVERY_MEASUREMENTS_REQUIRED'
      && error.message.includes('Produit sans volume'),
  );
});
