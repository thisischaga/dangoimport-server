const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyAlibabaError } = require('../services/alibaba/alibabaErrors');
const { buildGopRequest, buildEcoGetRequest, shouldAppendPath } = require('../services/alibaba/alibabaHttp');
const { alibabaConfig } = require('../config/alibaba');
const {
  extractProductId,
  REJECTED_API_PATHS,
} = require('../services/alibaba/alibabaProductService');
const { buildExternalSourceKey } = require('../services/alibaba/alibabaMapper');

test('classifies Alibaba invalid path separately from missing permission', () => {
  const invalid = classifyAlibabaError({ message: 'The specified API Path is invalid' });
  assert.equal(invalid.code, 'INVALID_API_PATH');
  assert.equal(invalid.alibaba, true);
  const permission = classifyAlibabaError({ message: 'App does not have permission to access this api' });
  assert.equal(permission.code, 'NO_API_PERMISSION');
  assert.equal(permission.alibaba, true);
  const keyword = classifyAlibabaError({ message: 'Collez l’ID', code: 'PRODUCT_ID_REQUIRED', status: 400 });
  assert.equal(keyword.code, 'PRODUCT_ID_REQUIRED');
  assert.equal(keyword.alibaba, false);
  assert.equal(keyword.status, 400);
});

test('classifies unsupported HTTP method', () => {
  const method = classifyAlibabaError({ message: 'This http method is not supported' });
  assert.equal(method.code, 'HTTP_METHOD_NOT_SUPPORTED');
});

test('classifies missing app_key separately from invalid key', () => {
  const missing = classifyAlibabaError({
    message: 'The input parameter “app_key” that is mandatory for processing this request is not supplied',
  });
  assert.equal(missing.code, 'MISSING_APP_KEY');
});

test('GOP product calls POST to /rest ; auth appends /auth/token/create', () => {
  assert.equal(shouldAppendPath('/auth/token/create'), true);
  assert.equal(shouldAppendPath('/icbu/product/get'), false);
  const product = buildGopRequest('/icbu/product/get', { product_get_request: '{"productId":1}' }, { accessToken: 'tok' });
  assert.equal(product.append, false);
  assert.match(product.url, /\/rest$/);
  assert.equal(product.params.method, '/icbu/product/get');
  const auth = buildGopRequest('/auth/token/create', { code: 'abc' });
  assert.equal(auth.append, true);
  assert.match(auth.url, /\/rest\/auth\/token\/create$/);
  assert.equal(auth.params.method, undefined);
  assert.equal(auth.params.format, undefined);
  assert.equal(auth.params.code, 'abc');
  assert.equal(auth.params.sign_method, 'sha256');
  assert.deepEqual(Object.keys(auth.params).sort(), ['app_key', 'code', 'sign', 'sign_method', 'timestamp']);
});

test('classifies IncompleteSignature before permission wording', () => {
  const mixed = classifyAlibabaError({
    code: 'IncompleteSignature',
    message: 'The request signature does not conform to platform standards et App does not have permission to access this api',
  });
  assert.equal(mixed.code, 'IncompleteSignature');
});

test('extractProductId reads numeric IDs and product-detail URLs', () => {
  assert.equal(extractProductId('laptop'), '');
  assert.equal(extractProductId('1600123456789'), '1600123456789');
  assert.equal(
    extractProductId('https://www.alibaba.com/product-detail/Wireless-Earbuds_1600987654321.html'),
    '1600987654321',
  );
});

test('buyer catalog uses eco GET paths instead of seller ICBU APIs', () => {
  assert.equal(alibabaConfig.productGetPath, '/eco/buyer/product/description');
  assert.equal(alibabaConfig.productSearchPath, '/eco/buyer/product/search');
  assert.equal(alibabaConfig.productListPath, '/eco/buyer/product/check');
  assert.equal(shouldAppendPath('/eco/buyer/product/description'), true);
  const eco = buildEcoGetRequest('/eco/buyer/product/check', { query_req: { pool_id: '9031800410' } }, { accessToken: 'tok' });
  assert.match(eco.queryUrl, /\/rest\/eco\/buyer\/product\/check\?/);
  assert.equal(eco.params.method, undefined);
  assert.equal(eco.params.format, undefined);
  assert.equal(eco.params.query_req, undefined);
  assert.equal(JSON.parse(eco.params.param0).pool_id, '9031800410');
  assert.equal(/(?:^|[?&])method=/.test(eco.queryUrl), false);
  assert.equal(/(?:^|[?&])format=/.test(eco.queryUrl), false);
  assert.match(eco.queryUrl, /app_key=/);
  assert.match(eco.queryUrl, /access_token=tok/);
  assert.match(eco.queryUrl, /sign_method=sha256/);
  assert.match(eco.queryUrl, /sign=/);
  assert.match(eco.queryUrl, /param0=/);
  assert.equal(eco.headerHeaders['X-Protocol'], 'GOP');
  assert.equal(eco.headerHeaders.app_key, undefined);
});

test('buyer search and description wrap business fields as param0 JSON', () => {
  const search = buildEcoGetRequest('/eco/buyer/product/search', {
    keywords: 'phone',
    country: 'US',
    page_index: 1,
    page_size: 20,
  }, { accessToken: 'tok' });
  assert.equal(search.params.keywords, undefined);
  assert.deepEqual(JSON.parse(search.params.param0), {
    keywords: 'phone',
    country: 'US',
    page_index: 1,
    page_size: 20,
  });
  const description = buildEcoGetRequest('/eco/buyer/product/description', {
    product_id: '1600123456789',
    country: 'US',
  }, { accessToken: 'tok' });
  assert.equal(description.params.product_id, undefined);
  assert.equal(JSON.parse(description.params.param0).product_id, '1600123456789');
});

test('classifies missing param0 separately from missing app_key', () => {
  const missing = classifyAlibabaError({
    message: 'The input parameter “param0” that is mandatory for processing this request is not supplied',
  });
  assert.equal(missing.code, 'MISSING_PARAM0');
});

test('rejected GOP paths stay blocked', () => {
  assert.ok(REJECTED_API_PATHS.has('/alibaba/dropshipping/product/get'));
  assert.ok(REJECTED_API_PATHS.has('/product/get'));
  assert.ok(REJECTED_API_PATHS.has('/alibaba/icbu/product/get'));
  assert.ok(REJECTED_API_PATHS.has('/icbu/product/get'));
});

test('external source key is stable for Alibaba product IDs', () => {
  assert.equal(buildExternalSourceKey('1600123456789'), 'alibaba:1600123456789');
});
