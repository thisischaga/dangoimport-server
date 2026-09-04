// Lightweight test for onboardingController.saveDeliveryConfig
// Run: node tests/onboardingController.test.js

const path = require('path')

async function run() {
  // Resolve real model paths
  const storePath = require.resolve('../Models/Store')
  const userPath = require.resolve('../Models/User')

  // Create mock store instance
  const mockStoreInstance = {
    delivery: {
      mode: 'HYBRID',
      sellerDelivery: {
        enabled: true,
        radiusKm: 10,
        location: { type: 'Point', coordinates: [2.5, 6.4] }
      },
      dangoImportFallback: true
    },
    onboarding: {},
    saveCalled: false,
    save: async function() { this.saveCalled = true; return this }
  }

  // Mock Store module
  const mockStoreModule = {
    findOne: async (query) => {
      if (query && query.userId) return mockStoreInstance
      return null
    }
  }

  // Mock User minimal (not used here)
  const mockUserModule = {
    findById: async (id) => ({ _id: id, vendorName: 'V', save: async function(){}})
  }

  // Inject mocks into require cache
  require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: mockStoreModule }
  require.cache[userPath] = { id: userPath, filename: userPath, loaded: true, exports: mockUserModule }

  // Now require the controller
  const controller = require('../Controllers/onboardingController')

  // Helper to capture res
  function makeRes() {
    const out = { statusCode: 200, body: null }
    const res = {
      _out: out,
      status(code) { out.statusCode = code; return this },
      json(obj) { out.body = obj; return out }
    }
    return { res, out }
  }

  // Test 1: valid payload
  const req1 = { user: { userId: 'u1' }, body: { mode: 'SELLER', sellerDelivery: { enabled: true, radiusKm: 20, location: { lat: 6.4, lng: 2.5 } } } }
  const r1 = makeRes()
  await controller.saveDeliveryConfig(req1, r1.res)
  console.log('Test 1 result:', r1.out)

  // Test 2: invalid radius
  const req2 = { user: { userId: 'u1' }, body: { mode: 'SELLER', sellerDelivery: { enabled: true, radiusKm: -5, location: { lat: 6.4, lng: 2.5 } } } }
  const r2 = makeRes()
  await controller.saveDeliveryConfig(req2, r2.res)
  console.log('Test 2 result:', r2.out)

  // Test 3: SELLER mode but sellerDelivery disabled -> should error
  const req3 = { user: { userId: 'u1' }, body: { mode: 'SELLER', sellerDelivery: { enabled: false } } }
  const r3 = makeRes()
  await controller.saveDeliveryConfig(req3, r3.res)
  console.log('Test 3 result:', r3.out)
}

run().catch(err => { console.error(err); process.exit(1) })
