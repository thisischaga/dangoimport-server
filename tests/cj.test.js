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

test('prepareDropshippingProductForPublic restores gallery and sellable stock', () => {
  const { prepareDropshippingProductForPublic } = require('../utils/cjCatalogHelpers');
  const product = {
    sourceType: 'DROPSHIPPING',
    name: 'Winter Cardigan',
    price: 4500,
    stock: 0,
    category: 'Général',
    subCategory: "Women's Clothing",
    image: '["https://cf.cjdropshipping.com/a.jpg","https://cf.cjdropshipping.com/b.jpg"',
    images: [],
    supplier: {
      platform: 'manual',
      name: 'CJdropshipping',
      supplierPrice: 5,
      supplierCurrency: 'USD',
      estimatedDeliveryDays: 12,
    },
    externalSourceKey: 'cj:123',
  };
  const pub = prepareDropshippingProductForPublic(product);
  assert.ok(pub.images.length >= 2);
  assert.equal(pub.stock, 0);
  assert.equal(pub.category, 'Mode & Vêtements');
  assert.equal(pub.estimatedDeliveryDays, 12);
  assert.match(pub.shippingInfo, /12/);
});

test('resolveDropshipSellableStock uses DB stock when variants are zero', () => {
  const { resolveDropshipSellableStock, prepareDropshippingProductForPublic } = require('../utils/cjCatalogHelpers');
  const product = {
    sourceType: 'DROPSHIPPING',
    stock: 240,
    variants: [{ name: 'A', stock: 0 }, { name: 'B', stock: 0 }],
    supplier: { platform: 'cj', name: 'CJdropshipping', warehouseInventories: [{ quantity: 0 }] },
    price: 5000,
    externalSourceKey: 'cj:999',
  };
  assert.equal(resolveDropshipSellableStock(product), 240);
  const pub = prepareDropshippingProductForPublic(product);
  assert.equal(pub.stock, 240);
  assert.equal(pub.variants[0].stock, 240);
});

test('parseCjStockAndShippingOrigin reads warehouse inventory', () => {
  const { parseCjStockAndShippingOrigin } = require('../services/cj/cjInventoryService');
  const result = parseCjStockAndShippingOrigin({
    detail: { supplierName: 'Shenzhen Textile Co.', warehouseInventoryNum: 10 },
    inventoryPayload: {
      inventories: [{
        countryCode: 'CN',
        areaEn: 'China Warehouse',
        totalInventoryNum: 264,
      }],
    },
  });
  assert.equal(result.stock, 264);
  assert.equal(result.shipFromCountryCode, 'CN');
  assert.equal(result.manufacturerName, 'Shenzhen Textile Co.');
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
