// Populates delivery.sellerDelivery.location from store.location when missing
// Usage: MONGO_URI="mongodb://localhost:27017/dango" node scripts/migratePopulateSellerLocation.js

const mongoose = require('mongoose')
const path = require('path')

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/dango'

async function main() {
  try {
    await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    const Store = require(path.join(__dirname, '..', 'Models', 'Store'))

    const cursor = Store.find().cursor()
    let count = 0
    for (let store = await cursor.next(); store != null; store = await cursor.next()) {
      const s = store.delivery?.sellerDelivery?.location
      const hasCoords = Array.isArray(s?.coordinates) && s.coordinates.length === 2 && !(s.coordinates[0] === 0 && s.coordinates[1] === 0)
      if (!hasCoords && store.location && Array.isArray(store.location.coordinates) && store.location.coordinates.length === 2) {
        store.delivery = store.delivery || {}
        store.delivery.sellerDelivery = store.delivery.sellerDelivery || {}
        store.delivery.sellerDelivery.location = store.location
        await store.save()
        count++
      }
    }

    console.log('Migration complete. Populated', count, 'store(s).')
    await mongoose.disconnect()
  } catch (err) {
    console.error('Migration error:', err)
    process.exit(1)
  }
}

main()
