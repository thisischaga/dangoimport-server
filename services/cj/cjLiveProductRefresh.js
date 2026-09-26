const { cjConfig, assertCjConfigured } = require('../../config/cj');
const {
  isCjDropshippingProduct,
  resolveCjProductId,
  isPrimarilyChinese,
  resolveDropshipSellableStock,
  normalizePublicVariantStocks,
} = require('../../utils/cjCatalogHelpers');
const { toNumber } = require('../../utils/dropshippingCalculations');
const { getCJProductDetail } = require('./cjProductService');
const { getCJInventoryByPid } = require('./cjInventoryService');
const { mapCJProductToDangoProduct } = require('./cjMapper');

async function refreshCjProductForPublicView(product = {}) {
  if (!product || !isCjDropshippingProduct(product) || !cjConfig.enabled) {
    return product;
  }

  const pid = resolveCjProductId(product);
  if (!pid) return product;

  try {
    assertCjConfigured();
  } catch {
    return product;
  }

  let detail = null;
  let inventory = null;

  try {
    detail = await getCJProductDetail(pid);
  } catch {
    detail = null;
  }

  try {
    inventory = await getCJInventoryByPid(pid);
  } catch {
    inventory = null;
  }

  if (!detail && !inventory) {
    return product;
  }

  try {
    const listItem = {
      externalProductId: pid,
      name: product.name,
      description: product.description,
      supplierPrice: detail?.sellPrice ?? product.supplier?.supplierPrice,
      stock: detail?.warehouseInventoryNum ?? product.stock,
      raw: detail,
    };
    const mapped = await mapCJProductToDangoProduct(listItem, detail, inventory);
    const dbStock = toNumber(product.stock, 0);
    const liveStock = toNumber(mapped.stock, 0);
    const warehouseStock = (mapped.supplier?.warehouseInventories || []).reduce(
      (sum, row) => sum + toNumber(row?.quantity ?? row?.totalInventoryNum, 0),
      0,
    );
    let mergedVariants = mapped.variants?.length ? mapped.variants : product.variants;
    const mergedSupplier = {
      ...(product.supplier || {}),
      ...mapped.supplier,
    };
    const stock = resolveDropshipSellableStock({
      ...product,
      stock: Math.max(liveStock, dbStock, warehouseStock),
      variants: mergedVariants,
      supplier: mergedSupplier,
    });
    mergedVariants = normalizePublicVariantStocks(mergedVariants, stock);

    let name = mapped.name || product.name;
    if (isPrimarilyChinese(name) && mapped.supplier?.productNameEn) {
      name = mapped.supplier.productNameEn;
    }

    return {
      ...product,
      stock,
      name,
      description: mapped.description || product.description,
      shortDescription: mapped.shortDescription || product.shortDescription,
      variants: mergedVariants,
      supplier: mergedSupplier,
      specifications: mapped.specifications?.length ? mapped.specifications : product.specifications,
      shippingInfo: mapped.shippingInfo || product.shippingInfo,
      brand: mapped.brand || product.brand,
      subCategory: mapped.subCategory || product.subCategory,
      category: mapped.category || product.category,
    };
  } catch {
    return product;
  }
}

module.exports = {
  refreshCjProductForPublicView,
};
