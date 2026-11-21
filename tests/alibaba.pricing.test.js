const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_ALIBABA_CONFIG,
  calculateAlibabaPrice,
  calculateAlibabaVolumeCm3,
  normalizeAlibabaConfig,
} = require('../services/alibaba/alibabaPricingService');

test('Alibaba price calculation uses configured USD rate and applies one general margin', () => {
  const result = calculateAlibabaPrice({
    sourcePrice: 10,
    currency: 'USD',
    config: {
      ...DEFAULT_ALIBABA_CONFIG,
      usdToXofRate: 600,
      generalMarginPercent: 30,
    },
  });

  assert.equal(result.convertedSupplierPrice, 6000);
  assert.equal(result.salePrice, 7800);
  assert.equal(result.marginSource, 'general');
});

test('Alibaba product margin overrides category margin, which overrides general margin', () => {
  const config = {
    ...DEFAULT_ALIBABA_CONFIG,
    usdToXofRate: 600,
    generalMarginPercent: 30,
    categoryMargins: { Montres: 20 },
  };
  const categoryResult = calculateAlibabaPrice({ sourcePrice: 10, currency: 'USD', category: 'Montres', config });
  const productResult = calculateAlibabaPrice({
    sourcePrice: 10,
    currency: 'USD',
    category: 'Montres',
    productMarginPercent: 10,
    config,
  });

  assert.equal(categoryResult.salePrice, 7200);
  assert.equal(categoryResult.marginSource, 'category');
  assert.equal(productResult.salePrice, 6600);
  assert.equal(productResult.marginSource, 'product');
});

test('Alibaba CNY pricing, safety margin, rounding, and minimum price use configured rules', () => {
  const result = calculateAlibabaPrice({
    sourcePrice: 72.1,
    currency: 'CNY',
    config: {
      ...DEFAULT_ALIBABA_CONFIG,
      cnyToUsdRate: 7.2,
      usdToXofRate: 600,
      rateSafetyMarginPercent: 5,
      generalMarginPercent: 0,
      minimumSalePrice: 5000,
      roundingMode: 'up',
      roundingIncrement: 100,
    },
  });

  assert.equal(result.supplierPriceUsd, 10.0139);
  assert.equal(result.convertedSupplierPrice, 6309);
  assert.equal(result.salePrice, 6400);
  assert.equal(calculateAlibabaVolumeCm3({ length: 10, width: 20, height: 30, unit: 'cm' }), 6000);
  assert.equal(calculateAlibabaVolumeCm3({ length: 100, width: 200, height: 300, unit: 'mm' }), 6000);
});

test('Alibaba configuration validation rejects invalid rates and margin values', () => {
  assert.throws(() => normalizeAlibabaConfig({ ...DEFAULT_ALIBABA_CONFIG, usdToXofRate: 0 }), /usdToXofRate/);
  assert.throws(() => normalizeAlibabaConfig({ ...DEFAULT_ALIBABA_CONFIG, generalMarginPercent: 501 }), /generalMarginPercent/);
});
