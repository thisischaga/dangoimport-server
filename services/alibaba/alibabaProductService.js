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
      || raw.file_url || raw.pic_url || raw.image || raw.img,
      depth + 1,
    );
  }
  return '';
}

function firstImage(item = {}) {
  const candidates = [
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
  return '';
}

function pickPrice(value, depth = 0) {
  if (value == null || value === '' || depth > 4) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const nums = value.replace(/,/g, '').match(/\d+(?:\.\d+)?/g);
    return nums ? Number(nums[0]) : 0;
  }
  if (typeof value === 'object') {
    return pickPrice(
      value.min_price ?? value.minPrice ?? value.min
      ?? value.amount ?? value.price ?? value.value
      ?? value.sale_price ?? value.unit_price ?? value.fob_price
      ?? value.range_price?.min_price ?? value.range_price,
      depth + 1,
    );
  }
  return 0;
}

function pickCurrency(item = {}) {
  const price = item.price;
  const raw = item.currency
    || item.price_currency
    || (price && typeof price === 'object' && (price.currency || price.currency_code))
    || item.moq_and_price?.moq_unit_price?.currency
    || item.priceInfo?.currency
    || item.trade_info?.price?.currency
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
    ||     item.basic_info?.product_id
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
  const imageUrls = []
    .concat(basic.product_images || [], item.product_images || [], item.images || [])
    .map((img) => (typeof img === 'string' ? img : img?.image_url || img?.url))
    .filter(Boolean);
  return {
    ...item,
    productId: basic.product_id || item.product_id || item.productId || fallbackId,
    subject: basic.title || item.subject || item.title,
    title: basic.title || item.title,
    image: imageUrls[0] || item.image,
    images: imageUrls.length ? imageUrls.map((url) => ({ url })) : item.images,
    price: pickPrice(trade.price) || pickPrice(item.price) || pickPrice(item.unit_price),
    currency: pickCurrency({ ...item, price: trade.price || item.price }),
    image: firstImage(item) || imageUrls[0] || '',
    minOrderQuantity: trade.moq || trade.min_order_quantity || item.minOrderQuantity,
    description: item.description || basic.description || item.subject,
  };
}

function mapSearchItem(item = {}) {
  const id = pickOfferId(item);
  return {
    externalProductId: id,
    name: item.subject || item.productTitle || item.title || item.name || `Produit ${id}`,
    image: firstImage(item),
    images: extractImages(item),
    supplierPrice: pickPrice(item.moq_and_price?.moq_unit_price)
      || pickPrice(item.priceInfo)
      || pickPrice(item.referencePrice)
      || pickPrice(item.minPrice)
      || pickPrice(item.min_price)
      || pickPrice(item.unit_price)
      || pickPrice(item.price),
    currency: pickCurrency(item),
    stock: toNumber(item.amountOnSale ?? item.quantity ?? item.stock, 0),
    minOrderQuantity: toNumber(item.minOrderQuantity ?? item.moq_and_price?.min_order_quantity ?? item.quantityBegin, 1),
    category: item.leaf_category_name || item.top_category_name || item.categoryName || item.categoryId || '',
    productUrl: item.detail_url || item.detailUrl || item.productUrl || (id ? `https://www.alibaba.com/product-detail/${id}.html` : ''),
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
  if (data && typeof data === 'object' && !Array.isArray(data) && (pickOfferId(data) || data.basic_info || data.product_info)) {
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
      query_req: {
        product_id: String(id),
        country: alibabaConfig.defaultCountry,
      },
    });
  } catch (error) {
    throw permissionDeniedOnProductGet(error);
  }
  const product = unwrapList(payload)[0] || payload?.product || payload?.result || null;
  if (!product || typeof product !== 'object' || Array.isArray(product)) {
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
    paging.total
    ?? paging.total_count
    ?? paging.totalCount
    ?? payload?.result?.result_total
    ?? payload?.totalRecords
    ?? payload?.total_item
    ?? payload?.totalCount,
    list.length,
  );
  return {
    products: list,
    pagination: {
      currentPage: page,
      totalPages: Math.max(1, Math.ceil(total / size) || 1),
      totalRecords: total,
      itemsPerPage: size,
    },
  };
}

async function searchAlibabaProducts(params = {}) {
  const page = Math.max(1, toNumber(params.page, 1));
  const size = Math.min(30, Math.max(1, toNumber(params.size, 20)));
  const keyword = String(params.keyword || '').trim();
  const productId = extractProductId(keyword);
  if (productId) {
    try {
      const item = await fetchProductById(productId);
      return paginateFromPayload({}, [item], 1, size);
    } catch (error) {
      throw permissionDeniedOnProductGet(error);
    }
  }

  if (keyword) {
    const searchPath = alibabaConfig.productSearchPath;
    assertAllowedPath(searchPath);
    try {
      const payload = await alibabaCall(searchPath, {
        keyword,
        country: alibabaConfig.defaultCountry,
        index: page,
        page_index: page,
        size,
        page_size: size,
      });
      assertBuyerResult(payload);
      const { ids, items } = listFromSearchPayload(payload);
      const list = ids
        ? await hydrateProductIds(ids, size)
        : items.map((item) => mapPayloadItem(item)).filter((item) => item.externalProductId);
      if (!list.length) {
        console.warn('[alibaba] searchProducts empty', summarizePayload(payload));
      }
      return paginateFromPayload(payload, list, page, size);
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

async function getAlibabaProductDetail(productId) {
  const id = extractProductId(productId) || String(productId || '').trim();
  if (!id) throw keywordRequiredError();
  try {
    return await fetchProductById(id);
  } catch (error) {
    throw permissionDeniedOnProductGet(error);
  }
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
