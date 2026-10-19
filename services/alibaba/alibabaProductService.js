const { alibabaCall } = require('./alibabaClient');
const { alibabaConfig } = require('../../config/alibaba');
const { toNumber } = require('../../utils/dropshippingCalculations');

function firstImage(item = {}) {
  const candidates = [
    item.imageUrl,
    item.image,
    item.imgUrl,
    item.picUrl,
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
  (item.main_image?.images || item.mainImage?.images || item.imageList || item.productImageList || item.images || []).forEach(push);
  return urls;
}

function pickOfferId(item = {}) {
  return String(item.offerId || item.productID || item.productId || item.id || '').trim();
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
    minOrderQuantity: toNumber(item.minOrderQuantity ?? item.quantityBegin, 1),
    category: item.categoryName || item.categoryId || '',
    productUrl: item.detailUrl || item.productUrl || (id ? `https://www.alibaba.com/product-detail/${id}.html` : ''),
    raw: item,
  };
}

function unwrapList(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.resultList
    || payload?.toReturn
    || payload?.products
    || payload?.value?.distribution_sale_product
    || payload?.value
    || payload?.productList
    || payload?.pageResult?.resultList
    || payload?.result?.resultList
    || payload?.result?.products
    || [];
}

function isSkippableApiError(error) {
  const msg = String(error?.message || error?.code || '');
  return /NO_API_PERMISSION|does not have permission|specified API Path is invalid|invalid.?api.?path/i.test(msg);
}

function permissionError(lastError) {
  const err = new Error(
    'L’app n’a pas la permission d’accéder aux API produit. Dans openapi.alibaba.com → App Console → API Permission Group, demandez le groupe Dropshipping / Product (Product List, Product Get). OAuth seul ne suffit pas. API actuellement nécessaires : /alibaba/dropshipping/product/list ou /product/list (pool) ou /alibaba/icbu/product/list.',
  );
  err.status = 502;
  err.code = 'NO_API_PERMISSION';
  err.cause = lastError;
  return err;
}

async function callFirstAllowed(attempts) {
  let lastError;
  for (const attempt of attempts) {
    try {
      return await alibabaCall(attempt.path, attempt.params);
    } catch (error) {
      lastError = error;
      if (isSkippableApiError(error)) continue;
      throw error;
    }
  }
  throw permissionError(lastError);
}

async function searchAlibabaProducts(params = {}) {
  const page = Math.max(1, toNumber(params.page, 1));
  const size = Math.min(30, Math.max(1, toNumber(params.size, 20)));
  const keyword = params.keyword ? String(params.keyword).trim() : undefined;
  const payload = await callFirstAllowed([
    {
      path: '/alibaba/dropshipping/product/list',
      params: {
        keyword,
        keywords: keyword,
        subject: keyword,
        page_no: page,
        pageNo: page,
        current_page: page,
        page_size: size,
        pageSize: size,
      },
    },
    {
      path: '/product/list',
      params: {
        pool_id: alibabaConfig.defaultPoolId,
        poolId: alibabaConfig.defaultPoolId,
        keyword,
        page_no: page,
        page_size: size,
        country: alibabaConfig.defaultCountry,
      },
    },
    {
      path: '/alibaba/icbu/product/list',
      params: {
        language: 'ENGLISH',
        subject: keyword,
        category_id: params.categoryId || undefined,
        current_page: page,
        page_size: size,
        filter_type: 'onSelling',
      },
    },
  ]);
  const list = unwrapList(payload).map(mapSearchItem).filter((item) => item.externalProductId);
  const total = toNumber(
    payload?.totalRecords ?? payload?.total_item ?? payload?.totalCount ?? payload?.pageResult?.totalRecords,
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

async function getAlibabaProductDetail(productId) {
  const id = String(productId || '').trim();
  if (!id) {
    const err = new Error('Identifiant produit Alibaba requis.');
    err.status = 400;
    throw err;
  }
  const numericId = Number(id);
  const payload = await callFirstAllowed([
    {
      path: '/alibaba/dropshipping/product/get',
      params: {
        param_distribution_sale_product_request: {
          product_ids: [Number.isFinite(numericId) ? numericId : id],
        },
      },
    },
    {
      path: '/icbu/product/get',
      params: {
        product_get_request: {
          productId: Number.isFinite(numericId) ? numericId : id,
          webSite: 'ICBU',
        },
      },
    },
  ]);
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
};
