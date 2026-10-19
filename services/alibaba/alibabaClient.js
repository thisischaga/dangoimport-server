const { assertAlibabaConfigured } = require('../../config/alibaba');
const { getValidAccessToken } = require('./alibabaTokenService');
const { iopPost, iopPostFlexible } = require('./alibabaHttp');
const { signIop } = require('./alibabaSign');

async function iopCall(apiPath, bizParams = {}, { needsToken = true } = {}) {
  assertAlibabaConfigured();
  const accessToken = needsToken ? await getValidAccessToken() : undefined;
  return iopPost(apiPath, bizParams, { accessToken });
}

async function alibabaCall(apiName, bizParams = {}) {
  assertAlibabaConfigured();
  const accessToken = await getValidAccessToken();
  const path = String(apiName || '').startsWith('/') ? apiName : `/${String(apiName || '').replace(/\./g, '/')}`;
  return iopPostFlexible(path, bizParams, { accessToken });
}

async function testConnection() {
  const started = Date.now();
  await getValidAccessToken();
  return {
    ok: true,
    latencyMs: Date.now() - started,
    note: 'Token OAuth GOP valide. Collez un ID produit Alibaba.com, pas un mot-clé.',
  };
}

module.exports = {
  iopCall,
  alibabaCall,
  testConnection,
  signIop,
};
