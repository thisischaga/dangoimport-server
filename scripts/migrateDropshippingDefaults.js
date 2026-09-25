/**
 * Migration de compatibilité dropshipping.
 * Usage: node scripts/migrateDropshippingDefaults.js
 */
require('dotenv').config();
const connectDB = require('../Congfig/db');
const Product = require('../Models/Product');

async function migrate() {
  await connectDB();

  const result = await Product.updateMany(
    {
      $or: [
        { sourceType: { $exists: false } },
        { fulfillmentType: { $exists: false } },
        { isDropshippingActive: { $exists: false } },
      ],
    },
    {
      $set: {
        sourceType: 'LOCAL_SELLER',
        fulfillmentType: 'SELLER',
        isDropshippingActive: false,
        importSourceType: 'MANUAL',
      },
    }
  );

  console.log(`Migration terminée. Produits mis à jour: ${result.modifiedCount || result.nModified || 0}`);
  process.exit(0);
}

migrate().catch((error) => {
  console.error('Migration échouée:', error);
  process.exit(1);
});
