const SupplierProvider = require('./SupplierProvider');

class LocalSupplierProvider extends SupplierProvider {
  constructor() {
    super('local');
  }
}

module.exports = LocalSupplierProvider;
