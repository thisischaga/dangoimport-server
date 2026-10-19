const test = require('node:test');
const assert = require('node:assert/strict');
const { signRequest } = require('../services/alibaba/alibabaClient');

test('Alibaba HMAC-SHA1 signature is stable for sorted params', () => {
  const path = 'param2/1/com.alibaba.product/alibaba.product.search/APPKEY';
  const sign = signRequest(path, { b: '2', a: '1' }, 'secret');
  assert.equal(sign, signRequest(path, { a: '1', b: '2' }, 'secret'));
  assert.equal(sign.length, 40);
});
