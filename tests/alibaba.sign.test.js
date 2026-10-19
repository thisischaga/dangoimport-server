const test = require('node:test');
const assert = require('node:assert/strict');
const { signIop } = require('../services/alibaba/alibabaSign');

test('Alibaba Open Platform HMAC-SHA256 signature is stable for sorted params', () => {
  const path = '/auth/token/create';
  const sign = signIop(path, { b: '2', a: '1', app_key: '504934' }, 'secret');
  assert.equal(sign, signIop(path, { a: '1', app_key: '504934', b: '2' }, 'secret'));
  assert.equal(sign.length, 64);
  assert.equal(sign, sign.toUpperCase());
});
