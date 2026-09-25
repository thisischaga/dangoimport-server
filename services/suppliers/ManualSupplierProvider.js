const SupplierProvider = require('./SupplierProvider');

class ManualSupplierProvider extends SupplierProvider {
  constructor() {
    super('manual');
  }

  async getProduct(productId) {
    return { productId, source: 'manual', synced: false };
  }
}

module.exports = ManualSupplierProvider;
