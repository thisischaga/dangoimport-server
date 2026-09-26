const test = require('node:test');
const assert = require('node:assert/strict');
process.env.CJ_TRANSLATE_TO_FR = 'false';
const { mapCJProductToDangoProduct, buildExternalSourceKey } = require('../services/cj/cjMapper');
const { calculateSellingPrice } = require('../utils/dropshippingCalculations');
const { flattenListV2Products, normalizeListItem } = require('../services/cj/cjProductService');

test('repairCjDisplayPricing fixes USD price stored as XOF when platform is manual', () => {
  const { repairCjDisplayPricing } = require('../utils/cjCatalogHelpers');
  const product = {
    sourceType: 'DROPSHIPPING',
    price: 5,
    supplier: {
      platform: 'manual',
      name: 'CJdropshipping',
      supplierPrice: 5,
      supplierCurrency: 'USD',
      shippingCost: 0,
    },
    externalSourceKey: 'cj:1363726889776189440',
    importSourceType: 'MANUAL',
  };
  const repaired = repairCjDisplayPricing(product);
  assert.equal(repaired.supplier.platform, 'cj');
  assert.ok(repaired.price >= 3000, `expected FCFA price, got ${repaired.price}`);
});

test('buildExternalSourceKey uses cj prefix', () => {
  assert.equal(buildExternalSourceKey('123456789'), 'cj:123456789');
});

test('mapCJProductToDangoProduct normalizes pricing and variants', async () => {
  const mapped = await mapCJProductToDangoProduct(
    {
      externalProductId: 'pid-1',
      name: 'Test Watch',
      supplierPrice: 10,
      stock: 5,
      images: [{ url: 'https://img.example/a.jpg', isPrimary: true }],
    },
    {
      pid: 'pid-1',
      variants: [
        {
          vid: 'v1',
          variantNameEn: 'Black / XL',
          variantSellPrice: 10.5,
          variantInventory: 3,
          variantSku: 'SKU-BXL',
        },
      ],
    },
  );

  assert.equal(mapped.externalSourceKey, 'cj:pid-1');
  assert.equal(mapped.supplier.platform, 'cj');
  assert.equal(mapped.variants.length, 1);
  assert.equal(mapped.variants[0].attributes.externalVariantId, 'v1');
  assert.ok(mapped.pricing.sellingPrice > 1000);
});

test('calculateSellingPrice applies margin percent', () => {
  const price = calculateSellingPrice({
    supplierPrice: 100,
    shippingCost: 10,
    marginPercent: 30,
    otherCosts: 0,
  });
  assert.equal(price, Math.round((110 / 0.7) * 100) / 100);
});

test('flattenListV2Products extracts nested productList', () => {
  const raw = {
    data: {
      content: [
        { productList: [{ id: 'a', nameEn: 'A' }, { id: 'b', nameEn: 'B' }] },
        { productList: [{ id: 'c', nameEn: 'C' }] },
      ],
    },
  };
  const flat = flattenListV2Products(raw);
  assert.equal(flat.length, 3);
  const normalized = normalizeListItem(flat[0]);
  assert.equal(normalized.externalProductId, 'a');
  assert.equal(normalized.source, 'cj');
});

test('cj rate limiter serializes when max concurrent is 1', async () => {
  const { withRateLimit } = require('../services/cj/cjRateLimiter');
  const order = [];
  await Promise.all([
    withRateLimit(async () => { order.push(1); }),
    withRateLimit(async () => { order.push(2); }),
    withRateLimit(async () => { order.push(3); }),
  ]);
  assert.deepEqual(order, [1, 2, 3]);
});
