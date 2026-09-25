const cjClient = require('./cjClient');

function flattenListV2Products(data) {
  const content = Array.isArray(data?.data?.content) ? data.data.content : [];
  const products = [];

  content.forEach((block) => {
    const list = Array.isArray(block?.productList) ? block.productList : [];
    list.forEach((item) => products.push(item));
  });

  return products;
}

function normalizeListItem(item = {}) {
  const id = String(item.id || item.pid || '').trim();
  return {
    externalProductId: id,
    source: 'cj',
    name: item.nameEn || item.productNameEn || item.name || 'Produit CJ',
    sku: item.sku || item.spu || '',
    description: item.description || item.nameEn || '',
    category: item.threeCategoryName || item.twoCategoryName || item.oneCategoryName || 'Général',
    subCategory: item.twoCategoryName || '',
    images: item.bigImage ? [{ url: item.bigImage, isPrimary: true }] : [],
    image: item.bigImage || '',
    supplierPrice: Number(item.nowPrice || item.sellPrice || item.discountPrice || 0),
    currency: 'USD',
    stock: Number(item.warehouseInventoryNum || item.totalVerifiedInventory || 0),
    shipping: {
      deliveryCycle: item.deliveryCycle || '',
      freeShipping: Number(item.addMarkStatus) === 1,
    },
    raw: item,
  };
}

async function getCJProducts({
  page = 1,
  size = 20,
  keyword,
  categoryId,
  minPrice,
  maxPrice,
  country,
  sort,
  orderBy,
} = {}) {
  const query = {
    page,
    size: Math.min(100, Math.max(1, size)),
    features: ['enable_description', 'enable_category'],
  };

  if (keyword) query.keyWord = String(keyword).slice(0, 200);
  if (categoryId) query.categoryId = categoryId;
  if (minPrice != null) query.startSellPrice = minPrice;
  if (maxPrice != null) query.endSellPrice = maxPrice;
  if (country) query.countryCode = country;
  if (sort) query.sort = sort;
  if (orderBy != null) query.orderBy = orderBy;

  const data = await cjClient.get('/product/listV2', query);
  const items = flattenListV2Products(data).map(normalizeListItem);

  return {
    products: items,
    pagination: {
      page: Number(data?.data?.pageNumber || page),
      size: Number(data?.data?.pageSize || size),
      totalRecords: Number(data?.data?.totalRecords || 0),
      totalPages: Number(data?.data?.totalPages || 0),
    },
    raw: data,
  };
}

async function getCJProductDetail(pid, { countryCode } = {}) {
  const query = { pid, features: ['enable_combine', 'enable_video'] };
  if (countryCode) query.countryCode = countryCode;
  const data = await cjClient.get('/product/query', query);
  return data?.data || data?.result || data;
}

module.exports = {
  getCJProducts,
  getCJProductDetail,
  flattenListV2Products,
  normalizeListItem,
};
