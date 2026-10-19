const { alibabaConfig, assertAlibabaConfigured } = require('../../config/alibaba');
const { getValidAccessToken } = require('./alibabaTokenService');
const { iopPost } = require('./alibabaHttp');
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
  return iopPost(path, bizParams, { accessToken });
}

async function testConnection() {
  const started = Date.now();
  await getValidAccessToken();
  return {
    ok: true,
    latencyMs: Date.now() - started,
    gateway: alibabaConfig.gateway,
    productGetPath: alibabaConfig.productGetPath,
    productListPath: alibabaConfig.productListPath || null,
    note: 'Token OAuth présent. La recherche mot-clé n’est appelée que si ALIBABA_PRODUCT_LIST_PATH est défini.',
  };
}

module.exports = {
  iopCall,
  alibabaCall,
  testConnection,
  signIop,
};
