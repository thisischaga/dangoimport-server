const test = require('node:test');
const assert = require('node:assert/strict');
const { mapAlibabaProductToDango, mapToDropshippingPayload } = require('../services/alibaba/alibabaMapper');
const { buildAlibabaProductRecord } = require('../services/alibaba/alibabaImportService');
const { toPublicProduct, toPublicProductDetail } = require('../utils/publicProduct');
const { buildProductPayload } = require('../utils/productPayload');
const { resolveDropshipSellableStock } = require('../utils/cjCatalogHelpers');
const { isPubliclyVisibleProduct } = require('../routes/productRoutes');

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

test('resolveDropshipSellableStock returns no default stock for Alibaba products', () => {
  const alibabaProductZeroStock = {
    isAlibaba: true,
    stock: 0,
    variants: [{ stock: 0 }, { stock: 0 }],
  };
  const stock = resolveDropshipSellableStock(alibabaProductZeroStock);
  assert.equal(stock, 0);
});

test('toPublicProduct retains isAlibaba and fulfillmentPlatform', () => {
  const rawProduct = {
    name: 'Produit Alibaba',
    sourceType: 'DROPSHIPPING',
    isAlibaba: true,
    isPublished: true,
    publicationStatus: 'published',
    externalSourceKey: 'alibaba:600123',
    supplier: { platform: 'alibaba', name: 'Alibaba Supplier' },
    price: 12000,
  };

  const publicDoc = toPublicProduct(rawProduct);
  assert.equal(publicDoc.isAlibaba, true);
  assert.equal(publicDoc.fulfillmentPlatform, 'Alibaba');
  assert.equal('sourceType' in publicDoc, false);
  assert.equal('externalSourceKey' in publicDoc, false);
  assert.equal('supplier' in publicDoc, false);
});

test('public catalog visibility blocks unpublished dropshipping products', () => {
  const hidden = {
    sourceType: 'DROPSHIPPING',
    isDropshippingActive: true,
    isPublished: false,
    price: 12000,
    validationStatus: 'approved',
  };

  const visible = {
    sourceType: 'DROPSHIPPING',
    isDropshippingActive: true,
    isPublished: true,
    publicationStatus: 'published',
    price: 12000,
    validationStatus: 'approved',
  };

  const legacyPublished = {
    sourceType: 'DROPSHIPPING',
    isDropshippingActive: true,
    isPublished: false,
    publicationStatus: 'published',
    price: 12000,
    validationStatus: 'approved',
  };

  assert.equal(isPubliclyVisibleProduct(hidden), false);
  assert.equal(isPubliclyVisibleProduct(visible), true);
  assert.equal(isPubliclyVisibleProduct(legacyPublished), true);
});

test('buildProductPayload ignores stock edits for Alibaba products', () => {
  const payload = buildProductPayload({
    name: 'Produit Alibaba',
    category: 'Accessoires',
    price: '12000',
    stock: '999',
    description: 'Description',
  }, {
    existingProduct: {
      isAlibaba: true,
      importSourceType: 'ALIBABA_API',
      stock: 42,
      price: 12000,
      name: 'Produit Alibaba',
      category: 'Accessoires',
      description: 'Description',
    },
  });

  assert.equal(payload.stock, 42);
});

test('Alibaba product descriptions keep a static HTML structure', async () => {
  const mockDetail = {
    offerId: '600987654321',
    subject: 'Trousse de voyage premium',
    description: '<div id="detail_decorate_root"><h2>Présentation</h2><p>Produit léger et résistant.</p><ul><li>Étanche</li><li>Robuste</li></ul><p>La valeur est idéale pour les séjours.</p></div>',
    price: '19',
    currency: 'USD',
    skuInfos: [],
  };

  const mapped = await mapAlibabaProductToDango(mockDetail, mockDetail, { skipTranslation: true });

  assert.ok(/<p>/i.test(mapped.description));
  assert.ok(/<ul>|<li>/i.test(mapped.description));
  assert.doesNotMatch(mapped.description, /#detail_decorate_root|\.magic-|style=|onclick=/i);
});

test('Alibaba descriptions strip product-detail boilerplate and company sales copy', async () => {
  const mockDetail = {
    offerId: '600999888777',
    subject: 'Explore Noir',
    description: 'Product Details Product Name: (#88362 - Explore Noir) Fragrance: wooden Fougere scent top notes: tonka bean lemon bitter Middle notes: mango sage, tangerine Base Notes: Sandalwood Patchouli 1. Men perfume 2. Black parfum 3. Leather note Packaging Details Item Perfume Item No. 88362 MOQ Pack (pcs) 3000pcs CBM per Pack (cm 3) 0.117 Weight (kg) 23 Delivery Date 15 About Private Label (Kindly note that the MOQ and the PRICE may be different from the listing.) About Zuofun GUANGZHOU ZUOFUN COSMETICS CO LTD. As one of the biggest cosmetics factory in China, we dedicate to bring good quality products and good service in reasonable price. Our products were selling to 80+ countries on the world in past 20 years. For product design, packaging, formula creation or replication to production, we are always here for you. >> Click Here to Know More << You may also be interested in ...',
    price: '19',
    currency: 'USD',
    skuInfos: [],
  };

  const mapped = await mapAlibabaProductToDango(mockDetail, mockDetail, { skipTranslation: true });

  assert.doesNotMatch(mapped.description, /Product Details/i);
  assert.doesNotMatch(mapped.description, /Our products were selling to 80\+ countries/i);
  assert.doesNotMatch(mapped.description, /Click Here to Know More/i);
  assert.match(mapped.description, /Explore Noir|Fougere|Sandalwood|Patchouli/i);
});

test('toPublicProductDetail preserves Alibaba galleryImages coming from gallery metadata', async () => {
  const rawProduct = {
    name: 'Produit Alibaba',
    sourceType: 'DROPSHIPPING',
    isAlibaba: true,
    isPublished: true,
    publicationStatus: 'published',
    externalSourceKey: 'alibaba:600123',
    sourceUrl: 'https://www.alibaba.com/product-detail/600123.html',
    mainImage: 'https://example.com/1.jpg',
    galleryImages: [
      { url: 'https://example.com/1.jpg' },
      { url: 'https://example.com/2.jpg' },
      { url: 'https://example.com/3.jpg' },
    ],
    variants: [{
      name: 'Blanc / 330ml',
      sku: 'sku-1',
      price: 2811,
      stock: 2,
      attributes: { Couleur: 'Blanc', Capacité: '330ml' },
    }],
    supplier: { platform: 'alibaba', name: 'Alibaba Supplier', productId: '600123', country: 'CN', companyName: 'Zhongshan Export Co.' },
    normalized: {
      source: 'ALIBABA',
      sourceProductId: '600123',
      sourceUrl: 'https://www.alibaba.com/product-detail/600123.html',
      galleryImages: [
        { url: 'https://example.com/1.jpg' },
        { url: 'https://example.com/2.jpg' },
        { url: 'https://example.com/3.jpg' },
      ],
      logistics: { weight: '2.4', weightUnit: 'kg' },
      keyAttributes: {
        attributes: [{
          attributes: [{ name: 'Material', values: [{ value: 'PP' }] }],
          type: 'Other attributes',
        }],
      },
      sourcePriceTiers: [{ minQty: 49, maxQty: 499, price: 4, currency: 'USD' }],
      supplier: { platform: 'alibaba', name: 'Alibaba Supplier', productId: '600123' },
      inventory: [{ shipping_from: 'CN' }],
      shippingOrigin: { country: 'CN', countryName: 'Chine' },
    },
    rawAlibabaData: {
      rawSections: { product: { title: 'Produit Alibaba' } },
    },
    inventory: { raw: [{ shipping_from: 'CN' }] },
    pricing: { sourcePrice: 3.3 },
  };

  const detail = await toPublicProductDetail(rawProduct);

  assert.equal(detail.sourceProductId, '600123');
  assert.equal(detail.sourceUrl, 'https://www.alibaba.com/product-detail/600123.html');
  assert.equal(detail.weight, '2.4');
  assert.ok(Array.isArray(detail.galleryImages));
  assert.ok(detail.galleryImages.length >= 3);
  assert.ok(detail.galleryImages.includes('https://example.com/2.jpg'));
  assert.ok(detail.alibaba);
  assert.equal(detail.alibaba.platform, 'Alibaba');
  assert.ok(Array.isArray(detail.alibaba.keyAttributes));
  assert.ok(detail.alibaba.keyAttributes.length >= 1);
  assert.ok(Array.isArray(detail.alibaba.inventory));
  assert.equal('sourceType' in detail, false);
  assert.equal('externalSourceKey' in detail, false);
  assert.equal('supplier' in detail, false);
  assert.equal(detail.supplierSummary.name, 'Zhongshan Export Co.');
  assert.equal(detail.supplierSummary.country, 'CN');

  const emptyWeight = await toPublicProductDetail({
    isAlibaba: true,
    name: 'Sans poids',
    weight: '0',
    rawAlibabaData: { productShippingInfo: { weight: '0 kg' } },
  });
  assert.equal(emptyWeight.weight, '');
});

test('Alibaba weight is recovered from real nested shipment metadata for logistics', async () => {
  const mockDetail = {
    offerId: '600111222333',
    subject: 'Sac de sport',
    description: '<p>Produit de qualité</p>',
    price: '18',
    currency: 'USD',
    raw: {
      result_data: {
        productShippingInfo: { weight: '2.75 kg' },
      },
    },
    productShippingInfo: { weight: '2.75 kg' },
    skuInfos: [],
  };

  const mapped = await mapAlibabaProductToDango(mockDetail, mockDetail, { skipTranslation: true });

  assert.equal(mapped.weight, '2.75');
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
