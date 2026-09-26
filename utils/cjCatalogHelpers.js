const { cjConfig } = require('../config/cj');
const { toNumber, calculateSellingPrice, calculateMargin } = require('./dropshippingCalculations');

function normalizeCjImageUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let url = raw.trim();
  if (!url) return '';
  if (url.startsWith('//')) url = `https:${url}`;
  if (url.startsWith('http://')) url = `https://${url.slice(7)}`;
  return url;
}

function extractCjImages(cjProduct = {}, detail = null) {
  const urls = [];
  const seen = new Set();
  const push = (value) => {
    const url = normalizeCjImageUrl(value);
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };

  push(cjProduct.image);
  (cjProduct.images || []).forEach((img) => {
    push(typeof img === 'string' ? img : img?.url);
  });

  if (detail) {
    push(detail.productImage);
    (detail.productImageSet || []).forEach(push);
    (detail.images || []).forEach(push);
    (detail.productImages || []).forEach(push);
    if (Array.isArray(detail.descriptionImages)) {
      detail.descriptionImages.forEach(push);
    }
  }

  return urls.map((url, index) => ({
    url,
    alt: '',
    isPrimary: index === 0,
  }));
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCjLocalizedName(value) {
  if (!value) return '';
  if (typeof value !== 'string') return String(value).trim();

  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const frenchLike = parsed.find((entry) => /[àâäéèêëïîôùûüç]/i.test(String(entry)));
        if (frenchLike) return String(frenchLike).trim();
        const nonChinese = parsed.find((entry) => !/[\u4e00-\u9fff]/.test(String(entry)));
        return String(nonChinese || parsed[0] || '').trim();
      }
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function isPrimarilyChinese(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  const cjk = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const chars = (s.match(/\S/g) || []).length;
  return cjk >= 3 && cjk / Math.max(chars, 1) >= 0.12;
}

function pickCjTitle(cjProduct = {}, detail = null) {
  const raw = cjProduct.raw || {};
  const candidates = [
    detail?.productNameEn,
    detail?.nameEn,
    raw.productNameEn,
    raw.nameEn,
    raw.name,
    cjProduct.name,
    parseCjLocalizedName(detail?.productName),
    detail?.productName,
    parseCjLocalizedName(detail?.productSku),
  ]
    .map((c) => String(c || '').trim())
    .filter(Boolean);

  const preferred = candidates.find((c) => !isPrimarilyChinese(c));
  if (preferred) return preferred;
  return candidates[0] || 'Produit';
}

function resolveCjProductId(product = {}) {
  const fromSupplier = String(product.supplier?.productId || '').trim();
  if (fromSupplier) return fromSupplier;
  const key = String(product.externalSourceKey || '').trim();
  const match = key.match(/^cj:([^:\s]+)$/i);
  if (match) return match[1];
  return String(product.supplier?.externalProductId || '').trim();
}

function pickBestStoredProductName(doc = {}) {
  const supplier = doc.supplier || {};
  const candidates = [
    supplier.productNameEn,
    supplier.nameEn,
    parseCjLocalizedName(doc.name),
    doc.name,
    doc.shortDescription,
  ]
    .map((c) => String(c || '').trim())
    .filter(Boolean);
  const preferred = candidates.find((c) => !isPrimarilyChinese(c));
  return preferred || candidates[0] || 'Produit';
}

function pickCjDescription(cjProduct = {}, detail = null) {
  const raw = detail?.description
    || detail?.productDescription
    || detail?.productDescriptionEn
    || detail?.descriptionEn
    || detail?.remarkEn
    || cjProduct.description
    || detail?.remark
    || cjProduct.raw?.description
    || '';
  const text = stripHtml(raw);
  if (text && text.length > 20) return text;
  const title = pickCjTitle(cjProduct, detail);
  if (text) return text;
  return title;
}

function extractAllImageUrls(value) {
  if (!value) return [];
  if (typeof value === 'object' && value?.url) {
    const u = normalizeCjImageUrl(value.url);
    return u ? [u] : [];
  }
  const str = String(value).trim();
  if (!str) return [];
  const matches = str.match(/https?:\/\/[^\s"'\\[\],]+/gi) || [];
  const urls = matches.map(normalizeCjImageUrl).filter(Boolean);
  if (urls.length) return [...new Set(urls)];
  const single = extractFirstImageUrl(str);
  return single ? [single] : [];
}

function mapCjCategoryToFrenchStore(rawCategory) {
  const raw = String(rawCategory || '').trim();
  if (!raw || raw === 'Général') return 'Général';

  const exact = {
    "Women's Clothing": 'Mode & Vêtements',
    "Men's Clothing": 'Mode & Vêtements',
    'Clothing': 'Mode & Vêtements',
    'Apparel': 'Mode & Vêtements',
    'Fashion': 'Mode & Vêtements',
    'Shoes': 'Chaussures & Accessoires',
    'Bags': 'Chaussures & Accessoires',
    'Jewelry': 'Chaussures & Accessoires',
    'Electronics': 'Électronique & High-Tech',
    'Consumer Electronics': 'Électronique & High-Tech',
    'Phones & Telecommunications': 'Téléphones & Tablettes',
    'Computer & Office': 'Informatique',
    'Home & Garden': 'Maison & Cuisine',
    'Home Appliances': 'Maison & Cuisine',
    'Beauty & Health': 'Beauté & Santé',
    'Health & Beauty': 'Beauté & Santé',
    'Toys & Hobbies': 'Jouets & Enfants',
    'Mother & Kids': 'Jouets & Enfants',
    'Sports & Entertainment': 'Général',
  };
  if (exact[raw]) return exact[raw];

  const lower = raw.toLowerCase();
  if (/cloth|apparel|fashion|wear|dress|coat|sweater|cardigan|jacket/.test(lower)) return 'Mode & Vêtements';
  if (/shoe|sneaker|boot|bag|wallet|accessory|jewel/.test(lower)) return 'Chaussures & Accessoires';
  if (/phone|tablet|telecom/.test(lower)) return 'Téléphones & Tablettes';
  if (/computer|laptop|office|pc\b/.test(lower)) return 'Informatique';
  if (/electronic|gadget|tech|audio|camera/.test(lower)) return 'Électronique & High-Tech';
  if (/home|kitchen|garden|furniture|decor/.test(lower)) return 'Maison & Cuisine';
  if (/beauty|health|cosmetic|skin|makeup/.test(lower)) return 'Beauté & Santé';
  if (/toy|kid|child|baby/.test(lower)) return 'Jouets & Enfants';

  return raw;
}

function pickCjCategory(cjProduct = {}, detail = null) {
  const raw = cjProduct.category
    || detail?.categoryName
    || detail?.threeCategoryName
    || detail?.twoCategoryName
    || detail?.oneCategoryName
    || 'Général';
  return mapCjCategoryToFrenchStore(String(raw).trim() || 'Général');
}

function buildCjSpecifications(detail = null) {
  if (!detail) return [];
  const rows = [];
  const add = (key, value) => {
    if (value == null || value === '') return;
    rows.push({ key, value: String(value) });
  };

  add('SKU', detail.productSku || detail.sku);
  add('Poids', detail.productWeight ? `${detail.productWeight} g` : null);
  add('Matériau', detail.materialNameEn || detail.materialName);
  add('Emballage', detail.packingNameEn || detail.packingName);
  add('Type', detail.productType);
  add('Code douane', detail.entryNameEn || detail.entryName);
  return rows;
}

function usdToXof(amountUsd) {
  const rate = toNumber(cjConfig.usdToXofRate, 610);
  const usd = toNumber(amountUsd, 0);
  return Math.max(0, Math.round(usd * rate));
}

function convertUsdPriceToXof(amountUsd) {
  return usdToXof(amountUsd);
}

function isCjDropshippingProduct(product = {}) {
  const platform = String(product.supplier?.platform || '').toLowerCase();
  if (platform === 'cj') return true;
  if (product.importSourceType === 'CJ_API') return true;
  if (/^cj:/i.test(String(product.externalSourceKey || ''))) return true;
  const supplierName = String(product.supplier?.name || '').toLowerCase();
  if (supplierName.includes('cjdrop') || supplierName.includes('cj drop')) return true;
  return false;
}

function looksLikeUnconvertedUsdSellingPrice(product = {}) {
  const price = toNumber(product.price, 0);
  const supplierUsd = toNumber(product.supplier?.supplierPrice, 0);
  if (!price || !supplierUsd) return false;
  const currency = String(product.supplier?.supplierCurrency || '').toUpperCase();
  const treatsSupplierAsUsd = currency === 'USD' || isCjDropshippingProduct(product);
  if (!treatsSupplierAsUsd) return false;
  const expectedMinXof = usdToXof(supplierUsd);
  return price < Math.max(100, expectedMinXof * 0.6);
}

function looksLikeUnconvertedCjPrice(product = {}) {
  if (!isCjDropshippingProduct(product)) return looksLikeUnconvertedUsdSellingPrice(product);
  return looksLikeUnconvertedUsdSellingPrice(product);
}

function calculateDropshippingMarginXof(doc = {}) {
  const sellingPrice = toNumber(doc.price, 0);
  const currency = String(doc.supplier?.supplierCurrency || 'XOF').toUpperCase();
  const other = toNumber(doc.otherCosts, 0);
  const supplierUsd = toNumber(doc.supplier?.supplierPrice, 0);
  const shippingUsd = toNumber(doc.supplier?.shippingCost, 0);

  if (currency === 'USD' || isCjDropshippingProduct(doc)) {
    const totalCost = usdToXof(supplierUsd + shippingUsd) + other;
    const estimatedProfit = sellingPrice - totalCost;
    const marginPercent = sellingPrice > 0
      ? Math.round((estimatedProfit / sellingPrice) * 10000) / 100
      : 0;
    return { totalCost, estimatedProfit, marginPercent };
  }

  return calculateMargin({
    sellingPrice,
    supplierPrice: supplierUsd,
    supplierShippingCost: shippingUsd,
    otherCosts: other,
  });
}

function repairCjDisplayPricing(product = {}) {
  const doc = {
    ...product,
    supplier: { ...(product.supplier || {}) },
  };

  if (isCjDropshippingProduct(doc)) {
    doc.supplier.platform = 'cj';
    if (!doc.supplier.supplierCurrency) doc.supplier.supplierCurrency = 'USD';
  }

  const supplierUsd = toNumber(doc.supplier?.supplierPrice, 0);
  if (looksLikeUnconvertedUsdSellingPrice(doc)) {
    const sellingXof = convertUsdPriceToXof(
      calculateSellingPrice({
        supplierPrice: supplierUsd,
        shippingCost: toNumber(doc.supplier?.shippingCost, 0),
        marginPercent: toNumber(cjConfig.defaultMarginPercent, 30),
        otherCosts: toNumber(doc.otherCosts, 0),
      }),
    );
    doc.price = sellingXof;
    doc.costPrice = convertUsdPriceToXof(supplierUsd);
  } else if (isCjDropshippingProduct(doc) && supplierUsd > 0 && !doc.costPrice) {
    doc.costPrice = convertUsdPriceToXof(supplierUsd);
  }

  if (Array.isArray(doc.variants)) {
    doc.variants = doc.variants.map((variant) => {
      const variantUsd = toNumber(variant?.attributes?.supplierPriceUsd, 0);
      const variantPrice = toNumber(variant?.price, 0);
      if (variantUsd > 0 && variantPrice < usdToXof(variantUsd) * 0.6) {
        return {
          ...variant,
          price: convertUsdPriceToXof(
            calculateSellingPrice({
              supplierPrice: variantUsd,
              marginPercent: toNumber(cjConfig.defaultMarginPercent, 30),
            }),
          ),
        };
      }
      return variant;
    });
  }

  return doc;
}

function extractFirstImageUrl(value) {
  if (!value) return '';
  if (typeof value === 'object' && value?.url) {
    return normalizeCjImageUrl(value.url);
  }
  const str = String(value).trim();
  if (!str) return '';
  const match = str.match(/https?:\/\/[^\s"'\\[\],]+/i);
  if (match) return normalizeCjImageUrl(match[0]);
  return normalizeCjImageUrl(str);
}

function normalizeProductImagesField(product = {}) {
  const fromImageField = extractAllImageUrls(product.image);
  const images = Array.isArray(product.images) ? product.images : [];
  const fromArray = images.flatMap((img) => extractAllImageUrls(typeof img === 'string' ? img : img?.url));
  const merged = [...new Set([...fromArray, ...fromImageField])];
  const normalized = merged
    .filter(Boolean)
    .map((url, index) => ({ url, isPrimary: index === 0, alt: product.name || '' }));
  const primary = normalized[0]?.url || '';
  return {
    image: primary,
    images: normalized,
  };
}

function repairPublicCategory(doc = {}) {
  const next = { ...doc };
  if (next.category && next.category !== 'Général') {
    next.category = mapCjCategoryToFrenchStore(next.category);
    return next;
  }
  const fallback = next.subCategory
    || next.supplier?.category
    || next.specifications?.find((s) => String(s?.key).toLowerCase() === 'type')?.value;
  if (fallback) {
    next.category = mapCjCategoryToFrenchStore(fallback);
  }
  return next;
}

function resolveDropshipSellableStock(product = {}) {
  const supplier = product.supplier || {};
  let stock = toNumber(product.stock, 0);

  if (Array.isArray(product.variants) && product.variants.length) {
    const variantStock = product.variants.reduce((sum, v) => sum + toNumber(v.stock, 0), 0);
    stock = Math.max(stock, variantStock);
  }

  if (Array.isArray(supplier.warehouseInventories) && supplier.warehouseInventories.length) {
    const warehouseStock = supplier.warehouseInventories.reduce(
      (sum, row) => sum + toNumber(row?.quantity ?? row?.totalInventoryNum ?? row?.totalInventory, 0),
      0,
    );
    stock = Math.max(stock, warehouseStock);
  }

  return Math.max(0, Math.round(stock));
}

function normalizePublicVariantStocks(variants = [], productStock = 0) {
  if (!Array.isArray(variants) || !variants.length || productStock <= 0) {
    return variants;
  }
  const allVariantsZero = variants.every((v) => toNumber(v.stock, 0) <= 0);
  if (!allVariantsZero) return variants;
  return variants.map((v) => ({ ...v, stock: productStock }));
}

function applyRealStock(doc = {}, source = {}) {
  const next = { ...doc };
  const resolved = resolveDropshipSellableStock({
    ...source,
    stock: next.stock,
    variants: next.variants ?? source.variants,
    supplier: source.supplier ?? next.supplier,
  });
  next.stock = resolved;
  return next;
}

function attachPublicFulfillmentFields(doc = {}, source = {}) {
  const next = { ...doc };
  const supplier = source.supplier || {};
  next.stock = resolveDropshipSellableStock({
    ...source,
    stock: next.stock,
    variants: next.variants ?? source.variants,
    supplier,
  });
  next.shippingOrigin = {
    countryCode: String(supplier.shipFromCountryCode || '').toUpperCase(),
    countryName: supplier.shipFromCountryName || '',
    warehouseName: supplier.shipFromWarehouseName || '',
  };
  const realSupplier = String(
    supplier.manufacturerName || supplier.name || '',
  ).trim();
  if (realSupplier) {
    next.fulfillmentSupplierName = realSupplier;
  }
  next.fulfillmentPlatform = 'CJdropshipping';
  if (supplier.estimatedDeliveryDays != null) {
    next.estimatedDeliveryDays = toNumber(supplier.estimatedDeliveryDays, 0);
  }
  return next;
}

function enrichPublicShippingInfo(doc = {}, source = {}) {
  const next = { ...doc };
  const days = toNumber(
    next.estimatedDeliveryDays ?? source.supplier?.estimatedDeliveryDays,
    0,
  );
  if (days > 0) {
    next.estimatedDeliveryDays = days;
    if (!next.shippingInfo?.trim()) {
      next.shippingInfo = `Livraison dropshipping estimée : ${days} jour(s) ouvrés (hors week-end).`;
    }
  } else if (!next.shippingInfo?.trim() && isCjDropshippingProduct(source)) {
    next.shippingInfo = '';
  }
  return next;
}

function enrichPublicSpecifications(doc = {}, source = {}) {
  const next = { ...doc };
  const rows = Array.isArray(next.specifications) ? [...next.specifications] : [];
  const has = (key) => rows.some((r) => String(r?.key).toLowerCase() === key.toLowerCase());

  if (next.subCategory && !has('sous-catégorie')) {
    rows.push({ key: 'Sous-catégorie', value: String(next.subCategory) });
  }
  const days = toNumber(next.estimatedDeliveryDays, 0);
  if (days > 0 && !has('délai de livraison')) {
    rows.push({ key: 'Délai de livraison', value: `${days} jour(s) ouvrés (estimation)` });
  }
  const origin = source.supplier?.shipFromCountryName || source.supplier?.shipFromCountryCode;
  if (origin && !has('pays d\'expédition')) {
    rows.push({
      key: "Pays d'expédition",
      value: [source.supplier?.shipFromCountryName, source.supplier?.shipFromWarehouseName].filter(Boolean).join(' · '),
    });
  }
  const manufacturer = source.supplier?.manufacturerName || source.supplier?.name;
  if (manufacturer && isCjDropshippingProduct(source) && !has('expéditeur')) {
    rows.push({ key: 'Expéditeur (fournisseur CJ)', value: manufacturer });
  }
  if (isCjDropshippingProduct(source) && !has('expédition')) {
    rows.push({ key: 'Expédition', value: 'Dropshipping international (CJdropshipping)' });
  }
  next.specifications = rows;
  return next;
}

function prepareDropshippingProductForPublic(product = {}) {
  if (!product || product.sourceType !== 'DROPSHIPPING') return product;

  let doc = repairCjDisplayPricing({ ...product });
  doc = { ...doc, ...normalizeProductImagesField(doc) };
  doc = repairPublicCategory(doc);
  doc = applyRealStock(doc, product);
  doc = attachPublicFulfillmentFields(doc, product);
  doc.stock = resolveDropshipSellableStock({ ...product, variants: doc.variants ?? product.variants });
  if (Array.isArray(doc.variants) && doc.variants.length) {
    doc.variants = normalizePublicVariantStocks(doc.variants, doc.stock);
  }
  doc.name = pickBestStoredProductName(doc);
  if (isPrimarilyChinese(doc.name)) {
    doc.name = parseCjLocalizedName(doc.name) || doc.name;
  }
  if (doc.description) {
    doc.description = stripHtml(doc.description) || doc.description;
  }
  if (!String(doc.description || '').trim()) {
    doc.description = stripHtml(doc.shortDescription) || doc.shortDescription || doc.name || '';
  }
  if (!String(doc.shortDescription || '').trim() && doc.description) {
    doc.shortDescription = String(doc.description).slice(0, 220);
  }
  doc = enrichPublicShippingInfo(doc, product);
  doc = enrichPublicSpecifications(doc, product);

  const margin = calculateDropshippingMarginXof(doc);
  doc.estimatedProfit = margin.estimatedProfit;
  doc.marginPercent = margin.marginPercent;
  return doc;
}

function prepareDropshippingProductForAdmin(product = {}) {
  if (!product || product.sourceType !== 'DROPSHIPPING') return product;
  let doc = repairCjDisplayPricing({ ...product });
  const media = normalizeProductImagesField(doc);
  doc = { ...doc, ...media };
  doc.stock = resolveDropshipSellableStock(product);
  const margin = calculateDropshippingMarginXof(doc);
  doc.estimatedProfit = margin.estimatedProfit;
  doc.marginPercent = margin.marginPercent;
  return doc;
}

module.exports = {
  normalizeCjImageUrl,
  extractFirstImageUrl,
  normalizeProductImagesField,
  prepareDropshippingProductForAdmin,
  prepareDropshippingProductForPublic,
  extractAllImageUrls,
  mapCjCategoryToFrenchStore,
  extractCjImages,
  stripHtml,
  pickCjTitle,
  pickCjDescription,
  pickCjCategory,
  buildCjSpecifications,
  usdToXof,
  convertUsdPriceToXof,
  looksLikeUnconvertedCjPrice,
  looksLikeUnconvertedUsdSellingPrice,
  isCjDropshippingProduct,
  resolveCjProductId,
  resolveDropshipSellableStock,
  normalizePublicVariantStocks,
  isPrimarilyChinese,
  pickBestStoredProductName,
  calculateDropshippingMarginXof,
  repairCjDisplayPricing,
};
