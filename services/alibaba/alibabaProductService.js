const { alibabaCall } = require('./alibabaClient');
const { alibabaConfig } = require('../../config/alibaba');
const { toNumber } = require('../../utils/dropshippingCalculations');

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
  const value = payload?.value;
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.distribution_sale_product)) return value.distribution_sale_product;
  return payload?.resultList
    || payload?.toReturn
    || payload?.products
    || payload?.productList
    || payload?.pageResult?.resultList
    || payload?.result?.resultList
    || payload?.result?.products
    || payload?.distribution_sale_product
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

function getParamsForId(id) {
  const numericId = Number(id);
  const productId = Number.isFinite(numericId) ? numericId : id;
  const requestJson = JSON.stringify({ product_ids: [productId] });
  return [
    {
      path: '/alibaba/dropshipping/product/get',
      params: { param_distribution_sale_product_request: requestJson },
    },
    {
      path: '/product/get',
      params: {
        product_id: String(productId),
        country: alibabaConfig.defaultCountry,
      },
    },
    {
      path: '/alibaba/icbu/product/get',
      params: {
        language: 'ENGLISH',
        product_get_request: JSON.stringify({ productId, webSite: 'ICBU' }),
      },
    },
  ];
}

async function callFirstAllowed(attempts) {
  const errors = [];
  for (const attempt of attempts) {
    try {
      return await alibabaCall(attempt.path, attempt.params);
    } catch (error) {
      const message = `${attempt.path}: ${error.message}`;
      errors.push(message);
      console.warn(`[alibaba] ${message}`);
    }
  }
  const err = new Error(
    `Alibaba n’a pas renvoyé le produit. ${errors.join(' | ')} `
    + 'Utilisez l’ID numérique (URL product-detail). eco.taobao.com ne reconnaît pas l’AppKey GOP : rester sur openapi-api.alibaba.com.',
  );
  err.status = 502;
  err.code = 'NO_API_PERMISSION';
  throw err;
}

function keywordRequiredError() {
  const err = new Error(
    'Le groupe ICBU Dropshipping Solution n’a pas de recherche par mot-clé. Collez l’ID produit (chiffres dans l’URL alibaba.com/product-detail/Nom_123456.html) ou l’URL complète.',
  );
  err.status = 400;
  err.code = 'PRODUCT_ID_REQUIRED';
  return err;
}

async function searchAlibabaProducts(params = {}) {
  const page = Math.max(1, toNumber(params.page, 1));
  const size = Math.min(30, Math.max(1, toNumber(params.size, 20)));
  const productId = extractProductId(params.keyword);
  if (!productId) throw keywordRequiredError();
  const payload = await callFirstAllowed(getParamsForId(productId));
  let list = unwrapList(payload).map(mapSearchItem).filter((item) => item.externalProductId);
  if (!list.length && payload) {
    const mapped = mapSearchItem({ ...payload, offerId: pickOfferId(payload) || productId });
    if (mapped.externalProductId) list = [mapped];
  }
  return {
    products: list,
    pagination: {
      currentPage: page,
      totalPages: 1,
      totalRecords: list.length,
      itemsPerPage: size,
    },
  };
}

async function getAlibabaProductDetail(productId) {
  const id = extractProductId(productId) || String(productId || '').trim();
  if (!id) throw keywordRequiredError();
  const payload = await callFirstAllowed(getParamsForId(id));
  const product = payload?.product
    || payload?.productInfo
    || unwrapList(payload)[0]
    || payload
    || {};
  return {
    ...mapSearchItem({ ...product, offerId: pickOfferId(product) || id }),
    description: product.description || product.productDescription || product.subject || '',
    weight: product.productShippingInfo?.weight || product.weight || product.netWeight,
    skuInfos: product.skuInfos || product.skuList || product.productSkuInfos || product.product_sku_list || [],
    raw: product,
  };
}

module.exports = {
  searchAlibabaProducts,
  getAlibabaProductDetail,
  mapSearchItem,
  extractImages,
  extractProductId,
};
