# Onboarding / Delivery Migration & Indexing

This document explains how to ensure geospatial indexes and perform minimal migration steps after onboarding/delivery schema updates.

1) Ensure MongoDB is running and reachable.

2) From the `dangoimport-server` folder, run:

```bash
MONGO_URI="mongodb://localhost:27017/dango" node scripts/ensureIndexes.js
```

This will load the `Store` model and call `Store.init()` which creates the `2dsphere` indexes for `location` and `delivery.sellerDelivery.location`.

3) Validate that indexes exist using mongo shell or MongoDB Compass. Example in mongo shell:

```js
use dango
db.stores.getIndexes()
```

4) If you changed existing documents and need to populate `delivery.sellerDelivery.location` from another field, run a small migration script (example below):

```js
// example migration (do not run blindly):
// iterate stores where sellerDelivery.location is default and copy store.location
const mongoose = require('mongoose')
const Store = require('../Models/Store')

async function migrate() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/dango')
  const cursor = Store.find({ 'delivery.sellerDelivery.location.coordinates': { $in: [[0,0]] } }).cursor()
  for (let store = await cursor.next(); store != null; store = await cursor.next()) {
    if (store.location && store.location.coordinates) {
      store.delivery.sellerDelivery.location = store.location
      await store.save()
    }
  }
  await mongoose.disconnect()
}

migrate()
```

5) After indexes are ensured, restart the backend so Mongoose uses the indexes. The server may create indexes automatically depending on `autoIndex`.


If you want, I can add an idempotent migration script to populate missing coordinates; tell me and I'll add it.
