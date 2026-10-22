const SupplierProvider = require('./SupplierProvider');
const { assertAlibabaConfigured } = require('../../config/alibaba');
const { searchAlibabaProducts, getAlibabaProductDetail } = require('../alibaba/alibabaProductService');
const { mapAlibabaProductToDango } = require('../alibaba/alibabaMapper');

class AlibabaProvider extends SupplierProvider {
  constructor() {
    super('alibaba');
  }

  async searchProducts(params = {}) {
    assertAlibabaConfigured();
    return searchAlibabaProducts(params);
  }

  async getProduct(productId) {
    assertAlibabaConfigured();
    const detail = await getAlibabaProductDetail(productId);
    return await mapAlibabaProductToDango(detail, detail);
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
}

module.exports = AlibabaProvider;
