const { alibabaCall } = require('./alibabaClient');
const { alibabaConfig } = require('../../config/alibaba');
const { toNumber } = require('../../utils/dropshippingCalculations');
const { applyAlibabaError } = require('./alibabaErrors');

const REJECTED_API_PATHS = new Set([
  '/alibaba/dropshipping/product/get',
  '/product/get',
  '/alibaba/icbu/product/get',
  '/product/list',
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
  return String(item.offerId || item.productID || item.productId || item.product_id || item.id || '').trim();
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
  if (Array.isArray(payload)) return payload;
  if (payload?.product) return [payload.product];
  const value = payload?.value;
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.distribution_sale_product)) return value.distribution_sale_product;
  return payload?.resultList
    || payload?.toReturn
    || payload?.products
    || payload?.result?.products
    || payload?.result?.resultList
    || payload?.productList
    || [];
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
  const err = new Error(
    'Aucune API de recherche par mot-clé n’est configurée pour cette app ISV-Dropshipping. Collez l’ID produit ou l’URL alibaba.com/product-detail/… '
    + 'Pour une liste pool, copiez le API Path exact depuis openapi.alibaba.com → App Console → API Permission Group vers ALIBABA_PRODUCT_LIST_PATH.',
  );
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

async function fetchProductById(id) {
  const path = alibabaConfig.productGetPath;
  assertAllowedPath(path);
  const numericId = Number(id);
  const productId = Number.isFinite(numericId) ? numericId : id;
  const payload = await alibabaCall(path, {
    product_get_request: JSON.stringify({ productId, webSite: 'ICBU' }),
    language: 'ENGLISH',
  });
  const product = payload?.product
    || unwrapList(payload)[0]
    || payload?.result
    || null;
  if (!product || typeof product !== 'object') {
    const err = new Error('Produit Alibaba introuvable pour cet ID.');
    err.status = 404;
    err.code = 'PRODUCT_NOT_FOUND';
    throw err;
  }
  return {
    ...mapSearchItem({ ...product, offerId: pickOfferId(product) || id }),
    description: product.description || product.productDescription || product.subject || '',
    weight: product.productShippingInfo?.weight || product.weight || product.netWeight,
    skuInfos: product.skuInfos || product.skuList || product.productSkuInfos || product.product_sku_list || [],
    raw: product,
  };
}

async function searchAlibabaProducts(params = {}) {
  const page = Math.max(1, toNumber(params.page, 1));
  const size = Math.min(30, Math.max(1, toNumber(params.size, 20)));
  const productId = extractProductId(params.keyword);
  if (productId) {
    try {
      const item = await fetchProductById(productId);
      if (!item.externalProductId) {
        const err = new Error('Produit Alibaba introuvable pour cet ID.');
        err.status = 404;
        err.code = 'PRODUCT_NOT_FOUND';
        throw err;
      }
      return {
        products: [item],
        pagination: {
          currentPage: 1,
          totalPages: 1,
          totalRecords: 1,
          itemsPerPage: size,
        },
      };
    } catch (error) {
      throw applyAlibabaError(error);
    }
  }

  const listPath = alibabaConfig.productListPath;
  if (!listPath) throw keywordRequiredError();
  assertAllowedPath(listPath);
  try {
    const payload = await alibabaCall(listPath, {
      pool_id: alibabaConfig.defaultPoolId,
      keyword: params.keyword ? String(params.keyword).trim() : undefined,
      page_no: page,
      page_size: size,
      country: alibabaConfig.defaultCountry,
      language: 'ENGLISH',
      subject: params.keyword ? String(params.keyword).trim() : undefined,
      current_page: page,
    });
    const list = unwrapList(payload).map(mapSearchItem).filter((item) => item.externalProductId);
    const total = toNumber(payload?.totalRecords ?? payload?.total_item ?? payload?.totalCount, list.length);
    return {
      products: list,
      pagination: {
        currentPage: page,
        totalPages: Math.max(1, Math.ceil(total / size) || 1),
        totalRecords: total,
        itemsPerPage: size,
      },
    };
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
    throw applyAlibabaError(error);
  }
}

module.exports = {
  searchAlibabaProducts,
  getAlibabaProductDetail,
  mapSearchItem,
  extractImages,
  extractProductId,
  REJECTED_API_PATHS,
};
