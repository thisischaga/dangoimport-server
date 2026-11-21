const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_ALIBABA_FREIGHT_CONFIG,
  calculateAlibabaFreightQuote,
  normalizeConfig,
} = require('../services/alibaba/alibabaFreightService');

function config(overrides = {}) {
  return normalizeConfig({
    destinations: {
      BJ: {
        defaultMode: 'air',
        air: { enabled: true },
        sea: { enabled: true },
      },
      TG: {
        defaultMode: 'sea',
        air: { enabled: false },
        sea: { enabled: true },
      },
      ...overrides.destinations,
    },
    volumetric: overrides.volumetric || {},
  });
}

test('InterCargo defaults retain the Dango discounted destination tariffs', () => {
  const resolved = config();
  assert.equal(resolved.destinations.BJ.sea.categories.normal.rate, 249900);
  assert.equal(resolved.destinations.TG.sea.categories.normal.rate, 176400);
  assert.equal(resolved.destinations.BJ.air.categories.normal.rate, 8820);
  assert.equal(resolved.destinations.BJ.air.categories.smartphone_tablet.rate, 14700);
  assert.equal(resolved.destinations.TG.air.enabled, false);
});

test('maritime freight uses configured category, volume, and destination rate', () => {
  const resolved = config();
  const quote = calculateAlibabaFreightQuote([{
    quantity: 2,
    product: {
      _id: 'item-1',
      name: 'Verres',
      logistics: {
        seaCategory: 'fragile',
        packageLength: 100,
        packageWidth: 100,
        packageHeight: 100,
        dimensionUnit: 'cm',
      },
    },
  }], 'BJ', 'sea', resolved);

  assert.equal(quote.cost, 588000);
  assert.equal(quote.items[0].category, 'fragile');
  assert.equal(quote.storageDays, 60);
});

test('air volumetric billing remains opt-in and applies the configured method and rounding', () => {
  const resolved = config({
    volumetric: { enabled: true, coefficient: 167, method: 'max', roundingMode: 'ceil', roundingIncrementKg: 1 },
  });
  const quote = calculateAlibabaFreightQuote([{
    quantity: 1,
    product: {
      name: 'Sac',
      logistics: {
        grossWeight: 1,
        packageLength: 100,
        packageWidth: 100,
        packageHeight: 100,
        dimensionUnit: 'cm',
        airCategory: 'normal',
        volumetricEnabled: true,
      },
    },
  }], 'BJ', 'air', resolved);

  assert.equal(quote.items[0].volumetricWeightKg, 167);
  assert.equal(quote.items[0].billableWeightKg, 167);
  assert.equal(quote.cost, 1472940);
});

test('unavailable modes, missing measures, and unavailable defaults are rejected', () => {
  const resolved = config();
  assert.throws(
    () => calculateAlibabaFreightQuote([{ product: { logistics: {} }, quantity: 1 }], 'TG', 'air', resolved),
    /temporairement indisponible/,
  );
  assert.throws(
    () => calculateAlibabaFreightQuote([{ product: { logistics: {} }, quantity: 1 }], 'BJ', 'sea', resolved),
    /Dimensions manquantes/,
  );
  assert.throws(
    () => normalizeConfig({
      ...DEFAULT_ALIBABA_FREIGHT_CONFIG,
      destinations: {
        TG: { defaultMode: 'air', air: { enabled: false }, sea: { enabled: true } },
      },
    }),
    /mode par défaut doit être disponible/,
  );
});
