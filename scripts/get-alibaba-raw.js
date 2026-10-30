require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { getAlibabaRawProduct } = require('../services/alibaba/alibabaProductService');

async function main() {
  const input = process.argv[2] || '1601635137534';
  console.log(`\n======================================================`);
  console.log(`🔍 Récupération des données BRUTES Alibaba pour : ${input}`);
  console.log(`======================================================\n`);

  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (mongoUri && mongoose.connection.readyState === 0) {
    try {
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
      console.log(`📦 Connecté à MongoDB (pour le jeton OAuth Alibaba).`);
    } catch (e) {
      console.warn(`⚠️ Impossible de se connecter à MongoDB (${e.message}), utilisation du token ENV.`);
    }
  }

  try {
    const result = await getAlibabaRawProduct(input);

    const outputFile = path.join(process.cwd(), 'alibaba-raw-output.json');
    fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), 'utf8');

    console.log(`✅ Succès ! Les données brutes complètes ont été enregistrées dans :`);
    console.log(`   👉 ${outputFile}\n`);

    console.log(`--- APERÇU RAPIDE DE LA RÉPONSE BRUTE ---`);
    console.log(`Product ID :`, result.productId);
    console.log(`Endpoint   :`, result.endpoint);

    const rawDesc = result.raw?.result?.result_data || result.raw?.result_data || result.raw?.result || result.raw;
    if (rawDesc) {
      console.log(`Clés principales du payload brut :`, Object.keys(rawDesc));
      if (rawDesc.subject) console.log(`Titre (subject) :`, rawDesc.subject);
      if (rawDesc.product_id) console.log(`Product ID brut :`, rawDesc.product_id);
      if (Array.isArray(rawDesc.skus)) {
        console.log(`Nombre de SKUs bruts :`, rawDesc.skus.length);
        console.log(`Premier SKU brut :`, JSON.stringify(rawDesc.skus[0], null, 2));
      }
    }

    if (result.inventoryRaw) {
      console.log(`\nInventaire brut (/eco/buyer/product/inventory) disponible.`);
    }

    if (result.keyAttributesRaw) {
      console.log(`Attributs clés bruts (/eco/buyer/product/keyattributes) disponibles.`);
    }

    if (result.errors?.description) {
      console.warn(`\n⚠️ Erreur description :`, result.errors.description);
    }
  } catch (err) {
    console.error(`\n❌ Erreur lors de la récupération :`, err.message);
    if (err.alibabaOrigin) {
      console.error(`Code erreur Alibaba :`, err.code);
    }
    process.exit(1);
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

main();
