const { alibabaConfig, assertAlibabaConfigured } = require('../../config/alibaba');
const { getValidAccessToken } = require('./alibabaTokenService');
const { iopPost, iopPostFlexible, topPost } = require('./alibabaHttp');
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

async function topCall(method, bizParams = {}) {
  assertAlibabaConfigured();
  const accessToken = await getValidAccessToken();
  return topPost(method, bizParams, { accessToken });
}

async function testConnection() {
  const started = Date.now();
  const result = await alibabaCall('/product/list', {
    pool_id: alibabaConfig.defaultPoolId,
    page_no: 1,
    page_size: 1,
    country: alibabaConfig.defaultCountry,
  });
  const list = result?.resultList || result?.products || result?.productList || (Array.isArray(result) ? result : []);
  return {
    ok: true,
    latencyMs: Date.now() - started,
    sampleCount: Array.isArray(list) ? list.length : 0,
  };
}

module.exports = {
  iopCall,
  alibabaCall,
  topCall,
  testConnection,
  signIop,
};
