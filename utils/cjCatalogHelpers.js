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

function pickCjTitle(cjProduct = {}, detail = null) {
  const candidates = [
    parseCjLocalizedName(detail?.productName),
    detail?.productNameEn,
    cjProduct.name,
    detail?.productNameEn,
    parseCjLocalizedName(detail?.productSku),
  ];
  const title = candidates.find((c) => String(c || '').trim());
  return String(title || 'Produit').trim();
}

function pickCjDescription(cjProduct = {}, detail = null) {
  const raw = detail?.description
    || detail?.productDescription
    || cjProduct.description
    || detail?.remark
    || '';
  const text = stripHtml(raw);
  if (text) return text;
  return pickCjTitle(cjProduct, detail);
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

function ensurePublicSellableStock(doc = {}) {
  const next = { ...doc };
  let stock = toNumber(next.stock, 0);
  if (stock > 0) return next;

  if (Array.isArray(next.variants) && next.variants.length) {
    const variantStock = next.variants.reduce((sum, v) => sum + toNumber(v.stock, 0), 0);
    if (variantStock > 0) {
      next.stock = variantStock;
      return next;
    }
    next.variants = next.variants.map((v) => ({
      ...v,
      stock: v.stock > 0 ? v.stock : toNumber(cjConfig.defaultPublicStock, 50),
    }));
    next.stock = next.variants.reduce((sum, v) => sum + toNumber(v.stock, 0), 0);
    return next;
  }

  if (isCjDropshippingProduct(next) || next.sourceType === 'DROPSHIPPING') {
    next.stock = toNumber(cjConfig.defaultPublicStock, 50);
    next.dropshipStockEstimated = true;
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
    next.shippingInfo = 'Expédition internationale via Dango Import. Délai habituel : 10 à 25 jours ouvrés selon destination.';
    next.estimatedDeliveryDays = next.estimatedDeliveryDays || 15;
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
  doc = ensurePublicSellableStock(doc);
  doc.name = parseCjLocalizedName(doc.name) || doc.name;
  if (doc.shortDescription) {
    doc.shortDescription = stripHtml(doc.shortDescription).slice(0, 220);
  }
  if (doc.description) {
    doc.description = stripHtml(doc.description) || doc.description;
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
  calculateDropshippingMarginXof,
  repairCjDisplayPricing,
};
