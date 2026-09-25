const ManualSupplierProvider = require('./ManualSupplierProvider');
const AlibabaProvider = require('./AlibabaProvider');
const AliExpressProvider = require('./AliExpressProvider');
const LocalSupplierProvider = require('./LocalSupplierProvider');
const CJProvider = require('./CJProvider');

const PROVIDERS = {
  manual: ManualSupplierProvider,
  alibaba: AlibabaProvider,
  aliexpress: AliExpressProvider,
  local: LocalSupplierProvider,
  cj: CJProvider,
};

function getSupplierProvider(platform = 'manual') {
  const key = String(platform || 'manual').toLowerCase();
  const ProviderClass = PROVIDERS[key] || ManualSupplierProvider;
  return new ProviderClass();
}

module.exports = {
  getSupplierProvider,
  PROVIDERS,
};
