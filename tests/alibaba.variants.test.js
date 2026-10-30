const test = require('node:test');
const assert = require('node:assert/strict');
const { mapAlibabaProductToDango, mapToDropshippingPayload } = require('../services/alibaba/alibabaMapper');
const { buildAlibabaProductRecord } = require('../services/alibaba/alibabaImportService');
const { toPublicProduct } = require('../utils/publicProduct');
const { resolveDropshipSellableStock } = require('../utils/cjCatalogHelpers');

test('mapAlibabaProductToDango extracts attributes when skuName is present or absent', async () => {
  const mockDetail = {
    offerId: '600123456789',
    subject: 'Sac de voyage étanche multifonction',
    price: '15.5',
    currency: 'USD',
    skuInfos: [
      {
        skuId: 'sku-001',
        skuName: 'Black Large',
        price: '15.5',
        sku_attr_list: [
          { attr_name_desc: 'color', attr_value_desc: 'Black' },
          { attr_name_desc: 'size', attr_value_desc: 'Large' },
        ],
      },
      {
        skuId: 'sku-002',
        // skuName absent
        price: '14.0',
        sku_attr_list: [
          { attr_name_desc: 'color', attr_value_desc: 'Red' },
          { attr_name_desc: 'size', attr_value_desc: 'Medium' },
        ],
      },
    ],
  };

  const mapped = await mapAlibabaProductToDango(mockDetail, mockDetail, { skipTranslation: true });

  assert.equal(mapped.isAlibaba, true);
  assert.equal(mapped.fulfillmentPlatform, 'Alibaba');
  assert.equal(mapped.variants.length, 2);

  // Variant 1: attributes should be extracted EVEN THOUGH skuName was given!
  const v1 = mapped.variants[0];
  assert.equal(v1.attributes.Couleur, 'Noir');
  assert.equal(v1.attributes.color, 'Noir');
  assert.equal(v1.attributes.Taille, 'Large');
  assert.equal(v1.attributes.size, 'Large');

  // Variant 2: auto-composed skuName and attributes
  const v2 = mapped.variants[1];
  assert.equal(v2.attributes.Couleur, 'Rouge');
  assert.equal(v2.attributes.color, 'Rouge');
  assert.equal(v2.name, 'Rouge · Medium');

  // Product level color & size arrays
  assert.deepEqual(mapped.color, ['Noir', 'Rouge']);
  assert.deepEqual(mapped.size, ['Large', 'Medium']);
});

test('mapToDropshippingPayload preserves color, size, and isAlibaba', async () => {
  const mockMapped = {
    name: 'Produit Test',
    slug: 'produit-test-123456',
    description: 'Description',
    shortDescription: 'Short',
    category: 'Accessoires',
    subCategory: '',
    pricing: { sellingPrice: 15000, marginPercent: 30, estimatedProfit: 4500 },
    convertedSupplierPriceFCFA: 10000,
    stock: 0,
    weight: '0.5',
    image: 'https://example.com/img.jpg',
    images: [{ url: 'https://example.com/img.jpg' }],
    videos: [],
    variants: [],
    color: ['Noir', 'Blanc'],
    size: ['S', 'M', 'L'],
    specifications: [],
    brand: '',
    shippingInfo: '',
    minimumOrderQuantity: 1,
    quantityIncrement: 1,
    supplier: { platform: 'alibaba' },
    externalSourceKey: 'alibaba:123456',
  };

  const payload = mapToDropshippingPayload(mockMapped, { publish: true });
  assert.equal(payload.isAlibaba, true);
  assert.equal(payload.fulfillmentPlatform, 'Alibaba');
  assert.deepEqual(payload.color, ['Noir', 'Blanc']);
  assert.deepEqual(payload.size, ['S', 'M', 'L']);
});

test('resolveDropshipSellableStock returns available stock for Alibaba products', () => {
  const alibabaProductZeroStock = {
    isAlibaba: true,
    stock: 0,
    variants: [{ stock: 0 }, { stock: 0 }],
  };
  const stock = resolveDropshipSellableStock(alibabaProductZeroStock);
  assert.equal(stock, 999);
});

test('toPublicProduct retains isAlibaba and fulfillmentPlatform', () => {
  const rawProduct = {
    name: 'Produit Alibaba',
    sourceType: 'DROPSHIPPING',
    isAlibaba: true,
    externalSourceKey: 'alibaba:600123',
    supplier: { platform: 'alibaba', name: 'Alibaba Supplier' },
    price: 12000,
  };

  const publicDoc = toPublicProduct(rawProduct);
  assert.equal(publicDoc.isAlibaba, true);
  assert.equal(publicDoc.fulfillmentPlatform, 'Alibaba');
});

test('buildAlibabaProductRecord keeps raw Alibaba payload and normalized mapping together', () => {
  const rawPayload = {
    offerId: '600123456789',
    subject: 'Sac de voyage',
    price: '15.5',
    currency: 'USD',
    skuInfos: [{ skuId: 'sku-1', price: '15.5' }],
    sellerLoginId: 'supplier-1',
    category: 'Bags',
  };

  const mapped = {
    sourceProductId: '600123456789',
    name: 'Sac de voyage',
    category: 'Accessoires',
    pricing: { supplierPrice: 15.5, sellingPrice: 20000, currency: 'XOF' },
    sourceInventory: { rawStock: 150, verifiedStock: 150 },
    supplier: { platform: 'alibaba', productId: '600123456789', name: 'supplier-1' },
    externalSourceKey: 'alibaba:600123456789',
    rawAlibabaData: rawPayload,
  };

  const record = buildAlibabaProductRecord(rawPayload, mapped);

  assert.equal(record.source, 'ALIBABA');
  assert.equal(record.sourceProductId, '600123456789');
  assert.deepEqual(record.rawPayload, rawPayload);
  assert.deepEqual(record.normalized, mapped);
  assert.equal(record.supplier.name, 'supplier-1');
  assert.equal(record.inventory.rawStock, 150);
});

test('getAlibabaRawProduct rejects empty id', async () => {
  const { getAlibabaRawProduct } = require('../services/alibaba/alibabaProductService');
  await assert.rejects(async () => {
    await getAlibabaRawProduct('');
  }, /invalide/i);
});
