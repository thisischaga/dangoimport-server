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
  const path = String(apiName || '').startsWith('/') ? apiName : `/${String(apiName || '').replace(/\./g, '/')}`;
  return iopCall(path, bizParams);
}

async function testConnection() {
  const started = Date.now();
  const result = await iopCall('/alibaba/dropshipping/product/list', {
    keyword: 'phone',
    page_no: 1,
    page_size: 1,
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
  testConnection,
  signIop,
};
