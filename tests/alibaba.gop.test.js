const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyAlibabaError } = require('../services/alibaba/alibabaErrors');
const { buildGopRequest, shouldAppendPath } = require('../services/alibaba/alibabaHttp');
const {
  extractProductId,
  searchAlibabaProducts,
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
  assert.equal(auth.params.method, '/auth/token/create');
  assert.equal(auth.params.code, 'abc');
  assert.equal(auth.params.sign_method, 'sha256');
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

test('keyword search is rejected locally when no Product List path is configured', async () => {
  await assert.rejects(
    () => searchAlibabaProducts({ keyword: 'laptop' }),
    (error) => error.code === 'PRODUCT_ID_REQUIRED' && error.status === 400,
  );
});

test('product ID lookup is blocked until ALIBABA_PRODUCT_GET_PATH is set', async () => {
  await assert.rejects(
    () => searchAlibabaProducts({ keyword: '1600123456789' }),
    (error) => error.code === 'PRODUCT_GET_PATH_REQUIRED' && error.status === 503,
  );
});

test('rejected GOP paths stay blocked', () => {
  assert.ok(REJECTED_API_PATHS.has('/alibaba/dropshipping/product/get'));
  assert.ok(REJECTED_API_PATHS.has('/product/get'));
  assert.ok(REJECTED_API_PATHS.has('/alibaba/icbu/product/get'));
});

test('external source key is stable for Alibaba product IDs', () => {
  assert.equal(buildExternalSourceKey('1600123456789'), 'alibaba:1600123456789');
});
