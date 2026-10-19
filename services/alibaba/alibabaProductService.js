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
    supplierPrice: toNumber(item.priceInfo?.price || item.price?.amount || item.price || item.referencePrice || item.minPrice),
    currency: item.priceInfo?.currency || item.price?.currency || item.currency || 'USD',
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
    || payload?.pageResult?.resultList
    || payload?.result?.resultList
    || [];
}

async function searchAlibabaProducts(params = {}) {
  const page = Math.max(1, toNumber(params.page, 1));
  const size = Math.min(30, Math.max(1, toNumber(params.size, 20)));
  const keyword = params.keyword ? String(params.keyword).trim() : undefined;
  const payload = await alibabaCall('/alibaba/icbu/product/list', {
    language: 'ENGLISH',
    subject: keyword,
    category_id: params.categoryId || undefined,
    current_page: page,
    page_size: size,
    filter_type: 'onSelling',
  });
  const list = unwrapList(payload).map(mapSearchItem).filter((item) => item.externalProductId);
  const total = toNumber(
    payload?.totalRecords ?? payload?.totalCount ?? payload?.pageResult?.totalRecords,
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
  const payload = await alibabaCall('/icbu/product/get', {
    product_get_request: {
      productId: Number.isFinite(Number(id)) ? Number(id) : id,
      webSite: 'ICBU',
    },
  });
  const product = payload?.product || payload?.productInfo || payload || {};
  return {
    ...mapSearchItem({ ...product, offerId: pickOfferId(product) || id }),
    description: product.description || product.productDescription || product.subject || '',
    weight: product.productShippingInfo?.weight || product.weight || product.netWeight,
    skuInfos: product.skuInfos || product.skuList || product.productSkuInfos || [],
    raw: product,
  };
}

module.exports = {
  searchAlibabaProducts,
  getAlibabaProductDetail,
  mapSearchItem,
  extractImages,
};
