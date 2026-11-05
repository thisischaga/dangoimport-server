const test = require('node:test');
const assert = require('node:assert/strict');

const Product = require('../Models/Product');
const AlibabaProduct = require('../Models/AlibabaProduct');
const {
  mapAlibabaProductForAdmin,
  deleteImportedProduct,
} = require('../Controllers/alibabaSupplierController');

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

test('mapAlibabaProductForAdmin uses rawAlibaba payload as fallback for description, gallery and specs', () => {
  const raw = {
    _id: '67f000000000000000000002',
    source: 'ALIBABA',
    sourceProductId: 'abc-456',
    description: '',
    images: [],
    rawPayload: {
      description: 'Description détaillée du produit Alibaba.',
      images: [{ url: 'https://example.com/a.jpg' }, { url: 'https://example.com/b.jpg' }],
      keyAttributes: {
        attributes: [
          { attr_name_desc: 'Couleur', attr_value_desc: 'Noir' },
          { attr_name_desc: 'Matériau', attr_value_desc: 'Coton' },
        ],
      },
    },
    status: 'IMPORTED',
    isPublished: false,
    supplier: { name: 'Alibaba' },
    pricing: { sourcePrice: 150 },
    normalized: { pricing: { sellingPrice: 220 } },
  };

  const product = mapAlibabaProductForAdmin(raw);

  assert.equal(product.description, 'Description détaillée du produit Alibaba.');
  assert.equal(product.images.length, 2);
  assert.deepEqual(product.specifications[0], { key: 'Couleur', value: 'Noir' });
  assert.equal(product.supplier.productId, 'abc-456');
});

test('mapAlibabaProductForAdmin unwraps single-item arrays from Alibaba raw payloads', () => {
  const raw = {
    _id: '67f000000000000000000003',
    source: 'ALIBABA',
    sourceProductId: 'abc-789',
    description: '',
    images: [],
    rawPayload: [{
      description: 'Produit compact et premium.',
      images: [{ url: 'https://example.com/c.jpg' }],
      keyAttributes: {
        attributes: [{ attr_name_desc: 'Couleur', attr_value_desc: 'Blanc' }],
      },
    }],
    status: 'IMPORTED',
    isPublished: false,
    supplier: { name: 'Alibaba' },
    pricing: { sourcePrice: 200 },
    normalized: { pricing: { sellingPrice: 260 } },
  };

  const product = mapAlibabaProductForAdmin(raw);
  assert.equal(product.description, 'Produit compact et premium.');
  assert.equal(product.images.length, 1);
  assert.equal(product.specifications[0].key, 'Couleur');
  assert.equal(product.specifications[0].value, 'Blanc');
});

test('deleteImportedProduct keeps the Alibaba flow strictly on AlibabaProduct without Product fallback', async () => {
  const originalDeleteMany = Product.deleteMany;
  const originalFindOne = AlibabaProduct.findOne;
  const originalDeleteById = AlibabaProduct.findByIdAndDelete;
  const originalFindOneAndDelete = AlibabaProduct.findOneAndDelete;

  const calls = [];

  Product.deleteMany = async (...args) => {
    calls.push('Product.deleteMany');
    return { deletedCount: 1, ...args };
  };

  AlibabaProduct.findOne = async (...args) => {
    calls.push('AlibabaProduct.findOne');
    return { _id: '67f000000000000000000004', source: 'ALIBABA', sourceProductId: 'abc-101' };
  };

  AlibabaProduct.findByIdAndDelete = async (...args) => {
    calls.push('AlibabaProduct.findByIdAndDelete');
    return { _id: args[0], source: 'ALIBABA' };
  };

  AlibabaProduct.findOneAndDelete = async (...args) => {
    calls.push('AlibabaProduct.findOneAndDelete');
    return { _id: 'mongo-override', source: 'ALIBABA' };
  };

  try {
    const response = { json: () => {}, status: () => response };
    await deleteImportedProduct({ params: { id: 'abc-101' } }, response);
    assert.deepEqual(calls, ['AlibabaProduct.findOne', 'AlibabaProduct.findByIdAndDelete']);
  } finally {
    Product.deleteMany = originalDeleteMany;
    AlibabaProduct.findOne = originalFindOne;
    AlibabaProduct.findByIdAndDelete = originalDeleteById;
    AlibabaProduct.findOneAndDelete = originalFindOneAndDelete;
  }
});
