const { cjConfig, assertCjConfigured } = require('../../config/cj');
const cjClient = require('./cjClient');

async function testConnection() {
  assertCjConfigured();
  const data = await cjClient.get('/product/listV2', { page: 1, size: 1 });
  return {
    ok: true,
    message: data?.message || 'Connexion CJ OK',
    sampleTotal: data?.data?.totalRecords ?? null,
  };
}

function getAuthStatus() {
  return {
    enabled: cjConfig.enabled,
    syncEnabled: cjConfig.syncEnabled,
    hasToken: Boolean(cjConfig.accessToken),
  };
}

module.exports = {
  testConnection,
  getAuthStatus,
};
