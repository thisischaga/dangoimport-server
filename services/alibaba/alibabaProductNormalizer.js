function getDeep(obj, path, fallback = undefined) {
  if (!obj || typeof obj !== 'object') return fallback;
  return path.split('.').reduce((acc, key) => {
    if (acc == null || typeof acc !== 'object') return fallback;
    return Object.prototype.hasOwnProperty.call(acc, key) ? acc[key] : fallback;
  }, obj);
}

function toStringSafe(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function parsePriceNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(String(value).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(num) ? num : null;
}

function normalizeImageEntry(rawImage) {
  if (!rawImage) return null;
  if (typeof rawImage === 'string') {
    return { url: rawImage.trim(), source: 'OTHER', position: 0, isMain: false };
  }
  if (typeof rawImage === 'object') {
    const url = toStringSafe(rawImage.url || rawImage.imageUrl || rawImage.pic_url || rawImage.src || rawImage.path, '');
    if (!url) return null;
    return {
      url,
      source: toStringSafe(rawImage.source || rawImage.role || 'OTHER'),
      position: Number.isFinite(Number(rawImage.position)) ? Number(rawImage.position) : 0,
      isMain: Boolean(rawImage.isMain || rawImage.is_main || rawImage.main),
    };
  }
  return null;
}

function buildImageList(root = {}, fallback = []) {
  const images = [];
  const seen = new Set();
  const pushImage = (value, source = 'OTHER', isMain = false, position = 0) => {
    const normalized = normalizeImageEntry(value);
    if (!normalized) return;
    if (seen.has(normalized.url)) return;
    seen.add(normalized.url);
    images.push({ ...normalized, source, isMain: Boolean(normalized.isMain || isMain), position: position || normalized.position || 0 });
  };

  const directImages = asArray(root.images || root.image_list || root.imageList || root.product_images || root.productImages || root.gallery || root.imgs);
  directImages.forEach((entry, idx) => pushImage(entry, 'GALLERY', false, idx));

  const mainImage = root.mainImage || root.main_image || root.image || root.original_image || root.pic_url || root.picture || root.imageUrl;
  if (mainImage) pushImage(mainImage, 'MAIN', true, 0);

  const album = asArray(root.product_detail_images || root.detail_images || root.detailImages || root.gallery_images || root.galleryImages);
  album.forEach((entry, idx) => pushImage(entry, 'GALLERY', false, idx + 1));

  asArray(fallback).forEach((entry, idx) => pushImage(entry, 'OTHER', false, idx + 10));

  return images;
}

function normalizeAttributes(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const name = toStringSafe(item.attr_name_desc || item.attr_name || item.name || item.key || item.property_name || item.attributeName, '');
        const valueText = toStringSafe(item.attr_value_desc || item.attr_value || item.value || item.property_value || item.attributeValue || item.val, '');
        if (!name && !valueText) return null;
        return {
          name,
          value: valueText,
          nameId: item.attr_name_id ?? item.name_id ?? item.attrNameId ?? null,
          valueId: item.attr_value_id ?? item.value_id ?? item.attrValueId ?? null,
          image: toStringSafe(item.image || item.img || item.imageUrl || item.pictureUrl, ''),
        };
      })
      .filter(Boolean);
  }
  if (typeof value === 'object') {
    return Object.entries(value).map(([name, v]) => ({
      name,
      value: typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : '',
      nameId: null,
      valueId: null,
      image: '',
    })).filter((entry) => entry.value || entry.name);
  }
  return [];
}

function normalizeSkuVariant(rawSku = {}, index = 0) {
  const skuId = toStringSafe(rawSku.skuId || rawSku.sku_id || rawSku.id || rawSku.specId || rawSku.skuID || index, '');
  const sellerSkuId = toStringSafe(rawSku.seller_sku_id || rawSku.sellerSkuId || rawSku.seller_sku_id_ || '', '');
  const productId = toStringSafe(rawSku.productId || rawSku.product_id || rawSku.productid || '', '');

  const ladderPrice = Array.isArray(rawSku.ladder_price) ? rawSku.ladder_price : [];
  const pricing = ladderPrice.length
    ? ladderPrice.map((tier) => ({
        minQuantity: Number(tier.min_quantity ?? tier.minQty ?? 1) || 1,
        maxQuantity: tier.max_quantity ?? tier.maxQty ?? null,
        price: parsePriceNumber(tier.price ?? tier.amount ?? tier.value) ?? 0,
        currency: toStringSafe(tier.currency || rawSku.currency || 'USD', 'USD'),
      }))
    : [{
        minQuantity: 1,
        maxQuantity: null,
        price: parsePriceNumber(rawSku.price ?? rawSku.consignPrice ?? rawSku.sale_price ?? rawSku.unit_price ?? rawSku.retailPrice) ?? 0,
        currency: toStringSafe(rawSku.currency || 'USD', 'USD'),
      }];

  const quantityRaw = parsePriceNumber(rawSku.amount_on_sale ?? rawSku.amountOnSale ?? rawSku.can_book_count ?? rawSku.canBookCount ?? rawSku.available_quantity ?? rawSku.availableQuantity ?? rawSku.inventory_quantity ?? rawSku.stock ?? rawSku.inventory ?? rawSku.quantity);
  const inventory = {
    quantityRaw,
    unit: toStringSafe(rawSku.unit || rawSku.inventory_unit || 'piece', 'piece'),
    shippingFrom: toStringSafe(rawSku.shippingFrom || rawSku.ship_from || rawSku.warehouse || '', ''),
    quantityVerified: false,
    availability: 'UNKNOWN',
    raw: rawSku,
  };

  const normalizedAttributes = normalizeAttributes(rawSku.sku_attr_list || rawSku.attributes || rawSku.attr_list || rawSku.skuAttributes || rawSku.specs);
  const mainImage = toStringSafe(rawSku.skuImageUrl || rawSku.imageUrl || rawSku.image || rawSku.pic_url || rawSku.sku_image || '', '');

  return {
    skuId,
    sellerSkuId,
    productId,
    attributes: normalizedAttributes,
    image: mainImage,
    unit: toStringSafe(rawSku.unit || rawSku.quantityUnit || '', ''),
    status: toStringSafe(rawSku.status || 'NORMAL', 'NORMAL'),
    pricing,
    inventory,
    raw: rawSku,
  };
}

function normalizePricing(payloadRoot = {}, fallbackPrice = null) {
  const rawTiers = asArray(payloadRoot.ladder_price || payloadRoot.ladderPrice || payloadRoot.price_tiers || payloadRoot.priceTiers);
  const tiers = rawTiers
    .map((tier) => ({
      minQuantity: Number(tier.min_quantity ?? tier.minQty ?? 1) || 1,
      maxQuantity: tier.max_quantity ?? tier.maxQty ?? null,
      price: parsePriceNumber(tier.price ?? tier.amount ?? tier.value) ?? 0,
      currency: toStringSafe(tier.currency || payloadRoot.currency || 'USD', 'USD'),
    }))
    .filter((tier) => tier.price > 0);

  return {
    currency: toStringSafe(payloadRoot.currency || 'USD', 'USD'),
    unit: toStringSafe(payloadRoot.unit || payloadRoot.unit_type || '', ''),
    minOrderQuantity: Number(payloadRoot.min_order_quantity ?? payloadRoot.minOrderQuantity ?? 1) || 1,
    tiers,
    sourcePrice: parsePriceNumber(payloadRoot.supplierPrice ?? payloadRoot.price ?? fallbackPrice) ?? null,
    raw: payloadRoot,
  };
}

function normalizeInventory(payloadRoot = {}) {
  const rawQuantity = parsePriceNumber(payloadRoot.amount_on_sale ?? payloadRoot.amountOnSale ?? payloadRoot.can_book_count ?? payloadRoot.canBookCount ?? payloadRoot.available_quantity ?? payloadRoot.availableQuantity ?? payloadRoot.inventory ?? payloadRoot.stock ?? payloadRoot.total_inventory ?? payloadRoot.totalInventory ?? payloadRoot.quantity);
  return {
    unit: toStringSafe(payloadRoot.unit || payloadRoot.unit_type || 'piece', 'piece'),
    quantityRaw: rawQuantity,
    quantityVerified: false,
    availability: rawQuantity !== null && rawQuantity > 0 ? 'AVAILABLE' : 'UNKNOWN',
    shippingFrom: toStringSafe(payloadRoot.shipping_from || payloadRoot.shipFrom || payloadRoot.shippingFrom || '', ''),
    shippingFromList: asArray(payloadRoot.shipping_from_list || payloadRoot.shippingFromList || payloadRoot.shipping_froms || []).map((item) => toStringSafe(item, '')),
    lastCheckedAt: null,
    raw: payloadRoot,
  };
}

function normalizeAlibabaProductSnapshot(rawPayload = {}, mapped = {}) {
  const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  const productSection = payload.raw?.result?.result_data || payload.result?.result_data || payload.result_data || payload.data || payload.product || payload;
  const inventorySection = payload.inventoryRaw?.result?.result_data || payload.inventoryRaw?.result_data || payload.inventoryRaw?.data || payload.inventoryRaw || payload.raw?.inventory || payload.inventory || {};
  const keyAttributesSection = payload.keyAttributesRaw?.result?.result_data || payload.keyAttributesRaw?.result_data || payload.keyAttributesRaw?.data || payload.keyAttributesRaw || payload.raw?.keyAttributes || payload.keyAttributes || {};

  const sourceProductId = String(
    mapped?.sourceProductId ||
    payload.productId ||
    payload.product_id ||
    productSection?.product_id ||
    productSection?.productId ||
    productSection?.id ||
    '',
  ).trim();

  const rawName = toStringSafe(productSection?.subject || productSection?.title || productSection?.name || payload.subject || payload.title || payload.name || mapped?.name || '', '');
  const categoryValue = toStringSafe(productSection?.category_name || productSection?.categoryName || productSection?.category || payload.category || mapped?.category || '', '');
  const categoryIdValue = toStringSafe(productSection?.category_id || productSection?.categoryId || payload.categoryId || '', '');
  const brandValue = toStringSafe(productSection?.brand || productSection?.brand_name || payload.brand || mapped?.brand || '', '');
  const modelNumberValue = toStringSafe(productSection?.model_number || productSection?.modelNumber || payload.modelNumber || '', '');
  const descriptionValue = toStringSafe(productSection?.description || payload.description || mapped?.description || rawName, rawName);
  const sourceUrl = toStringSafe(mapped?.sourceUrl || payload.productUrl || productSection?.product_url || productSection?.productUrl || `https://www.alibaba.com/product-detail/${sourceProductId}.html`, '');
  const sourceEndpoint = toStringSafe(payload.endpoint || payload.path || '', '');
  const sourceCountry = toStringSafe(payload.country || productSection?.country || productSection?.country_code || 'US', 'US');

  const rawVariants = asArray(productSection?.skus || productSection?.skuInfos || productSection?.sku_list || productSection?.skuInfo || productSection?.variants || payload.skuInfos || payload.skus || []);
  const variants = rawVariants.map((sku, index) => normalizeSkuVariant(sku, index));

  const directAttributes = normalizeAttributes(productSection?.attributes || productSection?.product_attrs || productSection?.productAttributes || productSection?.attrs || payload.attributes || keyAttributesSection?.attributes || keyAttributesSection?.productAttrs || keyAttributesSection?.attr_list);
  const supplierRaw = productSection?.supplier || productSection?.seller || payload.supplier || { };
  const mainImage = toStringSafe(mapped?.image || productSection?.image || productSection?.main_image || productSection?.mainImage || productSection?.imageUrl || payload.mainImage || '', '');
  const normalizedImages = buildImageList(productSection, mapped?.images || []);
  const finalImages = normalizedImages.length ? normalizedImages : (Array.isArray(mapped?.images) ? mapped.images : []);
  const primaryImage = finalImages[0]?.url || mainImage || '';

  const productPricing = normalizePricing(productSection?.pricing || productSection?.priceInfo || productSection?.wholesaleTrade || productSection || {}, mapped?.pricing?.supplierPrice ?? null);
  const rawInventory = normalizeInventory(inventorySection || productSection?.inventory || productSection?.stockInfo || {});
  const sourceInventory = mapped?.sourceInventory || {
    rawStock: rawInventory.quantityRaw ?? null,
    verifiedStock: rawInventory.quantityVerified ?? false,
    isSuspicious: rawInventory.quantityRaw != null && rawInventory.quantityRaw > 2147483647,
    unit: rawInventory.unit || 'piece',
    supplyCapacity: '',
  };
  const inventoryData = {
    ...rawInventory,
    availability: rawInventory.quantityRaw !== null && rawInventory.quantityRaw > 0 ? 'AVAILABLE' : 'UNKNOWN',
    rawStock: rawInventory.quantityRaw ?? sourceInventory.rawStock ?? null,
    verifiedStock: rawInventory.quantityVerified ?? Boolean(sourceInventory.verifiedStock) ?? false,
    isSuspicious: rawInventory.quantityRaw != null && rawInventory.quantityRaw > 2147483647 || Boolean(sourceInventory.isSuspicious),
  };

  const normalizedRecord = {
    source: 'ALIBABA',
    sourceProductId,
    externalProductId: toStringSafe(mapped?.externalProductId || sourceProductId, sourceProductId),
    sourceUrl,
    sourceEndpoint,
    sourceCountry,
    name: rawName,
    title: toStringSafe(productSection?.title || productSection?.subject || rawName, rawName),
    description: descriptionValue,
    category: categoryValue,
    categoryId: categoryIdValue,
    brand: brandValue,
    modelNumber: modelNumberValue,
    supplier: {
      name: toStringSafe(supplierRaw.name || supplierRaw.company_name || supplierRaw.seller_name || supplierRaw.loginId || supplierRaw.sellerLoginId || mapped?.supplier?.name || '', ''),
      companyId: toStringSafe(supplierRaw.company_id || supplierRaw.companyId || supplierRaw.e_company_id || supplierRaw.eCompanyId || '', ''),
      country: toStringSafe(supplierRaw.country || supplierRaw.countryName || supplierRaw.shipFromCountryName || '', ''),
      address: toStringSafe(supplierRaw.address || supplierRaw.company_address || '', ''),
      raw: supplierRaw,
    },
    mainImage: primaryImage,
    images: finalImages,
    pricing: {
      ...productPricing,
      sourcePrice: productPricing.sourcePrice ?? parsePriceNumber(mapped?.pricing?.supplierPrice ?? null),
    },
    inventory: inventoryData,
    sourceInventory,
    variants,
    attributes: directAttributes,
    logistics: {
      weight: parsePriceNumber(productSection?.weight || productSection?.gross_weight || productSection?.net_weight || mapped?.weight) ?? null,
      weightUnit: toStringSafe(productSection?.weight_unit || productSection?.weightUnit || 'kg', 'kg'),
      packageLength: parsePriceNumber(productSection?.package_length || productSection?.length) ?? null,
      packageWidth: parsePriceNumber(productSection?.package_width || productSection?.width) ?? null,
      packageHeight: parsePriceNumber(productSection?.package_height || productSection?.height) ?? null,
      dimensionUnit: toStringSafe(productSection?.dimension_unit || productSection?.dimensionUnit || 'cm', 'cm'),
      processingDays: Number(productSection?.processing_days ?? productSection?.processingDays ?? 0) || null,
      raw: productSection?.logistics || productSection?.shipping || {},
    },
    rawPayload: payload,
    normalized: mapped || {},
    rawSections: {
      product: productSection || {},
      inventory: inventorySection || {},
      keyAttributes: keyAttributesSection || {},
    },
    importWarnings: mapped?.importWarnings || [],
    importErrors: mapped?.importErrors || [],
    status: mapped?.importStatus || 'RAW',
    isPublished: Boolean(mapped?.isPublished),
    lastSyncedAt: new Date(),
  };

  const warningList = [];
  if (!normalizedRecord.rawSections.product || Object.keys(normalizedRecord.rawSections.product).length === 0) {
    warningList.push({ code: 'MISSING_PRODUCT_SECTION', message: 'Section produit Alibaba absente dans la réponse brute.', field: 'rawSections.product' });
  }
  if (!normalizedRecord.rawSections.inventory || Object.keys(normalizedRecord.rawSections.inventory).length === 0) {
    warningList.push({ code: 'MISSING_INVENTORY_SECTION', message: 'Section inventaire Alibaba absente dans la réponse brute.', field: 'rawSections.inventory' });
  }
  if (!normalizedRecord.rawSections.keyAttributes || Object.keys(normalizedRecord.rawSections.keyAttributes).length === 0) {
    warningList.push({ code: 'MISSING_KEY_ATTRIBUTES_SECTION', message: 'Section attributs clés Alibaba absente dans la réponse brute.', field: 'rawSections.keyAttributes' });
  }

  normalizedRecord.importWarnings = [...(mapped?.importWarnings || []), ...warningList];
  return normalizedRecord;
}

module.exports = {
  normalizeAlibabaProductSnapshot,
};
