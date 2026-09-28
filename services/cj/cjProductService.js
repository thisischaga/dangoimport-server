const cjClient = require('./cjClient');
const { normalizeCjImageUrl } = require('../../utils/cjCatalogHelpers');

function flattenListV2Products(data) {
  const content = Array.isArray(data?.data?.content) ? data.data.content : [];
  const products = [];

  content.forEach((block) => {
    const list = Array.isArray(block?.productList) ? block.productList : [];
    list.forEach((item) => products.push(item));
    if (!list.length && block && (block.id || block.pid || block.nameEn || block.productNameEn)) {
      products.push(block);
    }
  });

  if (!products.length) {
    const altLists = [
      data?.data?.productList,
      data?.data?.list,
      data?.data?.records,
    ].filter(Array.isArray);
    altLists.forEach((list) => list.forEach((item) => products.push(item)));
  }

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
    images: item.bigImage ? [{ url: normalizeCjImageUrl(item.bigImage), isPrimary: true }] : [],
    image: normalizeCjImageUrl(item.bigImage || ''),
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
  if (sort) {
    query.sort = sort;
    if (orderBy == null || orderBy === '') {
      query.orderBy = 2;
    }
  }
  if (orderBy != null && orderBy !== '') query.orderBy = orderBy;

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
  const query = { pid, features: ['enable_combine', 'enable_video', 'enable_description', 'enable_category'] };
  if (countryCode) query.countryCode = countryCode;
  const data = await cjClient.get('/product/query', query);
  return data?.data || data?.result || data;
}

const CATEGORY_CACHE_TTL_MS = Math.max(60_000, Number(process.env.CJ_CATEGORY_CACHE_TTL_MS) || 3_600_000);
let categoryCache = { expiresAt: 0, categories: [] };

function flattenCategoryTree(nodes, trail = []) {
  const out = [];
  const list = Array.isArray(nodes) ? nodes : [];

  list.forEach((node) => {
    const firstName = String(node.categoryFirstName || '').trim();
    if (firstName && Array.isArray(node.categoryFirstList)) {
      node.categoryFirstList.forEach((second) => {
        const secondName = String(second.categorySecondName || '').trim();
        const thirdList = second.categorySecondList || second.categoryThirdList || [];
        thirdList.forEach((third) => {
          const id = String(third.categoryId || third.id || '').trim();
          const name = String(third.categoryName || third.categoryNameEn || '').trim();
          if (id && name) {
            out.push({
              id,
              name,
              label: [firstName, secondName, name].filter(Boolean).join(' › '),
              level: 3,
            });
          }
        });
      });
      return;
    }

    const id = String(node.categoryId || node.id || '').trim();
    const name = String(
      node.categoryNameEn
      || node.categoryName
      || node.nameEn
      || node.name
      || '',
    ).trim();
    const pathParts = name ? [...trail, name] : [...trail];
    const children = node.children
      || node.childList
      || node.categoryFirstList
      || node.categorySecondList
      || node.categoryThirdList
      || node.subCategories
      || [];
    if (id && name) {
      out.push({
        id,
        name,
        label: pathParts.join(' › '),
        level: pathParts.length,
      });
    }
    if (Array.isArray(children) && children.length) {
      out.push(...flattenCategoryTree(children, pathParts));
    }
  });
  return out;
}

async function getCJCategories({ refresh = false } = {}) {
  if (!refresh && categoryCache.categories.length && Date.now() < categoryCache.expiresAt) {
    return categoryCache.categories;
  }
  const data = await cjClient.get('/product/getCategory');
  const root = data?.data || data?.result || data?.categoryList || [];
  const flat = flattenCategoryTree(Array.isArray(root) ? root : [root]);
  const deduped = [];
  const seen = new Set();
  flat.forEach((cat) => {
    if (!cat.id || seen.has(cat.id)) return;
    seen.add(cat.id);
    deduped.push(cat);
  });
  deduped.sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  categoryCache = { categories: deduped, expiresAt: Date.now() + CATEGORY_CACHE_TTL_MS };
  return deduped;
}

module.exports = {
  getCJProducts,
  getCJProductDetail,
  getCJCategories,
  flattenListV2Products,
  normalizeListItem,
};
