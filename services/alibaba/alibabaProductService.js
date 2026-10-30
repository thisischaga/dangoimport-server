const { alibabaCall } = require('./alibabaClient');
const { alibabaConfig } = require('../../config/alibaba');
const { toNumber } = require('../../utils/dropshippingCalculations');
const { applyAlibabaError } = require('./alibabaErrors');

const REJECTED_API_PATHS = new Set([
  '/alibaba/dropshipping/product/get',
  '/product/get',
  '/alibaba/icbu/product/get',
  '/icbu/product/get',
  '/product/list',
  '/alibaba/icbu/product/list',
  '/alibaba/dropshipping/product/list',
]);

function asImageUrl(raw, depth = 0) {
  if (raw == null || depth > 3) return '';
  if (Array.isArray(raw)) return asImageUrl(raw[0], depth + 1);
  if (typeof raw === 'string') {
    let url = raw.startsWith('//') ? `https:${raw}` : raw.trim();
    if (/^https?:\/\//i.test(url)) {
      // Retirer les suffixes de redimensionnement Alibaba CDN pour obtenir l'image haute définition
      url = url.replace(/_\d+x\d+\.(?:jpg|png|webp|jpeg)/i, '');
      url = url.replace(/\.jpg_\.webp$/i, '.jpg');
      url = url.replace(/\.png_\.webp$/i, '.png');
      return url;
    }
    return '';
  }
  if (typeof raw === 'object') {
    return asImageUrl(
      raw.url || raw.imageUrl || raw.image_url || raw.src || raw.main_url
      || raw.file_url || raw.pic_url || raw.main_image || raw.mainImage
      || raw.image || raw.img || raw.attr_value_image
      || (Array.isArray(raw.multi_image) ? raw.multi_image[0] : '')
      || (Array.isArray(raw.images) ? raw.images[0] : ''),
      depth + 1,
    );
  }
  return '';
}

function firstImage(item = {}) {
  const candidates = [
    item.image?.main_image,
    item.image?.mainImage,
    ...(Array.isArray(item.image?.multi_image) ? item.image.multi_image : []),
    item.main_image_url,
    item.mainImageUrl,
    item.main_image,
    item.mainImage,
    item.image_url,
    item.imageUrl,
    item.img_url,
    item.imgUrl,
    item.pic_url,
    item.picUrl,
    item.product_image,
    item.productImage,
    item.cover_image,
    item.thumbnail,
    item.thumb,
    item.white_image,
    item.image,
    item.media,
    item.basic_info?.main_image,
    item.basic_info?.product_image,
    ...(Array.isArray(item.image_url_list) ? item.image_url_list : []),
    ...(Array.isArray(item.product_images) ? item.product_images : []),
    ...(Array.isArray(item.main_image?.images) ? item.main_image.images : []),
    ...(Array.isArray(item.mainImage?.images) ? item.mainImage.images : []),
    ...(Array.isArray(item.imageList) ? item.imageList : []),
    ...(Array.isArray(item.productImageList) ? item.productImageList : []),
    ...(Array.isArray(item.images) ? item.images : []),
  ];
  for (const raw of candidates) {
    const url = asImageUrl(raw);
    if (url) return url;
  }
  return findImageUrl(item);
}

function findImageUrl(node, depth = 0) {
  if (node == null || depth > 5) return '';
  if (typeof node === 'string') {
    const url = asImageUrl(node);
    if (url && /alicdn|alibaba|\.(jpe?g|png|webp|gif)(\?|$)/i.test(url)) return url;
    return '';
  }
  if (Array.isArray(node)) {
    for (const entry of node.slice(0, 24)) {
      const found = findImageUrl(entry, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof node !== 'object') return '';
  for (const [key, value] of Object.entries(node)) {
    if (/desc|html|title|name|subject|price|token|sign/i.test(key) && !/image|img|pic|photo|media|cover|thumb/i.test(key)) {
      continue;
    }
    const found = findImageUrl(value, depth + 1);
    if (found) return found;
  }
  return '';
}

function sanePrice(n) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 100000 && Number.isInteger(n)) return 0;
  return n;
}

function pickPrice(value, depth = 0) {
  if (value == null || value === '' || depth > 4) return 0;
  if (typeof value === 'number') return sanePrice(value);
  if (typeof value === 'string') {
    const nums = value.replace(/,/g, '').match(/\d+(?:\.\d+)?/g);
    return nums ? sanePrice(Number(nums[0])) : 0;
  }
  if (Array.isArray(value)) {
    const prices = value
      .map((item) => pickPrice(item, depth + 1))
      .filter((p) => p > 0);
    return prices.length ? Math.min(...prices) : 0;
  }
  if (typeof value === 'object') {
    const candidates = [
      value.min_price,
      value.minPrice,
      value.min,
      value.amount,
      value.price,
      value.value,
      value.sale_price,
      value.unit_price,
      value.fob_price,
      value.ladder_price,
      value.ladderPrice,
      value.price_list,
      value.priceList,
      value.tiers,
      value.range_price?.min_price,
      value.range_price,
      value.product_info?.trade_info?.price,
      value.trade_info?.price,
      value.product_info?.price,
      value.priceInfo,
      value.basic_info?.price,
    ];
    for (const candidate of candidates) {
      const found = pickPrice(candidate, depth + 1);
      if (found > 0) return found;
    }
    return 0;
  }
  return 0;
}

function pickCurrency(item = {}) {
  const price = item.price || item.product_info?.trade_info?.price || item.trade_info?.price;
  const raw = item.currency
    || item.price_currency
    || item.product_info?.trade_info?.price?.currency
    || item.trade_info?.price?.currency
    || item.product_info?.basic_info?.currency
    || (price && typeof price === 'object' && (price.currency || price.currency_code))
    || item.moq_and_price?.moq_unit_price?.currency
    || item.priceInfo?.currency
    || item.trade_info?.price?.currency
    || item.product_info?.trade_info?.price?.currency
    || '';
  const code = String(raw || '').trim().toUpperCase();
  if (code === 'CNY' || code === 'RMB' || code === '¥') return 'CNY';
  if (code) return code;
  return 'USD';
}

function extractImages(item = {}) {
  const urls = [];
  const seen = new Set();
  const push = (value) => {
    const url = asImageUrl(value);
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push({ url });
  };
  push(firstImage(item));
  if (item.image?.main_image) push(item.image.main_image);
  if (item.image?.mainImage) push(item.image.mainImage);
  if (Array.isArray(item.image?.multi_image)) item.image.multi_image.forEach(push);
  [
    item.image_url_list,
    item.product_images,
    item.main_image?.images,
    item.mainImage?.images,
    item.imageList,
    item.productImageList,
    item.images,            // peut être string[] ou object[]
    item.basic_info?.product_images,
    item.result_data?.images, // /eco/buyer/product/description
  ].forEach((list) => {
    if (Array.isArray(list)) list.forEach(push);
  });

  // Extraire les images des variantes (skus / skuInfos)
  const skus = Array.isArray(item.skus) ? item.skus : (Array.isArray(item.skuInfos) ? item.skuInfos : []);
  skus.forEach((sku) => {
    push(sku.image || sku.skuImageUrl || sku.imageUrl || sku.pic_url);
    if (Array.isArray(sku.sku_attr_list)) {
      sku.sku_attr_list.forEach((attr) => {
        if (attr.attr_value_image) push(attr.attr_value_image);
      });
    }
  });

  // Extraire les images haute définition de la description HTML
  const desc = item.description || item.result_data?.description || '';
  if (typeof desc === 'string' && desc.includes('<img')) {
    const imgMatches = desc.matchAll(/(?:src|data-src)=["']([^"']+)["']/gi);
    for (const m of imgMatches) {
      if (m && m[1]) push(m[1]);
    }
  }

  return urls;
}

function pickOfferId(item = {}) {
  return String(
    item.offerId
    || item.offer_id
    || item.productID
    || item.productId
    || item.product_id
    || item.item_id
    || item.itemId
    || item.basic_info?.product_id
    || item.product?.product_id
    || item.product?.productId
    || item.id
    || '',
  ).trim();
}

function parseJsonValue(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || (text[0] !== '{' && text[0] !== '[')) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function isProductIdValue(item) {
  return typeof item === 'number'
    || (typeof item === 'string' && /^\d+$/.test(item.trim()));
}

function isOkBuyerCode(code) {
  if (code === undefined || code === null || code === '') return true;
  const value = String(code).toLowerCase();
  return value === '0' || value === '200' || value === 'success' || value === 'ok' || value === 'true';
}

function summarizePayload(payload) {
  const root = payload && typeof payload === 'object' ? payload : {};
  const resultNode = root.result && typeof root.result === 'object' ? root.result : {};
  // /eco/buyer/product/description utilise result.result_data
  if (resultNode.result_data && typeof resultNode.result_data === 'object') {
    const rd = resultNode.result_data;
    return {
      keys: Object.keys(root).filter((key) => !/token|secret|sign/i.test(key)).slice(0, 20),
      resultKeys: Object.keys(resultNode).slice(0, 20),
      resultCode: resultNode.result_code,
      resultMessage: resultNode.result_msg || '',
      dataType: 'result_data',
      dataKeys: Object.keys(rd).slice(0, 25),
      productCount: Array.isArray(rd.skus) ? rd.skus.length : null,
      productKeys: Array.isArray(rd.skus) && rd.skus[0] ? Object.keys(rd.skus[0]).slice(0, 15) : [],
    };
  }
  // Les endpoints /eco/buyer/* peuvent encapsuler dans result.result.data
  const inner = resultNode.result && typeof resultNode.result === 'object' ? resultNode.result : resultNode;
  const data = parseJsonValue(inner.data ?? root.data);
  return {
    keys: Object.keys(root).filter((key) => !/token|secret|sign/i.test(key)).slice(0, 20),
    resultKeys: Object.keys(inner).slice(0, 20),
    resultCode: inner.code || inner.result_code,
    resultMessage: inner.message || inner.msg || inner.result_msg || '',
    dataType: Array.isArray(data) ? `array:${data.length}` : typeof data,
    dataKeys: data && typeof data === 'object' && !Array.isArray(data)
      ? Object.keys(data).slice(0, 20)
      : [],
    productCount: Array.isArray(data?.products) ? data.products.length : null,
    productKeys: data?.products?.[0] && typeof data.products[0] === 'object'
      ? Object.keys(data.products[0]).slice(0, 25)
      : [],
  };
}

function scoreList(arr) {
  if (!Array.isArray(arr) || !arr.length) return 0;
  if (arr.some((item) => item && typeof item === 'object' && pickOfferId(item))) return 3;
  if (arr.every(isProductIdValue)) return 2;
  if (arr.every((item) => item && typeof item === 'object')) return 1;
  return 0;
}

function assertBuyerResult(payload) {
  const inner = payload?.result;
  if (!inner || typeof inner !== 'object') return;
  if (isOkBuyerCode(inner.code)) return;
  const message = inner.message || inner.msg || inner.error_message || `Alibaba result.code=${inner.code}`;
  const err = new Error(String(message));
  err.status = 502;
  err.code = String(inner.code || 'ALIBABA');
  throw applyAlibabaError(err);
}

function flattenBuyerProduct(item = {}, fallbackId = '') {
  if (!item || typeof item !== 'object') return { productId: fallbackId };
  // /eco/buyer/product/description place les données dans result_data directement
  const rd = item.result_data && typeof item.result_data === 'object' ? item.result_data : item;
  const basic = rd.basic_info || rd.product_info?.basic_info || item.basic_info || item.product_info?.basic_info || {};
  const trade = rd.trade_info || rd.product_info?.trade_info || item.trade_info || item.product_info?.trade_info || {};
  // skus depuis result_data (format /eco/buyer/product/description)
  const rdSkus = Array.isArray(rd.skus) ? rd.skus : [];
  const images = extractImages({ ...item, ...rd });
  const titleFields = [
    basic.title, rd.title, rd.subject, rd.product_name, rd.productName, rd.product_title,
    item.title, item.subject, item.product_name, item.productName, item.product_title,
  ];
  const title = titleFields.find((t) => t && String(t).trim()) || '';
  // Prix : trade_info > wholesale_trade > premier ladder_price de skus > price direct
  const wholesaleTrade = rd.wholesale_trade && typeof rd.wholesale_trade === 'object' ? rd.wholesale_trade : null;
  const firstSkuLadderPrice = rdSkus.length && Array.isArray(rdSkus[0].ladder_price) ? rdSkus[0].ladder_price : null;
  const priceRaw = trade.price || wholesaleTrade?.price || wholesaleTrade?.unit_price
    || rd.price || rd.unit_price || firstSkuLadderPrice || item.price || item.unit_price;
  // MOQ : min_order_quantity de result_data ou wholesale_trade
  const moq = trade.moq || trade.min_order_quantity
    || rd.min_order_quantity || wholesaleTrade?.moq || wholesaleTrade?.min_order_quantity
    || item.minOrderQuantity;
  // Catégorie : result_data.category peut être string ou object
  const categoryRaw = rd.category || rd.leaf_category_name || rd.category_name || item.leaf_category_name || item.top_category_name;
  const category = categoryRaw && typeof categoryRaw === 'string' ? categoryRaw : (categoryRaw?.name || categoryRaw?.category_name || '');
  return {
    // Champs de base depuis item (sans les clés internes Alibaba de result_data)
    ...item,
    // Champs calculés — NE PAS spreader ...rd directement (pollue supplier, status, mode_id, etc.)
    productId: basic.product_id || rd.product_id || rd.productId || item.product_id || item.productId || fallbackId,
    subject: title,
    title,
    image: firstImage({ ...item, ...rd }) || images[0]?.url || '',
    images,
    price: pickPrice(priceRaw) || pickPrice(item.price) || pickPrice(item.unit_price),
    currency: pickCurrency({ ...item, ...rd, price: trade.price || rd.price || item.price }),
    minOrderQuantity: moq,
    stock: toNumber(
      rd.amount_on_sale ?? rd.amountOnSale ?? rd.can_book_count ?? rd.canBookCount
      ?? rd.available_quantity ?? rd.availableQuantity ?? rd.inventory ?? rd.stock
      ?? trade.amount_on_sale ?? trade.can_book_count ?? trade.stock ?? trade.inventory
      ?? wholesaleTrade?.amount_on_sale ?? wholesaleTrade?.can_book_count ?? wholesaleTrade?.available_quantity ?? wholesaleTrade?.stock ?? wholesaleTrade?.inventory
      ?? item.amount_on_sale ?? item.amountOnSale ?? item.can_book_count ?? item.canBookCount ?? item.stock ?? item.inventory,
      0,
    ),
    description: rd.description || basic.description || rd.subject || rd.title
      || item.description || item.subject || item.title,
    productUrl: rd.detail_url || rd.permalink || rd.detailUrl || rd.productUrl
      || item.detail_url || item.permalink || item.detailUrl || item.productUrl,
    category,
    skuInfos: rdSkus.length ? rdSkus : (item.skuInfos || item.skuList || item.productSkuInfos || item.product_sku_list || item.sku_info || []),
    videoUrl: rd.video_url || item.video_url || basic.video_url || '',
    wholesaleTrade: wholesaleTrade || item.wholesale_trade || null,
    supplierName: rd.supplier || item.supplier || basic.supplier || '',
    eCompanyId: rd.eCompanyId || item.eCompanyId || '',
    categoryId: rd.category_id || item.category_id || '',
    isCountryRisk: rd.is_country_risk || item.is_country_risk || 'false',
    skus: rdSkus,
  };
}

function mapSearchItem(item = {}) {
  const id = pickOfferId(item);
  const basic = item.basic_info || item.product_info?.basic_info || {};
  const trade = item.trade_info || item.product_info?.trade_info || {};
  const priceNode = trade.price
    || item.moq_and_price?.moq_unit_price
    || item.priceInfo
    || item.referencePrice
    || item.minPrice
    || item.min_price
    || item.unit_price
    || item.price
    || item.product_info?.trade_info?.price;
  const title = basic.title
    || item.title
    || item.subject
    || item.productTitle
    || item.product_title
    || item.product_name
    || item.productName
    || item.name
    || basic.product_name
    || (id ? `Produit Alibaba ${id}` : 'Produit Alibaba');
  return {
    externalProductId: id,
    name: title,
    image: firstImage(item),
    images: extractImages(item),
    supplierPrice: pickPrice(priceNode)
      || pickPrice(item.moq_and_price?.moq_unit_price)
      || pickPrice(item.priceInfo)
      || pickPrice(item.referencePrice)
      || pickPrice(item.minPrice)
      || pickPrice(item.min_price)
      || pickPrice(item.unit_price)
      || pickPrice(item.price),
    currency: pickCurrency({ ...item, price: priceNode }),
    stock: toNumber(
      item.amountOnSale ?? item.quantity ?? item.stock ?? item.inventory
      ?? item.available_quantity ?? trade.stock ?? item.product_info?.trade_info?.stock,
      0,
    ),
    minOrderQuantity: toNumber(item.minOrderQuantity ?? item.moq_and_price?.min_order_quantity ?? item.quantityBegin, 1),
    category: item.leaf_category_name || item.top_category_name || item.categoryName || item.categoryId || '',
    productUrl: item.permalink || item.detail_url || item.detailUrl || item.productUrl || (id ? `https://www.alibaba.com/product-detail/${id}.html` : ''),
    raw: item,
  };
}

function unwrapList(payload) {
  const root = parseJsonValue(payload);
  if (root == null) return [];
  if (Array.isArray(root)) return root;
  if (typeof root !== 'object') return [];
  const resultNode = root.result && typeof root.result === 'object' ? root.result : {};
  // /eco/buyer/* : données dans result.result_data
  if (resultNode.result_data && typeof resultNode.result_data === 'object' && !Array.isArray(resultNode.result_data)) {
    const rd = resultNode.result_data;
    const listInRd = rd.products || rd.product_list || rd.productList || rd.product_id_list || rd.product_ids || rd.dataList;
    if (Array.isArray(listInRd)) {
      return listInRd;
    }
    // Objet produit unique (ex: /eco/buyer/product/description)
    if (rd.product_id || rd.skus || rd.detail_url || rd.basic_info || rd.trade_info || (rd.title && (rd.description || rd.images || rd.price))) {
      return [{ result_data: rd, ...rd }];
    }
  }
  // Autres /eco/buyer/* : result.result.data (double nesting) ou result.data
  const innerResult = resultNode.result && typeof resultNode.result === 'object' ? resultNode.result : resultNode;
  const data = parseJsonValue(innerResult.data ?? root.result?.data ?? root.data);
  if (Array.isArray(data)) return data;
  const preferred = parseJsonValue(data?.products ?? data?.product_list ?? data?.dataList ?? data?.productList ?? data?.result);
  if (Array.isArray(preferred)) return preferred;
  if (data?.product && typeof data.product === 'object' && !Array.isArray(data.product)) {
    return [data.product];
  }
  if (data && typeof data === 'object' && !Array.isArray(data) && (pickOfferId(data) || data.basic_info || data.product_info || data.sku_info || data.trade_info)) {
    return [data];
  }
  if (root.product && typeof root.product === 'object' && !Array.isArray(root.product)) {
    return [root.product];
  }

  let best = [];
  let bestScore = 0;
  const consider = (arr, key = '') => {
    let score = scoreList(arr);
    if (score && /product_id|productId|dataList|item_data|products|productList|offer_id|item_ids|search_result/i.test(key)) {
      score += 2;
    }
    if (score > bestScore) {
      best = arr;
      bestScore = score;
    }
  };
  const queue = [root];
  const seen = new Set();
  while (queue.length) {
    const node = parseJsonValue(queue.shift());
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      consider(node);
      continue;
    }
    for (const [key, value] of Object.entries(node)) {
      if (/token|secret|sign|^code$|request_id|_trace_id_|message|^msg$/i.test(key)) continue;
      if (typeof value === 'string' && /^\d+(?:\s*,\s*\d+)+$/.test(value.trim())) {
        consider(value.split(',').map((part) => part.trim()).filter(Boolean), key);
        continue;
      }
      const parsed = parseJsonValue(value);
      if (Array.isArray(parsed)) {
        consider(parsed, key);
        continue;
      }
      queue.push(parsed);
    }
  }
  if (bestScore > 0) return best;
  if (pickOfferId(root)) return [root];
  return [];
}

function extractIdList(payload) {
  const list = unwrapList(payload);
  if (list.length && list.every(isProductIdValue)) {
    return list.map((item) => String(item).trim());
  }
  return null;
}

function listFromSearchPayload(payload) {
  const ids = extractIdList(payload);
  const items = unwrapList(payload);
  return { ids, items };
}

function extractProductId(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const fromUrl = raw.match(/product-detail\/[^/?#]*?_(\d{6,})/i)
    || raw.match(/_(\d{8,})\.html/i)
    || raw.match(/[?&](?:offerId|productId|id)=(\d{6,})/i);
  if (fromUrl) return fromUrl[1];
  if (/^\d{6,}$/.test(raw)) return raw;
  return '';
}

function keywordRequiredError() {
  const err = new Error('Indiquez un mot-clé, un ID produit Alibaba.com ou une URL product-detail.');
  err.status = 400;
  err.code = 'PRODUCT_ID_REQUIRED';
  return err;
}

function assertAllowedPath(path) {
  if (REJECTED_API_PATHS.has(path)) {
    const err = new Error(`Chemin Alibaba déjà rejeté (invalid path) : ${path}`);
    err.status = 502;
    err.code = 'INVALID_API_PATH';
    throw applyAlibabaError(err);
  }
}

function permissionDeniedOnProductGet(error) {
  if (error?.code === 'NO_API_PERMISSION' && String(error.message || '').includes('ALIBABA_PRODUCT_GET_PATH')) {
    return error;
  }
  const wrapped = applyAlibabaError(error);
  if (wrapped.code === 'NO_API_PERMISSION') {
    wrapped.message = `Alibaba refuse ${alibabaConfig.productGetPath} : App does not have permission to access this api. `
      + 'Ce Path doit être Get Product Description acheteur (/eco/buyer/product/description), pas une API vendeur ICBU.';
  }
  return wrapped;
}

function mapPayloadItem(item, fallbackId) {
  const flat = flattenBuyerProduct(typeof item === 'object' ? item : { productId: item }, fallbackId);
  const mapped = mapSearchItem({ ...flat, offerId: pickOfferId(flat) || fallbackId });
  return {
    ...mapped,
    // mapSearchItem écrase category avec ses propres clés ; on restaure celle de flattenBuyerProduct
    category: flat.category || mapped.category || '',
    description: flat.description || '',
    weight: flat.productShippingInfo?.weight || flat.weight || flat.netWeight || flat.logistics_info?.weight,
    skuInfos: flat.skuInfos || flat.skuList || flat.productSkuInfos || flat.product_sku_list || flat.sku_info || [],
    videoUrl: flat.videoUrl || '',
    wholesaleTrade: flat.wholesaleTrade || null,
    supplierName: flat.supplierName || '',
    eCompanyId: flat.eCompanyId || '',
    categoryId: flat.categoryId || '',
    isCountryRisk: flat.isCountryRisk || 'false',
    skus: flat.skus || [],
    raw: item,
  };
}

async function fetchProductById(id) {
  const path = alibabaConfig.productGetPath;
  assertAllowedPath(path);
  let payload;
  try {
    payload = await alibabaCall(path, {
      query_req: {
        product_id: String(id),
        country: alibabaConfig.defaultCountry || 'US',
      },
    });
  } catch (error) {
    throw permissionDeniedOnProductGet(error);
  }
  // Log de diagnostic toujours actif pour déboguer la structure réelle de la réponse Alibaba
  try {
    const diagSafe = JSON.parse(JSON.stringify(payload ?? {}, (key, value) => {
      if (/token|secret|sign|app_key/i.test(key)) return '***';
      return value;
    }));
    const topKeys = Object.keys(diagSafe);
    const resultNode = diagSafe.result && typeof diagSafe.result === 'object' ? diagSafe.result : {};
    const innerResult = resultNode.result && typeof resultNode.result === 'object' ? resultNode.result : resultNode;
    console.warn('[alibaba-diag] fetchProductById', id, 'path=' + path,
      'topKeys=' + JSON.stringify(topKeys),
      'resultKeys=' + JSON.stringify(Object.keys(resultNode).slice(0, 15)),
      'innerResultKeys=' + JSON.stringify(Object.keys(innerResult).slice(0, 15)),
      'innerDataType=' + (Array.isArray(innerResult.data) ? 'array:' + innerResult.data.length : typeof innerResult.data),
      'resultDataKeys=' + JSON.stringify(Object.keys(resultNode.result_data || {}).slice(0, 20)),
      'summary=' + JSON.stringify(diagSafe).slice(0, 2000),
    );
  } catch (_e) { /* silent */ }
  const isEnvelope = (node) => Boolean(
    node && typeof node === 'object'
    && !pickOfferId(node)
    && (node.request_id || (node.code != null && node.data !== undefined && node.message != null)),
  );
  const resultNode2 = payload?.result && typeof payload.result === 'object' ? payload.result : {};
  // /eco/buyer/product/description : result.result_data
  const nested = resultNode2.result_data && typeof resultNode2.result_data === 'object'
    ? { result_data: resultNode2.result_data, ...resultNode2.result_data }
    : parseJsonValue(
        (resultNode2.result && typeof resultNode2.result === 'object' ? resultNode2.result : resultNode2).data
        ?? payload?.result?.data ?? payload?.data,
      );
  let product = unwrapList(payload)[0];
  if (isEnvelope(product)) product = null;
  if (!product) {
    product = nested?.product
      || (nested && typeof nested === 'object' && !Array.isArray(nested) && !Array.isArray(nested.products) ? nested : null)
      || payload?.product
      || null;
  }
  if (!product && nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const hasUsableData = Boolean(
      nested.basic_info
      || nested.trade_info
      || nested.product_info
      || nested.title
      || nested.subject
      || nested.description
    );
    if (hasUsableData) {
      product = { ...nested, productId: id };
    }
  }
  if (isEnvelope(product) || !product || typeof product !== 'object' || Array.isArray(product)) {
    const err = new Error('Produit Alibaba introuvable pour cet ID.');
    err.status = 404;
    err.code = 'PRODUCT_NOT_FOUND';
    throw err;
  }
  const mapped = mapPayloadItem(product, id);
  if (!mapped.externalProductId) {
    const err = new Error('Produit Alibaba introuvable pour cet ID.');
    err.status = 404;
    err.code = 'PRODUCT_NOT_FOUND';
    throw err;
  }
  return mapped;
}

async function hydrateProductIds(ids, size) {
  const slice = ids.slice(0, Math.min(size, 8));
  const items = await Promise.all(slice.map(async (id) => {
    try {
      return await fetchProductById(id);
    } catch {
      return mapSearchItem({ productId: String(id) });
    }
  }));
  return items.filter((item) => item.externalProductId);
}

function paginateFromPayload(payload, list, page, size) {
  const resultNode3 = payload?.result && typeof payload.result === 'object' ? payload.result : {};
  const innerResult3 = resultNode3.result && typeof resultNode3.result === 'object' ? resultNode3.result : resultNode3;
  const paging = innerResult3.pagination || payload?.result?.pagination || {};
  const total = toNumber(
    paging.total_product_count
    ?? paging.total
    ?? paging.total_count
    ?? paging.totalCount
    ?? payload?.result?.result_total
    ?? payload?.totalRecords
    ?? payload?.total_item
    ?? payload?.totalCount,
    list.length,
  );
  const totalPages = toNumber(
    paging.page_count
    ?? paging.totalPages,
    Math.max(1, Math.ceil(total / size) || 1),
  );
  return {
    products: list,
    pagination: {
      currentPage: toNumber(paging.current, page),
      totalPages: Math.max(1, totalPages),
      totalRecords: total,
      itemsPerPage: toNumber(paging.page_size, size),
    },
  };
}

function isGenericAlibabaName(name) {
  return !String(name || '').trim() || /^produit(\s+alibaba)?\s+\d+$/i.test(String(name).trim());
}

function mergeCatalogProduct(primary, secondary) {
  if (!primary) return secondary || null;
  if (!secondary) return primary;
  const primaryPrice = pickPrice(primary.supplierPrice);
  const secondaryPrice = pickPrice(secondary.supplierPrice);
  const supplierPrice = primaryPrice || secondaryPrice;
  const images = (primary.images && primary.images.length) ? primary.images : (secondary.images || []);
  return {
    ...secondary,
    ...primary,
    name: isGenericAlibabaName(primary.name) ? (secondary.name || primary.name) : primary.name,
    image: primary.image || secondary.image || images[0]?.url || '',
    images,
    supplierPrice,
    currency: primaryPrice ? primary.currency : (secondary.currency || primary.currency),
    // Alibaba = sur commande, pas de stock fixe : 0 si aucune API ne retourne de stock réel
    stock: toNumber(primary.stock, 0) || toNumber(secondary.stock, 0) || 0,
    minOrderQuantity: toNumber(primary.minOrderQuantity, 0) || toNumber(secondary.minOrderQuantity, 1) || 1,
    description: (!primary.description || primary.description === primary.name)
      ? (secondary.description || primary.description || '')
      : primary.description,
    skuInfos: (primary.skuInfos && primary.skuInfos.length) ? primary.skuInfos : (secondary.skuInfos || []),
    category: primary.category && primary.category !== 'Général'
      ? primary.category
      : (secondary.category || primary.category || ''),
    productUrl: primary.productUrl || secondary.productUrl,
    raw: { ...(secondary.raw || {}), ...(primary.raw || {}) },
    externalProductId: primary.externalProductId || secondary.externalProductId,
  };
}

async function runBuyerSearch(keyword, page, size) {
  const searchPath = alibabaConfig.productSearchPath;
  assertAllowedPath(searchPath);
  const payload = await alibabaCall(searchPath, {
    keyword,
    country: alibabaConfig.defaultCountry,
    index: page,
    page_index: page,
    size,
    page_size: size,
  });
  assertBuyerResult(payload);
  // Log de diagnostic toujours actif
  try {
    const diagSafe = JSON.parse(JSON.stringify(payload ?? {}, (key, value) => {
      if (/token|secret|sign|app_key/i.test(key)) return '***';
      return value;
    }));
    const resultNode = diagSafe.result && typeof diagSafe.result === 'object' ? diagSafe.result : {};
    const innerResult = resultNode.result && typeof resultNode.result === 'object' ? resultNode.result : resultNode;
    const summary = summarizePayload(payload);
    console.warn('[alibaba-diag] runBuyerSearch', JSON.stringify(keyword).slice(0, 60), 'page=' + page,
      'topKeys=' + JSON.stringify(Object.keys(diagSafe).slice(0, 10)),
      'resultKeys=' + JSON.stringify(Object.keys(resultNode).slice(0, 15)),
      'innerResultKeys=' + JSON.stringify(Object.keys(innerResult).slice(0, 15)),
      'innerDataType=' + (Array.isArray(innerResult.data) ? 'array:' + innerResult.data.length : typeof innerResult.data),
      'summary=' + JSON.stringify(summary),
    );
  } catch (_e) { /* silent */ }
  const { ids, items } = listFromSearchPayload(payload);
  const list = ids
    ? await hydrateProductIds(ids, size)
    : items.map((item) => mapPayloadItem(item)).filter((item) => item.externalProductId);
  if (!list.length) {
    console.warn('[alibaba] searchProducts empty', summarizePayload(payload));
  }
  return paginateFromPayload(payload, list, page, size);
}

async function searchAlibabaProducts(params = {}) {
  const page = Math.max(1, toNumber(params.page, 1));
  const size = Math.min(30, Math.max(1, toNumber(params.size, 20)));
  const keyword = String(params.keyword || '').trim();
  const productId = extractProductId(keyword);
  if (productId) {
    let fromGet = null;
    try {
      fromGet = await fetchProductById(productId);
    } catch (error) {
      fromGet = { __error: error };
    }
    let fromSearch = null;
    try {
      const searched = await runBuyerSearch(productId, 1, size);
      fromSearch = (searched.products || []).find((item) => item.externalProductId === productId) || null;
    } catch {
      fromSearch = null;
    }
    const merged = mergeCatalogProduct(
      fromGet && !fromGet.__error ? fromGet : null,
      fromSearch,
    );
    if (merged?.externalProductId) return paginateFromPayload({}, [merged], 1, size);
    if (fromGet?.__error) throw permissionDeniedOnProductGet(fromGet.__error);
  }

  if (keyword) {
    try {
      return await runBuyerSearch(keyword, page, size);
    } catch (error) {
      throw applyAlibabaError(error);
    }
  }

  const listPath = alibabaConfig.productListPath;
  assertAllowedPath(listPath);
  try {
    const payload = await alibabaCall(listPath, {
      query_req: {
        pool_id: alibabaConfig.defaultPoolId,
        page_index: page,
        page_size: size,
        country: alibabaConfig.defaultCountry,
        product_type: alibabaConfig.defaultProductType || 'wholesale',
      },
    });
    assertBuyerResult(payload);
    const { ids, items } = listFromSearchPayload(payload);
    const list = ids
      ? await hydrateProductIds(ids, size)
      : items.map((item) => mapPayloadItem(item)).filter((item) => item.externalProductId);
    if (!list.length) {
      console.warn('[alibaba] product check empty', summarizePayload(payload));
    }
    return paginateFromPayload(payload, list, page, size);
  } catch (error) {
    throw applyAlibabaError(error);
  }
}

async function fetchProductInventory(id) {
  try {
    const payload = await alibabaCall('/eco/buyer/product/inventory', {
      inv_req: {
        product_id: String(id),
        country: alibabaConfig.defaultCountry || 'US',
      },
    });
    const resultNode = payload?.result && typeof payload.result === 'object' ? payload.result : {};
    const data = parseJsonValue(
      resultNode.result_data ?? resultNode.data
      ?? ((resultNode.result && typeof resultNode.result === 'object') ? resultNode.result.data : undefined)
      ?? payload?.data,
    );
    console.warn('[alibaba-diag] fetchProductInventory', id, 'keys=' + JSON.stringify(data && typeof data === 'object' ? Object.keys(data).slice(0, 20) : data));
    return data;
  } catch (error) {
    console.warn('[alibaba] fetchProductInventory notice:', error.message);
    return null;
  }
}

async function fetchProductKeyAttributes(id) {
  try {
    const payload = await alibabaCall('/eco/buyer/product/keyattributes', {
      query_req: {
        product_id: String(id),
        country: alibabaConfig.defaultCountry || 'US',
      },
    });
    const resultNode = payload?.result && typeof payload.result === 'object' ? payload.result : {};
    const data = parseJsonValue(
      resultNode.result_data ?? resultNode.data
      ?? ((resultNode.result && typeof resultNode.result === 'object') ? resultNode.result.data : undefined)
      ?? payload?.data,
    );
    return data;
  } catch (error) {
    console.warn('[alibaba] fetchProductKeyAttributes notice:', error.message);
    return null;
  }
}

async function fetchProductFromCheck(id) {
  const path = alibabaConfig.productListPath;
  if (!path || path !== '/eco/buyer/product/check') return null;
  try {
    const payload = await alibabaCall(path, {
      query_req: {
        product_ids: [String(id)],
        product_id_list: [String(id)],
        country: alibabaConfig.defaultCountry || 'US',
        product_type: alibabaConfig.defaultProductType || 'wholesale',
        index: 1,
        size: 20,
        page_size: 20,
      },
    });
    const items = unwrapList(payload);
    if (items.length) {
      const found = items.find((it) => pickOfferId(it) === id) || items[0];
      return mapPayloadItem(found, id);
    }
    return null;
  } catch (error) {
    console.warn('[alibaba] fetchProductFromCheck notice:', error.message);
    return null;
  }
}

const SPEC_TRANSLATIONS = {
  color: 'Couleur',
  colour: 'Couleur',
  capacity: 'Capacité',
  volume: 'Volume',
  material: 'Matériau',
  materials: 'Matériaux',
  size: 'Taille',
  dimensions: 'Dimensions',
  dimension: 'Dimensions',
  weight: 'Poids',
  brand: 'Marque',
  brand_name: 'Marque',
  model: 'Modèle',
  model_number: 'Numéro de modèle',
  feature: 'Fonctionnalité',
  features: 'Fonctionnalités',
  function: 'Fonction',
  certification: 'Certification',
  certifications: 'Certifications',
  origin: 'Origine',
  place_of_origin: "Lieu d'origine",
  package: 'Emballage',
  packaging: 'Emballage',
  warranty: 'Garantie',
  gender: 'Genre',
  style: 'Style',
  type: 'Type',
  usage: 'Utilisation',
  application: 'Application',
  pattern: 'Motif',
  season: 'Saison',
  shape: 'Forme',
  drinkware_type: 'Type de récipient',
  plastic_type: 'Type de plastique',
  thermal_insulation_performance: 'Isolation thermique',
  water_flowing_method: "Mode d'écoulement",
  boiling_water: 'Résistance eau bouillante',
  bottle_mouth: 'Goulot',
  outdoor_activity: 'Activité',
  supply_type: "Type d'approvisionnement",
};

function extractAlibabaSpecifications(source = {}) {
  const specs = [];
  const seenKeys = new Set();

  const add = (rawKey, rawVal) => {
    if (!rawKey || rawVal == null) return;
    let key = String(rawKey).trim().replace(/_/g, ' ');
    const value = String(rawVal).trim();
    if (!key || !value || value.startsWith('http') || value.length > 500) return;
    
    // Traduire la clé en français si connue
    const kNormalized = key.toLowerCase().replace(/\s+/g, '_');
    if (SPEC_TRANSLATIONS[kNormalized]) {
      key = SPEC_TRANSLATIONS[kNormalized];
    } else {
      key = key.charAt(0).toUpperCase() + key.slice(1);
    }

    const kLower = key.toLowerCase();
    if (seenKeys.has(kLower)) return;
    seenKeys.add(kLower);
    specs.push({ key, value });
  };

  // 1. Extraire depuis sku_attr_list de skuInfos
  const skuList = Array.isArray(source.skuInfos)
    ? source.skuInfos
    : (Array.isArray(source.raw?.skuInfos) ? source.raw.skuInfos : []);
  const attrMap = new Map();
  skuList.forEach((sku) => {
    const list = Array.isArray(sku.sku_attr_list) ? sku.sku_attr_list : [];
    list.forEach((attr) => {
      const name = attr.attr_name_desc || attr.attr_name || attr.name;
      const val = attr.attr_value_desc || attr.attr_value || attr.value;
      if (name && val) {
        if (!attrMap.has(name)) attrMap.set(name, new Set());
        attrMap.get(name).add(String(val).trim());
      }
    });
  });
  for (const [name, valSet] of attrMap.entries()) {
    add(name, Array.from(valSet).join(', '));
  }

  // 2. Extraire depuis keyAttributes (API /eco/buyer/product/keyattributes)
  const keyAttrs = source.raw?.keyAttributes || source.keyAttributes || {};
  const attrsFromKey = keyAttrs.attributes
    || keyAttrs.attribute_list
    || keyAttrs.attr_list
    || keyAttrs.product_attributes
    || keyAttrs.property_list
    || (Array.isArray(keyAttrs) ? keyAttrs : null);

  if (Array.isArray(attrsFromKey)) {
    attrsFromKey.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const k = item.attr_name_desc || item.attr_name || item.attributeName || item.prop_name || item.name || item.key;
      const v = item.attr_value_desc || item.attr_value || item.attributeValue || item.prop_value || item.value;
      add(k, v);
    });
  } else if (keyAttrs && typeof keyAttrs === 'object') {
    const ignore = new Set(['result', 'code', 'message', 'msg', 'request_id', '_trace_id_', 'title', 'subject', 'images', 'image', 'weight']);
    for (const [k, v] of Object.entries(keyAttrs)) {
      if (ignore.has(k)) continue;
      if (typeof v === 'string' || typeof v === 'number') {
        add(k, v);
      }
    }
  }

  // 3. Extraire depuis les attributs et propriétés du produit (fromGet / raw / result_data)
  const rawObj = source.raw || {};
  const rdObj = rawObj.result_data || source.result_data || {};
  const productAttrs = rawObj.product_attributes
    || rawObj.attributes
    || rawObj.property_list
    || rawObj.properties
    || rdObj.properties
    || rdObj.attributes
    || rdObj.product_attributes
    || rdObj.product_properties
    || source.product_attributes;

  if (Array.isArray(productAttrs)) {
    productAttrs.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const k = item.attr_name_desc || item.attr_name || item.attributeName || item.prop_name || item.name || item.key || item.property_name;
      const v = item.attr_value_desc || item.attr_value || item.attributeValue || item.prop_value || item.value || item.property_value;
      add(k, v);
    });
  } else if (productAttrs && typeof productAttrs === 'object') {
    for (const [k, v] of Object.entries(productAttrs)) {
      if (typeof v === 'string' || typeof v === 'number') {
        add(k, v);
      }
    }
  }

  // 4. Extraire depuis les tables et définitions HTML contenues dans la description
  const rawHtml = String(source.description || rawObj.description || rdObj.description || '');
  if (rawHtml.includes('<tr') || rawHtml.includes('<dl') || rawHtml.includes('class="do-entry')) {
    const trMatches = rawHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    for (const tr of trMatches) {
      const cells = [...tr[1].matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)]
        .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      if (cells.length >= 2 && cells[0].length < 60 && cells[1].length < 300) {
        if (!/^(image|photo|picture|action|select|#|n°)$/i.test(cells[0])) {
          add(cells[0], cells[1]);
        }
      }
    }
    const dlMatches = rawHtml.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi);
    for (const dl of dlMatches) {
      const k = dl[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const v = dl[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (k && v && k.length < 60 && v.length < 300) add(k, v);
    }
  }

  // 5. Caractéristiques physiques et commerciales clés
  if (source.weight) {
    add('Poids', `${source.weight} kg`);
  }
  if (source.minOrderQuantity && Number(source.minOrderQuantity) > 1) {
    add('Quantité minimale (MOQ)', `${source.minOrderQuantity} pièce(s)`);
  }
  if (source.brand && !/^(produit(\s+alibaba)?|alibaba(\.com)?)$/i.test(String(source.brand).trim())) {
    add('Marque', source.brand);
  }

  return specs;
}

async function getAlibabaProductDetail(productId) {
  const id = extractProductId(productId) || String(productId || '').trim();
  if (!id) throw keywordRequiredError();

  const [fromGetResult, keyAttrsResult, invResult, checkResult, searchResult] = await Promise.allSettled([
    fetchProductById(id),
    fetchProductKeyAttributes(id),
    fetchProductInventory(id),
    fetchProductFromCheck(id),
    runBuyerSearch(id, 1, 8),
  ]);

  const fromGet = fromGetResult.status === 'fulfilled' ? fromGetResult.value : null;
  const keyAttrs = keyAttrsResult.status === 'fulfilled' ? keyAttrsResult.value : null;
  const inv = invResult.status === 'fulfilled' ? invResult.value : null;
  const fromCheck = checkResult.status === 'fulfilled' ? checkResult.value : null;
  const searched = searchResult.status === 'fulfilled' ? searchResult.value : null;
  const fromSearch = (searched?.products || []).find((item) => item.externalProductId === id) || null;

  // Si /check a répondu avec trade_info/prix, on fusionne /check en primary et /description en secondary
  const baseFromCheckAndGet = mergeCatalogProduct(fromCheck, fromGet);

  // Unpack inventory data & SKU variants
  const invStock = toNumber(
    inv?.amount_on_sale ?? inv?.amountOnSale ?? inv?.can_book_count ?? inv?.canBookCount
    ?? inv?.available_quantity ?? inv?.inventory ?? inv?.stock ?? inv?.total_stock ?? inv?.total_inventory,
    0,
  );
  const invSkus = parseJsonValue(inv?.sku_list ?? inv?.sku_inventory ?? inv?.sku_infos ?? inv?.skus ?? inv?.productSkuInfos);
  const rawSkuList = Array.isArray(invSkus) ? invSkus : (fromGet?.skuInfos || []);

  const extractSkuStock = (s) => toNumber(
    s?.amount_on_sale ?? s?.amountOnSale ?? s?.can_book_count ?? s?.canBookCount
    ?? s?.available_quantity ?? s?.availableQuantity ?? s?.inventory_quantity
    ?? s?.stock ?? s?.inventory ?? s?.quantity,
    0,
  );

  const productTotalStock = toNumber(
    invStock || fromGet?.stock || fromSearch?.stock,
    0,
  );
  const hasIndividualStock = rawSkuList.some((s) => extractSkuStock(s) > 0);
  // Alibaba = sur commande : 0 si aucun stock réel fourni par l'API (ne pas inventer 50)
  const targetStock = productTotalStock > 0 ? productTotalStock : 0;
  const fallbackPerSku = targetStock > 0 ? Math.max(1, Math.floor(targetStock / (rawSkuList.length || 1))) : 0;

  const skuInfos = rawSkuList.map((sku, index) => {
    // Nom du SKU : construit depuis sku_attr_list (format result_data.skus) ou nom direct
    let skuName = sku.skuName || sku.sku_name || sku.name || sku.specName || '';
    if (!skuName && Array.isArray(sku.sku_attr_list) && sku.sku_attr_list.length) {
      skuName = sku.sku_attr_list
        .map((attr) => {
          let nameDesc = (attr.attr_name_desc || attr.attr_name || '').trim();
          if (/^color$/i.test(nameDesc)) nameDesc = 'Couleur';
          else if (/^size$/i.test(nameDesc)) nameDesc = 'Taille';
          else if (/^eur size$/i.test(nameDesc)) nameDesc = 'Pointure';
          let valDesc = (attr.attr_value_desc || attr.attr_value || '').trim();
          const lowerVal = valDesc.toLowerCase();
          const colorMap = {
            black: 'Noir', white: 'Blanc', red: 'Rouge', blue: 'Bleu', green: 'Vert',
            yellow: 'Jaune', orange: 'Orange', purple: 'Violet', pink: 'Rose', grey: 'Gris',
            gray: 'Gris', brown: 'Marron', khaki: 'Kaki', beige: 'Beige', navy: 'Bleu marine',
            'dark blue': 'Bleu foncé', 'light blue': 'Bleu ciel', 'army green': 'Vert armée',
          };
          if (colorMap[lowerVal]) valDesc = colorMap[lowerVal];
          return `${nameDesc}: ${valDesc}`.trim();
        })
        .filter(Boolean)
        .join(' / ');
    }
    if (!skuName) skuName = `Variante ${index + 1}`;
    // Prix : ladder_price (tiered) > price direct
    const ladderPrice = Array.isArray(sku.ladder_price) ? sku.ladder_price : null;
    const skuPrice = pickPrice(sku.price || sku.consignPrice || sku.sale_price || sku.unit_price || sku.retailPrice)
      || pickPrice(ladderPrice);
    // Devise : depuis ladder_price[0].currency ou sku.currency
    const skuCurrency = (ladderPrice?.[0]?.currency) || sku.currency || 'USD';
    const rawStock = extractSkuStock(sku);
    const skuStock = hasIndividualStock
      ? (rawStock > 0 ? rawStock : (String(sku.status || 'NORMAL').toUpperCase() === 'NORMAL' ? fallbackPerSku : 0))
      : 0;
    return {
      skuId: String(sku.skuId || sku.sku_id || sku.specId || sku.id || index),
      name: skuName,
      price: skuPrice,
      stock: skuStock,
      image: asImageUrl(sku.skuImageUrl || sku.imageUrl || sku.image || sku.pic_url || ''),
      currency: skuCurrency,
      // Préserver les données originales pour le mapper de variantes en aval
      sku_attr_list: Array.isArray(sku.sku_attr_list) ? sku.sku_attr_list : [],
      ladder_price: ladderPrice || [],
      status: sku.status || 'NORMAL',
      seller_sku_id: sku.seller_sku_id || sku.sellerSkuId || '',
    };
  });

  const finalStock = hasIndividualStock
    ? skuInfos.reduce((acc, s) => acc + (s.stock || 0), 0)
    : productTotalStock;

  // Key attributes
  const keyTitle = keyAttrs?.title || keyAttrs?.subject || keyAttrs?.product_name || keyAttrs?.product_title;
  const keyCategory = keyAttrs?.category_name || keyAttrs?.leaf_category_name || keyAttrs?.category;
  const keyWeight = keyAttrs?.weight || keyAttrs?.net_weight || keyAttrs?.gross_weight || keyAttrs?.productShippingInfo?.weight;
  const keyImages = extractImages(keyAttrs || {});

  // Best Price
  const baseProduct = baseFromCheckAndGet || fromGet;
  const skuMinPrice = skuInfos.map((s) => s.price).filter((p) => p > 0).sort((a, b) => a - b)[0] || 0;
  const price = pickPrice(baseProduct?.supplierPrice)
    || pickPrice(fromSearch?.supplierPrice)
    || skuMinPrice
    || pickPrice(inv?.price);

  // Best Title / Name
  const candidateName = baseProduct?.name || fromSearch?.name || keyTitle;
  const finalName = !isGenericAlibabaName(candidateName)
    ? candidateName
    : (keyTitle || fromSearch?.name || `Produit Alibaba ${id}`);

  // Best Images
  const allImages = []
    .concat(fromSearch?.images || [], fromGet?.images || [], keyImages)
    .filter((img) => img && (typeof img === 'string' ? img : img.url));
  const uniqueImages = [];
  const seenUrls = new Set();
  allImages.forEach((img) => {
    const url = typeof img === 'string' ? img : img.url;
    if (url && !seenUrls.has(url)) {
      seenUrls.add(url);
      uniqueImages.push({ url });
    }
  });

  const finalImage = fromSearch?.image || keyImages[0]?.url || fromGet?.image || uniqueImages[0]?.url || '';

  const specifications = extractAlibabaSpecifications({
    ...(fromGet || {}),
    skuInfos,
    raw: {
      ...(fromSearch?.raw || {}),
      ...(fromGet?.raw || {}),
      keyAttributes: keyAttrs,
      inventory: inv,
    },
    weight: keyWeight != null ? String(keyWeight) : (fromGet?.weight || ''),
    minOrderQuantity: fromSearch?.minOrderQuantity || fromGet?.minOrderQuantity || 1,
  });

  const cleanedDescription = (() => {
    const rawDesc = fromGet?.description || '';
    if (!rawDesc || typeof rawDesc !== 'string') return finalName;
    let text = rawDesc;
    text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
    text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
    text = text.replace(/#detail_decorate_root[^{]*\{[^}]*\}/gi, ' ');
    text = text.replace(/@media[^{]*\{[^{}]*\{[^}]*\}[^}]*\}/gi, ' ');
    text = text.replace(/([#\.\w\-\s,>:+*]+)\{[^}]*\}/g, ' ');
    text = text.replace(/<[^>]+>/g, ' ');
    text = text.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#39;/gi, "'").replace(/&quot;/gi, '"');
    text = text.replace(/\s+/g, ' ').trim();
    if (text.length < 25 || /^([#\.\w\-\s,>:+*]+;)+$/.test(text) || text.startsWith('#detail_decorate_root')) {
      const specText = specifications.slice(0, 6).map((s) => `${s.key}: ${s.value}`).join(' · ');
      return specText ? `${finalName}. ${specText}.` : finalName;
    }
    return text.slice(0, 4000);
  })();

  const merged = {
    externalProductId: id,
    name: finalName,
    description: cleanedDescription,
    category: keyCategory || fromSearch?.category || fromGet?.category || 'Général',
    weight: keyWeight != null ? String(keyWeight) : (fromGet?.weight || ''),
    image: finalImage,
    images: uniqueImages.length ? uniqueImages : (finalImage ? [{ url: finalImage }] : []),
    supplierPrice: price,
    currency: fromSearch?.currency || fromGet?.currency || 'USD',
    stock: finalStock,
    minOrderQuantity: fromSearch?.minOrderQuantity || fromGet?.minOrderQuantity || 1,
    skuInfos,
    specifications,
    productUrl: fromSearch?.productUrl || fromGet?.productUrl || `https://www.alibaba.com/product-detail/${id}.html`,
    raw: {
      ...(fromSearch?.raw || {}),
      ...(fromGet?.raw || {}),
      keyAttributes: keyAttrs,
      inventory: inv,
    },
  };

  if (!merged.name && !merged.externalProductId) {
    throw permissionDeniedOnProductGet(fromGetResult.reason || Object.assign(new Error('Produit Alibaba introuvable pour cet ID.'), {
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
    }));
  }

  if (isGenericAlibabaName(merged.name) && pickPrice(merged.supplierPrice) === 0) {
    const err = new Error('Données produit Alibaba incomplètes (titre et prix introuvables).');
    err.status = 422;
    err.code = 'PRODUCT_DATA_INCOMPLETE';
    throw applyAlibabaError(err);
  }

  return merged;
}

/**
 * Récupère les données 100% brutes renvoyées par Alibaba pour un produit donné
 * sans aucune transformation, normalisation ni mapping par le backend.
 *
 * @param {string|number} input - ID du produit ou URL Alibaba
 * @returns {Promise<object>} - Données brutes telles que reçues de l'API Alibaba
 */
async function getAlibabaRawProduct(input) {
  const id = extractProductId(input) || String(input || '').trim();
  if (!id) {
    const err = new Error('ID ou URL de produit Alibaba invalide.');
    err.status = 400;
    throw err;
  }

  const path = alibabaConfig.productGetPath;
  assertAllowedPath(path);

  // 1. Appel principal vers la fiche produit Alibaba (/eco/buyer/product/description)
  let descriptionRaw = null;
  let descriptionError = null;
  try {
    descriptionRaw = await alibabaCall(path, {
      query_req: {
        product_id: String(id),
        country: alibabaConfig.defaultCountry || 'US',
      },
    });
  } catch (err) {
    descriptionError = { message: err.message, code: err.code, status: err.status };
  }

  // 2. Appel inventaire brut (/eco/buyer/product/inventory)
  let inventoryRaw = null;
  let inventoryError = null;
  try {
    inventoryRaw = await alibabaCall('/eco/buyer/product/inventory', {
      inv_req: {
        product_id: String(id),
        country: alibabaConfig.defaultCountry || 'US',
      },
    });
  } catch (err) {
    inventoryError = { message: err.message, code: err.code };
  }

  // 3. Appel attributs clés bruts (/eco/buyer/product/keyattributes)
  let keyAttributesRaw = null;
  let keyAttributesError = null;
  try {
    keyAttributesRaw = await alibabaCall('/eco/buyer/product/keyattributes', {
      query_req: {
        product_id: String(id),
        country: alibabaConfig.defaultCountry || 'US',
      },
    });
  } catch (err) {
    keyAttributesError = { message: err.message, code: err.code };
  }

  return {
    productId: id,
    endpoint: path,
    country: alibabaConfig.defaultCountry || 'US',
    raw: descriptionRaw,
    inventoryRaw,
    keyAttributesRaw,
    errors: {
      description: descriptionError,
      inventory: inventoryError,
      keyAttributes: keyAttributesError,
    },
  };
}

module.exports = {
  searchAlibabaProducts,
  getAlibabaProductDetail,
  getAlibabaRawProduct,
  mapSearchItem,
  extractImages,
  extractAlibabaSpecifications,
  extractProductId,
  unwrapList,
  extractIdList,
  REJECTED_API_PATHS,
};
