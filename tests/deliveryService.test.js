const assert = require('assert');
const { determineDeliveryProvider, calculateDeliveryForItems } = require('../services/deliveryService');

function makeStore(opts = {}) {
  return {
    name: opts.name || 'Boutique test',
    userId: opts.userId,
    delivery: {
      mode: opts.mode || 'HYBRID',
      sellerDelivery: {
        enabled: opts.enabled !== undefined ? opts.enabled : true,
        radiusKm: opts.radiusKm || 10,
        baseFee: opts.baseFee || 500,
        ratePerKm: opts.ratePerKm || 150,
        location: { type: 'Point', coordinates: opts.coords || [2.5, 6.4] }
      },
      dangoImportFallback: opts.fallback !== undefined ? opts.fallback : true
    },
    location: { type: 'Point', coordinates: opts.coords || [2.5, 6.4] }
  };
}

(async () => {
  const store = makeStore({ coords: [2.5, 6.4], radiusKm: 10 });
  const client = { lat: 6.401, lng: 2.501 };
  const r1 = await determineDeliveryProvider({ store, clientLocation: client });
  console.log('within radius ->', r1);
  assert.strictEqual(r1.provider, 'SELLER');
  assert.ok(r1.fee > 0);

  const r2 = await determineDeliveryProvider({ store: makeStore({ coords: [2.5, 6.4], radiusKm: 1 }), clientLocation: { lat: 7.0, lng: 2.5 } });
  console.log('far ->', r2);
  assert.strictEqual(r2.provider, 'DANGOIMPORT');

  const result = {
    provider: 'HYBRID',
    groups: [
      { vendorId: '67d2d4d668fd0c3ae7884aa1', fee: 1200, breakdown: { zone: 'urban', baseFee: 300, ratePerKm: 150, distanceKm: 3 }, itemsCount: 1 },
      { vendorId: '67d2d4d668fd0c3ae7884aa2', fee: 1800, breakdown: { zone: 'suburban', baseFee: 500, ratePerKm: 200, distanceKm: 5 }, itemsCount: 1 },
    ],
  };
  const totalFee = result.groups.reduce((sum, g) => sum + Number(g.fee || 0), 0);
  assert.strictEqual(totalFee, 3000);
  console.log('multi-vendor total ->', totalFee);

  const pricing = {
    provider: 'HYBRID',
    groups: [
      { vendorId: '67d2d4d668fd0c3ae7884aa1', fee: 1200 },
      { vendorId: '67d2d4d668fd0c3ae7884aa2', fee: 1800 },
    ],
  };
  const feeTotal = pricing.groups.reduce((sum, g) => sum + Number(g.fee || 0), 0);
  assert.strictEqual(feeTotal, 3000);
  console.log('calculated total ->', feeTotal);
})();
