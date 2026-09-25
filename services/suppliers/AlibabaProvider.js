const SupplierProvider = require('./SupplierProvider');

class AlibabaProvider extends SupplierProvider {
  constructor() {
    super('alibaba');
  }
}

module.exports = AlibabaProvider;
