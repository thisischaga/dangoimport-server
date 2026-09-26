const slugify = require('slugify');
const Product = require('../Models/Product');
const {
  PLATFORM_VENDOR_NAME,
  toNumber,
} = require('../utils/dropshippingCalculations');
const { getSupplierProvider } = require('./suppliers');
const { resolveSkuForCreate } = require('../utils/productIdentifiers');
const { prepareDropshippingProductForAdmin, repairCjDisplayPricing, isCjDropshippingProduct, calculateDropshippingMarginXof, convertUsdPriceToXof } = require('../utils/cjCatalogHelpers');

const ALLOWED_CURRENCIES = new Set(['XOF', 'USD', 'EUR', 'CNY', 'XAF']);

function isValidUrl(value) {
  if (!value) return true;
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeDropshippingInput(body = {}) {
  const supplierCurrency = String(body.supplier?.supplierCurrency || body.supplierCurrency || 'XOF').toUpperCase();
  const supplierPrice = toNumber(body.supplier?.supplierPrice ?? body.supplierPrice);
  const supplierShippingCost = toNumber(body.supplier?.shippingCost ?? body.supplierShippingCost);
  const otherCosts = toNumber(body.otherCosts);
  const sellingPrice = toNumber(body.price ?? body.sellingPrice);

  const margin = calculateDropshippingMarginXof({
    price: sellingPrice,
    supplier: {
      supplierPrice,
      shippingCost: supplierShippingCost,
      supplierCurrency,
    },
    otherCosts,
  });

  const costPrice = supplierCurrency === 'USD'
    ? convertUsdPriceToXof(supplierPrice)
    : supplierPrice;

  const name = String(body.name || '').trim();
  const slugBase = body.slug || name;
  const slug = slugify(String(slugBase), { lower: true, strict: true });

  const payload = {
    name,
    slug,
    sku: body.sku,
    description: String(body.description || name).trim(),
    shortDescription: body.shortDescription || '',
    category: String(body.category || '').trim(),
    subCategory: body.subCategory || '',
    price: sellingPrice,
    salePrice: body.salePrice != null ? toNumber(body.salePrice) : undefined,
    costPrice: body.costPrice != null ? toNumber(body.costPrice) : costPrice,
    stock: Math.max(0, toNumber(body.stock, 0)),
    minStock: Math.max(0, toNumber(body.minStock, 10)),
    images: Array.isArray(body.images) ? body.images : [],
    image: body.image || body.images?.[0]?.url || '',
    variants: Array.isArray(body.variants) ? body.variants : [],
    specifications: Array.isArray(body.specifications) ? body.specifications : [],
    shippingInfo: body.shippingInfo || '',
    tags: Array.isArray(body.tags) ? body.tags : [],
    brand: body.brand || PLATFORM_VENDOR_NAME,
    isPublished: Boolean(body.isPublished),
    isFeatured: Boolean(body.isFeatured),
    isPromo: Boolean(body.isPromo),
    isNewArrival: Boolean(body.isNewArrival),
    isBestSeller: Boolean(body.isBestSeller),
    sourceType: 'DROPSHIPPING',
    importSourceType: body.importSourceType || 'MANUAL',
    fulfillmentType: body.fulfillmentType || 'DANGO_IMPORT',
    isDropshippingActive: body.isDropshippingActive !== false,
    otherCosts,
    estimatedProfit: margin.estimatedProfit,
    marginPercent: margin.marginPercent,
    vendorName: PLATFORM_VENDOR_NAME,
    vendorId: null,
    isVendorCertified: true,
    validationStatus: 'approved',
    supplier: {
      name: String(body.supplier?.name || body.supplierName || '').trim(),
      platform: String(body.supplier?.platform || body.supplierPlatform || 'manual').trim().toLowerCase(),
      productId: String(body.supplier?.productId || body.supplierProductId || '').trim(),
      productUrl: String(body.supplier?.productUrl || body.supplierProductUrl || '').trim(),
      supplierPrice,
      supplierCurrency,
      shippingCost: supplierShippingCost,
      estimatedDeliveryDays: Math.max(0, toNumber(body.supplier?.estimatedDeliveryDays ?? body.estimatedDeliveryDays)),
      lastSyncedAt: body.supplier?.lastSyncedAt || null,
    },
    externalSourceKey: body.externalSourceKey ? String(body.externalSourceKey).trim() : undefined,
    syncStatus: body.syncStatus || 'success',
  };

  return finalizeNormalizedPayload(repairCjDisplayPricing(payload));
}

function finalizeNormalizedPayload(normalized) {
  const margin = calculateDropshippingMarginXof(normalized);
  normalized.estimatedProfit = margin.estimatedProfit;
  normalized.marginPercent = margin.marginPercent;
  if (normalized.supplier?.supplierCurrency === 'USD') {
    normalized.costPrice = convertUsdPriceToXof(normalized.supplier.supplierPrice);
  }
  return normalized;
}

function validateDropshippingPayload(payload, { partial = false } = {}) {
  const errors = [];

  if (!partial || payload.name != null) {
    if (!String(payload.name || '').trim()) errors.push('Le nom du produit est requis.');
  }
  if (!partial || payload.description != null) {
    if (!String(payload.description || '').trim()) errors.push('La description est requise.');
  }
  if (!partial || payload.category != null) {
    if (!String(payload.category || '').trim()) errors.push('La catégorie est requise.');
  }
  if (!partial || payload.price != null) {
    if (toNumber(payload.price) <= 0) errors.push('Le prix de vente doit être supérieur à 0.');
    if (toNumber(payload.price) > 0 && toNumber(payload.price) < 100) {
      errors.push('Le prix de vente doit être d\'au moins 100 FCFA.');
    }
  }
  if (!partial || payload.stock != null) {
    if (toNumber(payload.stock) < 0) errors.push('Le stock doit être supérieur ou égal à 0.');
  }
  if (!partial || payload.supplier != null) {
    if (toNumber(payload.supplier?.supplierPrice) < 0) errors.push('Le prix fournisseur doit être positif ou nul.');
    if (payload.supplier?.productUrl && !isValidUrl(payload.supplier.productUrl)) {
      errors.push('URL fournisseur invalide.');
    }
    if (payload.supplier?.supplierCurrency && !ALLOWED_CURRENCIES.has(String(payload.supplier.supplierCurrency).toUpperCase())) {
      errors.push('Devise fournisseur invalide.');
    }
  }

  const margin = calculateDropshippingMarginXof(payload);

  if (payload.price > 0 && margin.estimatedProfit < 0 && !partial) {
    errors.push('La marge estimée est négative. Ajustez le prix de vente ou les coûts.');
  }

  return errors;
}

async function listDropshippingProducts(query = {}) {
  const page = Math.max(1, toNumber(query.page, 1));
  const limit = Math.min(100, Math.max(1, toNumber(query.limit, 20)));
  const skip = (page - 1) * limit;

  const filter = { sourceType: 'DROPSHIPPING' };
  if (query.active === 'true') filter.isDropshippingActive = true;
  if (query.active === 'false') filter.isDropshippingActive = false;
  if (query.platform) {
    filter['supplier.platform'] = String(query.platform).trim().toLowerCase();
  }
  if (query.search) {
    const regex = new RegExp(String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { name: regex },
      { sku: regex },
      { 'supplier.productId': regex },
      { 'supplier.platform': regex },
    ];
  }

  const [items, total] = await Promise.all([
    Product.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    Product.countDocuments(filter),
  ]);

  return {
    data: items.map((item) => prepareDropshippingProductForAdmin(item)),
    pagination: {
      currentPage: page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      totalItems: total,
      itemsPerPage: limit,
    },
  };
}

async function getDropshippingProductById(id) {
  const product = await Product.findOne({ _id: id, sourceType: 'DROPSHIPPING' }).lean();
  return product ? prepareDropshippingProductForAdmin(product) : null;
}

async function createDropshippingProduct(body, adminUser) {
  const payload = normalizeDropshippingInput(body);
  const errors = validateDropshippingPayload(payload);
  if (errors.length) {
    const err = new Error(errors.join(' '));
    err.status = 400;
    throw err;
  }

  payload.sku = await resolveSkuForCreate(payload.sku);
  payload.history = [{
    action: 'Création dropshipping',
    comment: 'Produit dropshipping créé par un administrateur.',
    performedBy: adminUser?.email || adminUser?.adminName || 'admin',
    role: 'admin',
    date: new Date(),
  }];

  const created = await Product.create(payload);
  return created.toObject();
}

async function updateDropshippingProduct(id, body, adminUser) {
  const existing = await Product.findOne({ _id: id, sourceType: 'DROPSHIPPING' });
  if (!existing) {
    const err = new Error('Produit dropshipping introuvable.');
    err.status = 404;
    throw err;
  }

  const payload = normalizeDropshippingInput({ ...existing.toObject(), ...body });
  const errors = validateDropshippingPayload(payload, { partial: true });
  if (errors.length) {
    const err = new Error(errors.join(' '));
    err.status = 400;
    throw err;
  }

  payload.history = [
    ...(existing.history || []),
    {
      action: 'Mise à jour dropshipping',
      comment: 'Produit dropshipping mis à jour.',
      performedBy: adminUser?.email || adminUser?.adminName || 'admin',
      role: 'admin',
      date: new Date(),
    },
  ];

  Object.assign(existing, payload);
  await existing.save();
  return existing.toObject();
}

async function deleteDropshippingProduct(id) {
  const deleted = await Product.findOneAndDelete({ _id: id, sourceType: 'DROPSHIPPING' });
  if (!deleted) {
    const err = new Error('Produit dropshipping introuvable.');
    err.status = 404;
    throw err;
  }
  return deleted;
}

async function updateDropshippingStatus(id, { isDropshippingActive, isPublished }) {
  const product = await Product.findOne({ _id: id, sourceType: 'DROPSHIPPING' });
  if (!product) {
    const err = new Error('Produit dropshipping introuvable.');
    err.status = 404;
    throw err;
  }

  if (typeof isDropshippingActive === 'boolean') {
    product.isDropshippingActive = isDropshippingActive;
  }
  if (typeof isPublished === 'boolean') {
    product.isPublished = isPublished;
  }

  await product.save();
  return product.toObject();
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseCsv(text = '') {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });
    return row;
  });
}

async function importDropshippingCsv(csvText, adminUser) {
  const rows = parseCsv(csvText);
  const results = { created: 0, failed: [], items: [] };

  for (const row of rows) {
    try {
      const payload = normalizeDropshippingInput({
        name: row.name,
        description: row.description || row.name,
        category: row.category,
        subCategory: row.subcategory || row.sub_category,
        price: row.price || row.sellingprice,
        stock: row.stock || row.quantity,
        supplierName: row.suppliername || row.supplier_name,
        supplierPlatform: row.supplierplatform || row.platform,
        supplierProductId: row.supplierproductid || row.productid,
        supplierProductUrl: row.supplierurl || row.url,
        supplierPrice: row.supplierprice,
        supplierCurrency: row.suppliercurrency || row.currency,
        supplierShippingCost: row.shippingscost || row.shippingcost,
        estimatedDeliveryDays: row.estimateddeliverydays || row.deliverydays,
        otherCosts: row.othercosts,
        importSourceType: 'CSV',
      });

      const errors = validateDropshippingPayload(payload);
      if (errors.length) {
        throw new Error(errors.join(' '));
      }

      const created = await createDropshippingProduct(payload, adminUser);
      results.created += 1;
      results.items.push({ id: created._id, name: created.name });
    } catch (error) {
      results.failed.push({
        name: row.name || 'Ligne CSV',
        message: error.message,
      });
    }
  }

  return results;
}

async function syncDropshippingProduct(productId) {
  const product = await Product.findOne({ _id: productId, sourceType: 'DROPSHIPPING' });
  if (!product) {
    const err = new Error('Produit dropshipping introuvable.');
    err.status = 404;
    throw err;
  }

  const platform = String(product.supplier?.platform || 'manual').toLowerCase();

  if (platform === 'cj' || isCjDropshippingProduct(product.toObject())) {
    const { syncSingleCjProduct } = require('./cj/cjSyncService');
    return syncSingleCjProduct(productId);
  }

  const provider = getSupplierProvider(platform);

  try {
    const supplierProductId = product.supplier?.productId;
    if (!supplierProductId) {
      throw new Error('Identifiant produit fournisseur manquant.');
    }

    await provider.getProduct(supplierProductId);

    product.supplier.lastSyncedAt = new Date();
    product.syncError = '';
    product.lastSyncErrorAt = null;
    await product.save();

    return {
      success: true,
      product: product.toObject(),
      message: 'Synchronisation enregistrée. Intégration API fournisseur à venir.',
    };
  } catch (error) {
    product.syncError = error.message;
    product.lastSyncErrorAt = new Date();
    await product.save();

    return {
      success: false,
      product: product.toObject(),
      message: error.message,
    };
  }
}

module.exports = {
  normalizeDropshippingInput,
  validateDropshippingPayload,
  listDropshippingProducts,
  getDropshippingProductById,
  createDropshippingProduct,
  updateDropshippingProduct,
  deleteDropshippingProduct,
  updateDropshippingStatus,
  importDropshippingCsv,
  syncDropshippingProduct,
};
