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

function firstImage(item = {}) {
  const candidates = [
    item.main_image_url,
    item.imageUrl,
    item.image,
    item.imgUrl,
    item.picUrl,
    ...(Array.isArray(item.image_url_list) ? item.image_url_list : []),
    ...(Array.isArray(item.main_image?.images) ? item.main_image.images : []),
    ...(Array.isArray(item.mainImage?.images) ? item.mainImage.images : []),
    ...(Array.isArray(item.imageList) ? item.imageList : []),
    ...(Array.isArray(item.productImageList) ? item.productImageList : []),
    item.productImage?.url,
  ];
  for (const raw of candidates) {
    const url = typeof raw === 'string' ? raw : raw?.url || raw?.imageUrl;
    if (url) return url.startsWith('//') ? `https:${url}` : url;
  }
  return '';
}

function extractImages(item = {}) {
  const urls = [];
  const seen = new Set();
  const push = (value) => {
    let url = typeof value === 'string' ? value : value?.url || value?.imageUrl || '';
    if (!url) return;
    if (url.startsWith('//')) url = `https:${url}`;
    if (seen.has(url)) return;
    seen.add(url);
    urls.push({ url });
  };
  push(firstImage(item));
  (item.image_url_list || item.main_image?.images || item.mainImage?.images || item.imageList || item.productImageList || item.images || []).forEach(push);
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

const LIST_KEYS = [
  'product_id_list', 'productIdList', 'product_ids', 'productIds',
  'offer_id_list', 'offerIdList', 'item_ids', 'itemIds',
  'distribution_sale_product', 'products', 'productList', 'product_list',
  'resultList', 'toReturn', 'records', 'items', 'hits', 'list',
  'search_result', 'offerList', 'offers',
];

const NEST_KEYS = ['result', 'result_data', 'data', 'body', 'value', 'response', 'payload', 'content'];

function isProductIdValue(item) {
  return typeof item === 'number'
    || (typeof item === 'string' && /^\d+$/.test(item.trim()));
}

function summarizePayload(payload) {
  const root = payload && typeof payload === 'object' ? payload : {};
  const keys = Object.keys(root).filter((key) => !/token|secret|sign/i.test(key)).slice(0, 20);
  const result = root.result && typeof root.result === 'object' ? Object.keys(root.result).slice(0, 20) : [];
  return {
    keys,
    resultKeys: result,
    dataType: Array.isArray(root.data) ? 'array' : typeof root.data,
    bodyType: typeof root.body,
  };
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
    price: trade.price?.range_price?.min_price || trade.price?.price || trade.unit_price || item.price,
    currency: trade.price?.currency || item.currency || 'USD',
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
    supplierPrice: toNumber(
      item.moq_and_price?.moq_unit_price?.amount
      || item.priceInfo?.price
      || item.price?.amount
      || item.price
      || item.referencePrice
      || item.minPrice,
    ),
    currency: item.moq_and_price?.moq_unit_price?.currency || item.priceInfo?.currency || item.price?.currency || item.currency || 'USD',
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
  if (root.product && typeof root.product === 'object' && !Array.isArray(root.product)) {
    return [root.product];
  }

  const queue = [root];
  const seen = new Set();
  while (queue.length) {
    const node = parseJsonValue(queue.shift());
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) return node;
    for (const key of LIST_KEYS) {
      const val = parseJsonValue(node[key]);
      if (Array.isArray(val)) return val;
    }
    for (const key of NEST_KEYS) {
      if (node[key] !== undefined) queue.push(node[key]);
    }
  }
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
  const total = toNumber(
    payload?.result?.result_total
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
        index: Math.max(0, page - 1),
        page_index: page,
        size,
        page_size: size,
      });
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
