const test = require('node:test');
const assert = require('node:assert/strict');
const Product = require('../Models/AlibabaProduct');
const { decrementStockForOrder } = require('../services/orderService');

test('paid Alibaba orders update sales without decrementing sellable stock', async (t) => {
  const originalFindById = Product.findById;
  const originalFindByIdAndUpdate = Product.findByIdAndUpdate;
  const products = {
    alibaba: { isAlibaba: true, source: 'ALIBABA' },
    local: { source: 'LOCAL' },
  };
  const updates = [];

  t.after(() => {
    Product.findById = originalFindById;
    Product.findByIdAndUpdate = originalFindByIdAndUpdate;
  });

  Product.findById = (id) => ({
    select: () => ({
      session: async () => products[id] || null,
    }),
  });
  Product.findByIdAndUpdate = async (id, update, options) => {
    updates.push({ id, update, options });
  };

  const session = {};
  await decrementStockForOrder({
    order: {
      items: [
        { productId: 'alibaba', quantity: 6 },
        { productId: 'local', quantity: 2 },
      ],
    },
    session,
  });

  assert.deepEqual(updates.map(({ update }) => update.$inc), [
    { totalSales: 6 },
    { totalSales: 2, stock: -2 },
  ]);
  assert.ok(updates.every(({ options }) => options.session === session));
});
