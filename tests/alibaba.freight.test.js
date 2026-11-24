const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_ALIBABA_FREIGHT_CONFIG,
  calculateAlibabaFreightQuote,
  inferFreightCategory,
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
  assert.equal(resolved.destinations.TG.air.categories.normal.initialRate, null);
});

test('keeps Benin and Togo freight rates independent and applies each destination tariff', () => {
  const resolved = config({
    destinations: {
      BJ: { air: { categories: { normal: { initialRate: 10000, discountPercent: 10 } } } },
      TG: { sea: { categories: { normal: { initialRate: 200000, discountPercent: 5 } } } },
    },
  });
  const beninQuote = calculateAlibabaFreightQuote([{
    quantity: 1,
    product: { name: 'Produit aérien', logistics: { grossWeight: 1, airCategory: 'normal' } },
  }], 'BJ', 'air', resolved);
  const togoQuote = calculateAlibabaFreightQuote([{
    quantity: 1,
    product: {
      name: 'Produit maritime',
      logistics: { seaCategory: 'normal', packageLength: 10, packageWidth: 10, packageHeight: 10, dimensionUnit: 'cm' },
    },
  }], 'TG', 'sea', resolved);

  assert.equal(beninQuote.cost, 9000);
  assert.equal(togoQuote.items[0].rate, 190000);
  assert.equal(togoQuote.cost, 190);
});

test('removes inherited default air rates from disabled Togo settings', () => {
  const legacyConfig = JSON.parse(JSON.stringify(DEFAULT_ALIBABA_FREIGHT_CONFIG));
  legacyConfig.destinations.TG.air.categories = JSON.parse(
    JSON.stringify(legacyConfig.destinations.BJ.air.categories),
  );

  const resolved = normalizeConfig(legacyConfig);
  assert.equal(resolved.destinations.TG.air.enabled, false);
  assert.equal(resolved.destinations.TG.air.categories.normal.initialRate, null);
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

test('automatically classifies common Alibaba product categories when no override is set', () => {
  const resolved = config();
  assert.equal(inferFreightCategory({ name: 'Samsung smartphone', logistics: {} }, 'air', resolved.destinations.BJ.air.categories), 'smartphone_tablet');
  assert.equal(inferFreightCategory({ name: 'Industrial sewing machine', logistics: {} }, 'sea', resolved.destinations.BJ.sea.categories), 'machine');
  assert.equal(inferFreightCategory({ name: 'Ordinary storage basket', logistics: {} }, 'sea', resolved.destinations.BJ.sea.categories), 'normal');
});

test('Togo maritime freight rejects missing dimensions instead of estimating volume', () => {
  const resolved = config();
  resolved.destinations.TG.sea.fallbackVolumeM3 = 0.01;
  assert.throws(
    () => calculateAlibabaFreightQuote([{
      quantity: 1,
      product: {
        _id: 'item-without-dimensions',
        name: 'Organisateur auto',
        logistics: {},
      },
    }], 'TG', undefined, resolved),
    (error) => error.code === 'IMPORT_PRODUCT_MEASUREMENTS_REQUIRED',
  );

  const measuredQuote = calculateAlibabaFreightQuote([{
    quantity: 1,
    product: {
      name: 'Produit avec dimensions',
      logistics: {
        packageLength: 20,
        packageWidth: 10,
        packageHeight: 5,
        dimensionUnit: 'cm',
      },
    },
  }], 'TG', undefined, resolved);

  assert.equal(measuredQuote.totalVolumeM3, 0.001);
  assert.equal(measuredQuote.cost, 176);
});

test('freight reads explicit product volume and kilogram fields', () => {
  const resolved = config();
  const seaQuote = calculateAlibabaFreightQuote([{
    quantity: 1,
    product: { name: 'Produit dimensionné', volumeM3: 0.002 },
  }], 'TG', 'sea', resolved);
  const airQuote = calculateAlibabaFreightQuote([{
    quantity: 1,
    product: { name: 'Produit lourd', weightKg: 35 },
  }], 'BJ', 'air', resolved);

  assert.equal(seaQuote.totalVolumeM3, 0.002);
  assert.equal(seaQuote.cost, 353);
  assert.equal(airQuote.billableWeightKg, 35);
  assert.equal(airQuote.cost, 308700);
});

test('freight reads Alibaba gross weight and package size from nested key attributes', () => {
  const resolved = config();
  const product = {
    name: 'Produit Alibaba avec attributs',
    rawSections: {
      keyAttributes: {
        attributes: [{
          attributes: [
            { name: 'Single gross weight', values: [{ value: '0.042 KG' }] },
            { name: 'Single package size', values: [{ value: '5 x 5 x 5 cm' }] },
          ],
        }],
      },
    },
  };
  const seaQuote = calculateAlibabaFreightQuote([{ product, quantity: 1 }], 'BJ', 'sea', resolved);
  const airQuote = calculateAlibabaFreightQuote([{ product, quantity: 1 }], 'BJ', 'air', resolved);

  assert.equal(seaQuote.totalVolumeM3, 0.000125);
  assert.equal(seaQuote.cost, 31);
  assert.equal(airQuote.items[0].actualWeightKg, 0.042);
  assert.equal(airQuote.billableWeightKg, 1);
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
