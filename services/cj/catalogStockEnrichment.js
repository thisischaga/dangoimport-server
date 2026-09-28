const Product = require('../../Models/Product');
const { cjConfig, assertCjConfigured } = require('../../config/cj');
const {
  isCjDropshippingProduct,
  resolveCjProductId,
  resolveDropshipSellableStock,
  isGenericProductPlaceholder,
  resolveCjPublicDisplayName,
} = require('../../utils/cjCatalogHelpers');
const { refreshCjProductForPublicView } = require('./cjLiveProductRefresh');

function repairCjSupplierPid(product = {}) {
  if (!product || !isCjDropshippingProduct(product)) return product;
  const pid = resolveCjProductId(product);
  if (!pid) return product;
  const supplier = { ...(product.supplier || {}) };
  if (!String(supplier.productId || '').trim()) {
    supplier.productId = pid;
  }
  if (!String(supplier.platform || '').trim() || supplier.platform === 'manual') {
    supplier.platform = 'cj';
  }
  return { ...product, supplier };
}

function needsCjNameRepair(product = {}) {
  if (!isCjDropshippingProduct(product)) return false;
  const resolved = resolveCjPublicDisplayName(product);
  if (resolved && !isGenericProductPlaceholder(resolved)) return false;
  return isGenericProductPlaceholder(product.name) || !String(product.name || '').trim();
}

function schedulePersistStock(productId, payload = {}) {
  const stock = resolveDropshipSellableStock(payload);
  const update = {};
  if (stock > 0) update.stock = stock;
  if (payload.name && !isGenericProductPlaceholder(payload.name)) {
    update.name = payload.name;
  }
  if (payload.description) update.description = payload.description;
  if (payload.shortDescription) update.shortDescription = payload.shortDescription;
  if (Array.isArray(payload.variants) && payload.variants.length) {
    update.variants = payload.variants;
  }
  if (payload.supplier) {
    update.supplier = payload.supplier;
  }
  if (!Object.keys(update).length) return;
  Product.updateOne({ _id: productId }, { $set: update }).catch(() => {});
}

/**
 * Met à jour le stock catalogue pour les drops CJ (DB + refresh live limité).
 */
async function enrichCatalogProductsStock(products = [], { maxLiveRefresh = 10 } = {}) {
  if (!Array.isArray(products) || !products.length) return products;

  let liveRefreshUsed = 0;
  const canLiveRefresh = cjConfig.enabled;

  const enriched = await Promise.all(
    products.map(async (raw) => {
      let product = repairCjSupplierPid(raw);
      let sellable = resolveDropshipSellableStock(product);
      const nameBroken = needsCjNameRepair(product);

      if (sellable > 0 && !nameBroken) {
        return product;
      }

      if (
        canLiveRefresh
        && isCjDropshippingProduct(product)
        && resolveCjProductId(product)
        && liveRefreshUsed < maxLiveRefresh
        && (sellable <= 0 || nameBroken)
      ) {
        try {
          assertCjConfigured();
          liveRefreshUsed += 1;
          const refreshed = await refreshCjProductForPublicView(product);
          sellable = resolveDropshipSellableStock(refreshed);
          if (sellable > 0 || (refreshed.name && !isGenericProductPlaceholder(refreshed.name))) {
            schedulePersistStock(product._id, refreshed);
          }
          return refreshed;
        } catch {
          return product;
        }
      }

      return product;
    }),
  );

  return enriched;
}

module.exports = {
  enrichCatalogProductsStock,
  repairCjSupplierPid,
};
