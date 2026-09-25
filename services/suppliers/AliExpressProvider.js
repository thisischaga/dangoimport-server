const SupplierProvider = require('./SupplierProvider');

class AliExpressProvider extends SupplierProvider {
  constructor() {
    super('aliexpress');
  }
}

module.exports = AliExpressProvider;
