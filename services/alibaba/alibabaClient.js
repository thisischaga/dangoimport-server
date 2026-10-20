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
  const name = String(apiName || '');
  const path = name.startsWith('/') ? name : `/${name.replace(/\./g, '/')}`;
  // Les endpoints acheteur /eco/* sont en GET, le reste en POST.
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