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
    const url = raw.startsWith('//') ? `https:${raw}` : raw.trim();
    if (/^https?:\/\//i.test(url)) return url;
    return '';
  }
  if (typeof raw === 'object') {
    return asImageUrl(
      raw.url || raw.imageUrl || raw.image_url || raw.src || raw.main_url
      || raw.file_url || raw.pic_url || raw.main_image || raw.mainImage
      || raw.image || raw.img
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
    item.images,
    item.basic_info?.product_images,
  ].forEach((list) => {
    if (Array.isArray(list)) list.forEach(push);
  });
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
  const inner = root.result && typeof root.result === 'object' ? root.result : {};
  const data = parseJsonValue(inner.data);
  return {
    keys: Object.keys(root).filter((key) => !/token|secret|sign/i.test(key)).slice(0, 20),
    resultKeys: Object.keys(inner).slice(0, 20),
    resultCode: inner.code,
    resultMessage: inner.message || inner.msg || '',
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
  const basic = item.basic_info || item.product_info?.basic_info || {};
  const trade = item.trade_info || item.product_info?.trade_info || {};
  const images = extractImages(item);
  return {
    ...item,
    productId: basic.product_id || item.product_id || item.productId || fallbackId,
    subject: basic.title || item.title || item.subject || item.product_name || item.productName || item.product_title,
    title: basic.title || item.title || item.subject || item.product_name || item.productName || item.product_title,
    image: firstImage(item) || images[0]?.url || '',
    images,
    price: pickPrice(trade.price) || pickPrice(item.price) || pickPrice(item.unit_price),
    currency: pickCurrency({ ...item, price: trade.price || item.price }),
    minOrderQuantity: trade.moq || trade.min_order_quantity || item.minOrderQuantity,
    description: item.description || basic.description || item.subject || item.title,
    productUrl: item.permalink || item.detail_url || item.detailUrl || item.productUrl,
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
  const data = parseJsonValue(root.result?.data ?? root.data);
  const preferred = parseJsonValue(data?.products ?? data?.product_list ?? data?.dataList ?? data?.productList);
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
    description: flat.description || '',
    weight: flat.productShippingInfo?.weight || flat.weight || flat.netWeight || flat.logistics_info?.weight,
    skuInfos: flat.skuInfos || flat.skuList || flat.productSkuInfos || flat.product_sku_list || flat.sku_info || [],
    raw: item,
  };
}

async function fetchProductById(id) {
  const path = alibabaConfig.productGetPath;
  assertAllowedPath(path);
  let payload;
  try {
    payload = await alibabaCall(path, {
      product_id: String(id),
      country: alibabaConfig.defaultCountry,
      query_req: {
        product_id: String(id),
        country: alibabaConfig.defaultCountry,
      },
    });
  } catch (error) {
    throw permissionDeniedOnProductGet(error);
  }
  if (process.env.ALIBABA_DEBUG === '1') {
    const safePayload = payload ? JSON.parse(JSON.stringify(payload, (key, value) => {
      if (/token|secret|sign|app_key/i.test(key)) return '***';
      return value;
    })) : payload;
    console.warn('[alibaba] detail raw', id, JSON.stringify(safePayload).slice(0, 3000));
  }
  const isEnvelope = (node) => Boolean(
    node && typeof node === 'object'
    && !pickOfferId(node)
    && (node.request_id || (node.code != null && node.data !== undefined && node.message != null)),
  );
  const nested = parseJsonValue(payload?.result?.data ?? payload?.data);
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
  const paging = payload?.result?.data?.pagination || payload?.result?.pagination || {};
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
    stock: toNumber(primary.stock, 0) || toNumber(secondary.stock, 0) || alibabaConfig.defaultPublicStock,
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
  if (process.env.ALIBABA_DEBUG === '1') {
    console.warn('[alibaba] search raw summary', keyword, summarizePayload(payload));
  }
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
      product_id: String(id),
      country: alibabaConfig.defaultCountry || 'US',
    });
    return parseJsonValue(payload?.result?.data ?? payload?.data);
  } catch (error) {
    console.warn('[alibaba] fetchProductInventory notice:', error.message);
    return null;
  }
}

async function fetchProductKeyAttributes(id) {
  try {
    const payload = await alibabaCall('/eco/buyer/product/keyattributes', {
      product_id: String(id),
      country: alibabaConfig.defaultCountry || 'US',
    });
    return parseJsonValue(payload?.result?.data ?? payload?.data);
  } catch (error) {
    console.warn('[alibaba] fetchProductKeyAttributes notice:', error.message);
    return null;
  }
}

async function getAlibabaProductDetail(productId) {
  const id = extractProductId(productId) || String(productId || '').trim();
  if (!id) throw keywordRequiredError();

  const [fromGetResult, keyAttrsResult, invResult, searchResult] = await Promise.allSettled([
    fetchProductById(id),
    fetchProductKeyAttributes(id),
    fetchProductInventory(id),
    runBuyerSearch(id, 1, 8),
  ]);

  const fromGet = fromGetResult.status === 'fulfilled' ? fromGetResult.value : null;
  const keyAttrs = keyAttrsResult.status === 'fulfilled' ? keyAttrsResult.value : null;
  const inv = invResult.status === 'fulfilled' ? invResult.value : null;
  const searched = searchResult.status === 'fulfilled' ? searchResult.value : null;
  const fromSearch = (searched?.products || []).find((item) => item.externalProductId === id) || null;

  // Unpack inventory data & SKU variants
  const invStock = toNumber(
    inv?.amountOnSale ?? inv?.inventory ?? inv?.stock ?? inv?.total_stock ?? inv?.total_inventory,
    0,
  );
  const invSkus = parseJsonValue(inv?.sku_list ?? inv?.sku_inventory ?? inv?.sku_infos ?? inv?.skus ?? inv?.productSkuInfos);
  const rawSkuList = Array.isArray(invSkus) ? invSkus : (fromGet?.skuInfos || []);

  const skuInfos = rawSkuList.map((sku, index) => ({
    skuId: String(sku.skuId || sku.sku_id || sku.specId || sku.id || index),
    name: sku.skuName || sku.sku_name || sku.name || sku.specName || `Variante ${index + 1}`,
    price: pickPrice(sku.price || sku.consignPrice || sku.sale_price || sku.unit_price || sku.retailPrice),
    stock: toNumber(sku.amountOnSale ?? sku.canBookCount ?? sku.stock ?? sku.inventory ?? sku.quantity, 0),
    image: asImageUrl(sku.skuImageUrl || sku.imageUrl || sku.image || sku.pic_url || ''),
    currency: pickCurrency(sku),
  }));

  const skuStockTotal = skuInfos.reduce((acc, s) => acc + (s.stock || 0), 0);
  const finalStock = skuStockTotal || invStock || fromGet?.stock || fromSearch?.stock || alibabaConfig.defaultPublicStock;

  // Key attributes
  const keyTitle = keyAttrs?.title || keyAttrs?.subject || keyAttrs?.product_name || keyAttrs?.product_title;
  const keyCategory = keyAttrs?.category_name || keyAttrs?.leaf_category_name || keyAttrs?.category;
  const keyWeight = keyAttrs?.weight || keyAttrs?.net_weight || keyAttrs?.gross_weight || keyAttrs?.productShippingInfo?.weight;
  const keyImages = extractImages(keyAttrs || {});

  // Best Price
  const skuMinPrice = skuInfos.map((s) => s.price).filter((p) => p > 0).sort((a, b) => a - b)[0] || 0;
  const price = pickPrice(fromSearch?.supplierPrice)
    || skuMinPrice
    || pickPrice(fromGet?.supplierPrice)
    || pickPrice(inv?.price);

  // Best Title / Name
  const candidateName = fromSearch?.name || keyTitle || fromGet?.name;
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

  const merged = {
    externalProductId: id,
    name: finalName,
    description: fromGet?.description || '',
    category: keyCategory || fromSearch?.category || fromGet?.category || 'Général',
    weight: keyWeight != null ? String(keyWeight) : (fromGet?.weight || ''),
    image: finalImage,
    images: uniqueImages.length ? uniqueImages : (finalImage ? [{ url: finalImage }] : []),
    supplierPrice: price,
    currency: fromSearch?.currency || fromGet?.currency || 'USD',
    stock: finalStock,
    minOrderQuantity: fromSearch?.minOrderQuantity || fromGet?.minOrderQuantity || 1,
    skuInfos,
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

  return merged;
}

module.exports = {
  searchAlibabaProducts,
  getAlibabaProductDetail,
  mapSearchItem,
  extractImages,
  extractProductId,
  unwrapList,
  extractIdList,
  REJECTED_API_PATHS,
};
