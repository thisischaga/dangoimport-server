const { cjConfig, assertCjConfigured } = require('../../config/cj');
const cjClient = require('./cjClient');
const { getTokenDiagnostics, exchangeApiKey } = require('./cjTokenService');

async function testConnection() {
  assertCjConfigured();
  if (cjConfig.apiKey && !cjConfig.accessToken) {
    await exchangeApiKey(cjConfig.apiKey);
  }
  const data = await cjClient.get('/product/listV2', { page: 1, size: 1 });
  return {
    ok: true,
    message: data?.message || 'Connexion CJ OK',
    sampleTotal: data?.data?.totalRecords ?? null,
  };
}

function getAuthStatus() {
  const diagnostics = getTokenDiagnostics();
  return {
    enabled: cjConfig.enabled,
    syncEnabled: cjConfig.syncEnabled,
    hasToken: Boolean(cjConfig.accessToken || cjConfig.apiKey || cjConfig.refreshToken),
    ...diagnostics,
  };
}

module.exports = {
  testConnection,
  getAuthStatus,
};
