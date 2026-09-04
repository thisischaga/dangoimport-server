const { determineDeliveryProvider } = require('../services/deliveryService');

function makeStore(opts = {}) {
  return {
    delivery: {
      mode: opts.mode || 'HYBRID',
      sellerDelivery: {
        enabled: opts.enabled !== undefined ? opts.enabled : true,
        radiusKm: opts.radiusKm || 5,
        location: { type: 'Point', coordinates: opts.coords || [2.5, 6.4] }
      },
      dangoImportFallback: opts.fallback !== undefined ? opts.fallback : true
    },
    location: { type: 'Point', coordinates: opts.coords || [2.5, 6.4] }
  };
}

(async () => {
  // client within radius
  const store = makeStore({ coords: [2.5, 6.4], radiusKm: 10 });
  const client = { lat: 6.401, lng: 2.501 };
  const r1 = await determineDeliveryProvider({ store, clientLocation: client });
  console.log('within radius ->', r1);

  // client far
  const r2 = await determineDeliveryProvider({ store: makeStore({ coords: [2.5, 6.4], radiusKm: 1 }), clientLocation: { lat: 7.0, lng: 2.5 } });
  console.log('far ->', r2);
})();
