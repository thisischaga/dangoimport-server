process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 'test-resend-key';

const path = require('node:path');
const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

test('Alibaba admin routes keep the compatibility alias mounted', () => {
  assert.match(
    serverSource,
    /app\.use\(['"]\/api\/admin\/alibaba['"],\s*adminAlibabaSupplierRoutes\)/,
    'Expected a legacy /api/admin/alibaba mount to keep compatibility with older clients.'
  );
});
