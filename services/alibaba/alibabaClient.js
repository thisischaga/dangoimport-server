const { alibabaConfig, assertAlibabaConfigured } = require('../../config/alibaba');
const { getValidAccessToken } = require('./alibabaTokenService');
const { iopPost, iopGet } = require('./alibabaHttp');
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
  if (path.startsWith('/eco/')) {
    return iopGet(path, bizParams, { accessToken });
  }
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
    productSearchPath: alibabaConfig.productSearchPath,
    productListPath: alibabaConfig.productListPath,
    note: 'Token OAuth présent. Catalogue acheteur : /eco/buyer/product/*',
  };
}

module.exports = {
  iopCall,
  alibabaCall,
  testConnection,
  signIop,
};
