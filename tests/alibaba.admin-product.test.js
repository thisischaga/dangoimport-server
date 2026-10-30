const test = require('node:test');
const assert = require('node:assert/strict');

const { mapAlibabaProductForAdmin } = require('../Controllers/alibabaSupplierController');

test('mapAlibabaProductForAdmin keeps canonical supplier fields compatible with the admin UI', () => {
  const raw = {
    _id: '67f000000000000000000001',
    source: 'ALIBABA',
    sourceProductId: 'abc-123',
    name: 'Smart Watch Pro',
    category: 'Électronique',
    brand: 'Dango',
    mainImage: 'https://example.com/main.jpg',
    images: [{ url: 'https://example.com/1.jpg' }, { url: 'https://example.com/2.jpg' }],
    pricing: {
      sourcePrice: 900,
      currency: 'USD',
      tiers: [{ minQuantity: 5, maxQuantity: 20, price: 850, currency: 'USD' }],
    },
    normalized: {
      category: 'Électronique',
      brand: 'Dango',
      pricing: { sellingPrice: 1200 },
    },
    status: 'IMPORTED',
    isPublished: false,
    importWarnings: [{ message: 'X' }],
    importErrors: [],
    supplier: { name: 'Alibaba' },
    rawPayload: { ok: true },
  };

  const product = mapAlibabaProductForAdmin(raw);

  assert.equal(product.sourceProductId, 'abc-123');
  assert.equal(product.image, 'https://example.com/main.jpg');
  assert.equal(product.price, 1200);
  assert.equal(product.category, 'Électronique');
  assert.equal(product.supplier.productId, 'abc-123');
  assert.equal(product.sourcePriceTiers[0].minQty, 5);
  assert.equal(product.importStatus, 'IMPORTED');
  assert.equal(product.rawAlibabaData.ok, true);
});
