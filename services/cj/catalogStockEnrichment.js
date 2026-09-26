const Product = require('../../Models/Product');
const { cjConfig, assertCjConfigured } = require('../../config/cj');
const {
  isCjDropshippingProduct,
  resolveCjProductId,
  resolveDropshipSellableStock,
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

function schedulePersistStock(productId, payload = {}) {
  const stock = resolveDropshipSellableStock(payload);
  if (stock <= 0) return;
  const update = { stock };
  if (Array.isArray(payload.variants) && payload.variants.length) {
    update.variants = payload.variants;
  }
  if (payload.supplier) {
    update.supplier = payload.supplier;
  }
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

      if (sellable > 0) {
        return product;
      }

      if (
        canLiveRefresh
        && isCjDropshippingProduct(product)
        && resolveCjProductId(product)
        && liveRefreshUsed < maxLiveRefresh
      ) {
        try {
          assertCjConfigured();
          liveRefreshUsed += 1;
          const refreshed = await refreshCjProductForPublicView(product);
          sellable = resolveDropshipSellableStock(refreshed);
          if (sellable > 0) {
            schedulePersistStock(product._id, refreshed);
            return refreshed;
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
