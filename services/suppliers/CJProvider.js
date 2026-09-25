const SupplierProvider = require('./SupplierProvider');
const { assertCjConfigured } = require('../../config/cj');
const { getCJProducts, getCJProductDetail } = require('../cj/cjProductService');
const { mapCJProductToDangoProduct } = require('../cj/cjMapper');

class CJProvider extends SupplierProvider {
  constructor() {
    super('cj');
  }

  async searchProducts(params = {}) {
    assertCjConfigured();
    return getCJProducts(params);
  }

  async getProduct(productId) {
    assertCjConfigured();
    const detail = await getCJProductDetail(productId);
    const listItem = {
      externalProductId: String(productId),
      name: detail?.productNameEn || detail?.productName,
      supplierPrice: detail?.sellPrice,
      stock: detail?.warehouseInventoryNum,
    };
    return mapCJProductToDangoProduct(listItem, detail);
  }

  async getVariants(productId) {
    const mapped = await this.getProduct(productId);
    return mapped.variants || [];
  }

  async getStock(productId) {
    const mapped = await this.getProduct(productId);
    return mapped.stock;
  }

  async getPrice(productId) {
    const mapped = await this.getProduct(productId);
    return mapped.pricing?.supplierPrice ?? mapped.supplier?.supplierPrice;
  }

  async createOrder() {
    throw new Error('cj: createOrder() — intégration commandes CJ à venir.');
  }

  async getOrderStatus() {
    throw new Error('cj: getOrderStatus() — intégration commandes CJ à venir.');
  }
}

module.exports = CJProvider;
