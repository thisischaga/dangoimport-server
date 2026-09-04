// Simple index creation script for dangoimport-server
// Usage: MONGO_URI="mongodb://localhost:27017/db" node scripts/ensureIndexes.js

const mongoose = require('mongoose')
const path = require('path')

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/dango'

async function main() {
  try {
    console.log('Connecting to', MONGO_URI)
    await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })

    // Load models so indexes are registered
    const Store = require(path.join(__dirname, '..', 'Models', 'Store'))
    console.log('Initializing indexes for Store...')
    await Store.init()
    console.log('Store indexes ensured.')

    // optionally init other models if needed

    await mongoose.disconnect()
    console.log('Disconnected.')
  } catch (err) {
    console.error('Error ensuring indexes:', err)
    process.exit(1)
  }
}

main()
