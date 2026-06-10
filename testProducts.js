/**
 * Script de test pour ajouter des produits à la base de données
 * Exécuter avec: node testProducts.js
 */

const mongoose = require('mongoose');
const Product = require('./Models/Product');
require('dotenv').config();

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dangoimport';

const testProducts = [
  {
    name: 'Écouteurs Bluetooth Premium',
    slug: 'ecouteurs-bluetooth-premium',
    sku: 'AUDIO-001',
    brand: 'SoundMax',
    category: 'Électronique',
    subCategory: 'Audio',
    price: 49999,
    salePrice: 35999,
    costPrice: 20000,
    stock: 50,
    minStock: 10,
    weight: '250g',
    shortDescription: 'Écouteurs sans fil avec réduction de bruit active',
    description: 'Profitez d\'une expérience audio premium avec nos écouteurs sans fil. Technologie de réduction de bruit active, batterie longue durée 40h, Bluetooth 5.0 stable.',
    specifications: [
      { key: 'Batterie', value: '40 heures' },
      { key: 'Bluetooth', value: '5.0' },
      { key: 'Réduction de bruit', value: 'Active ANC' },
      { key: 'Couleurs', value: 'Noir, Blanc, Bleu' }
    ],
    features: ['Réduction de bruit', 'Microphone intégré', 'Batterie longue durée', 'Waterproof'],
    color: ['Noir', 'Blanc', 'Bleu'],
    condition: 'Neuf',
    isFeatured: true,
    isBestSeller: true,
    isPublished: true,
    images: [
      {
        url: 'https://via.placeholder.com/500x500?text=Ecouteurs+Bluetooth',
        alt: 'Écouteurs de face',
        isPrimary: true
      }
    ],
    seoTitle: 'Écouteurs Bluetooth Premium Sans Fil',
    seoDescription: 'Achetez les meilleurs écouteurs Bluetooth avec réduction de bruit',
    seoKeywords: ['écouteurs', 'bluetooth', 'sans fil', 'audio']
  },
  {
    name: 'Batterie Externe 50000mAh',
    slug: 'batterie-externe-50000',
    sku: 'BATT-001',
    brand: 'PowerBank Pro',
    category: 'Électronique',
    subCategory: 'Accessoires',
    price: 34999,
    salePrice: 24999,
    costPrice: 15000,
    stock: 75,
    minStock: 15,
    weight: '500g',
    shortDescription: 'Batterie externe haute capacité avec charge rapide',
    description: 'Chargez vos appareils 5 fois plus vite avec notre batterie externe 50000mAh. Charge rapide 65W, multiple ports USB-C et USB-A.',
    specifications: [
      { key: 'Capacité', value: '50000 mAh' },
      { key: 'Entrée', value: 'USB-C 65W' },
      { key: 'Sorties', value: '2x USB-C, 1x USB-A' },
      { key: 'Poids', value: '500g' }
    ],
    features: ['Charge rapide 65W', 'Écran LED', 'Protections multiples', 'Léger'],
    color: ['Noir', 'Blanc', 'Gris'],
    condition: 'Neuf',
    isFeatured: true,
    isPublished: true,
    images: [
      {
        url: 'https://via.placeholder.com/500x500?text=Batterie+Externe',
        alt: 'Batterie de face',
        isPrimary: true
      }
    ],
    seoTitle: 'Batterie Externe 50000mAh Rapide',
    seoKeywords: ['batterie', 'powerbank', 'charge rapide']
  },
  {
    name: 'Câble USB-C Renforcé 2m',
    slug: 'cable-usb-c-renforce',
    sku: 'CABLE-001',
    brand: 'TechCord',
    category: 'Électronique',
    subCategory: 'Câbles',
    price: 7999,
    salePrice: 4999,
    costPrice: 2500,
    stock: 200,
    minStock: 50,
    weight: '100g',
    shortDescription: 'Câble USB-C robuste et durable',
    description: 'Câble USB-C de qualité premium, renforcé à la gaine silicone pour une durabilité maximale. Compatible avec tous les appareils USB-C.',
    specifications: [
      { key: 'Longueur', value: '2 mètres' },
      { key: 'Noyau', value: 'Cuivre pur' },
      { key: 'Débit', value: 'Jusqu\'à 100W' },
      { key: 'Connecteurs', value: 'USB-C M/M' }
    ],
    features: ['Renforcé silicone', 'Résistant', 'Charge rapide', 'Données'],
    color: ['Noir', 'Blanc', 'Bleu'],
    condition: 'Neuf',
    isPublished: true,
    images: [
      {
        url: 'https://via.placeholder.com/500x500?text=Cable+USB-C',
        alt: 'Câble USB-C',
        isPrimary: true
      }
    ],
    seoTitle: 'Câble USB-C 2m Renforcé Premium',
    seoKeywords: ['câble', 'usb-c', 'charge']
  },
  {
    name: 'Souris Sans Fil Ergonomique',
    slug: 'souris-sans-fil-ergonomique',
    sku: 'MOUSE-001',
    brand: 'ErgoTech',
    category: 'Informatique',
    subCategory: 'Périphériques',
    price: 29999,
    salePrice: 19999,
    costPrice: 10000,
    stock: 40,
    minStock: 10,
    weight: '150g',
    shortDescription: 'Souris sans fil ergonomique pour confort maximal',
    description: 'Souris ergonomique sans fil avec récepteur USB 2.4GHz. Design adapté à la main droite et gauche, 5 boutons programmables.',
    specifications: [
      { key: 'Connexion', value: 'Wireless 2.4GHz' },
      { key: 'Boutons', value: '5 boutons programmables' },
      { key: 'Batterie', value: '2x AA (18 mois)' },
      { key: 'Résolution', value: 'Jusqu\'à 3200 DPI' }
    ],
    features: ['Ergonomique', 'Ambidextre', 'Sans fil', '5 boutons'],
    color: ['Noir', 'Gris'],
    condition: 'Neuf',
    isPublished: true,
    images: [
      {
        url: 'https://via.placeholder.com/500x500?text=Souris+Ergonomique',
        alt: 'Souris de face',
        isPrimary: true
      }
    ],
    seoTitle: 'Souris Sans Fil Ergonomique Programmable',
    seoKeywords: ['souris', 'ergonomique', 'sans fil', 'informatique']
  },
  {
    name: 'Clavier Mécanique RGB',
    slug: 'clavier-mecanique-rgb',
    sku: 'KEYB-001',
    brand: 'MechaKey',
    category: 'Informatique',
    subCategory: 'Périphériques',
    price: 89999,
    salePrice: 64999,
    costPrice: 35000,
    stock: 25,
    minStock: 5,
    weight: '900g',
    shortDescription: 'Clavier mécanique RGB pro avec switches personnalisés',
    description: 'Clavier mécanique professionnel avec rétroéclairage RGB personnalisable. Switches mécanique de haute qualité, repose-poignets intégré.',
    specifications: [
      { key: 'Type', value: 'Mécanique' },
      { key: 'Switches', value: 'Hot-swappable' },
      { key: 'Rétroéclairage', value: 'RGB per-key' },
      { key: 'Taille', value: 'TKL (87 touches)' }
    ],
    features: ['Mécanique', 'RGB', 'Programmable', 'Repose-poignets'],
    color: ['Noir', 'Blanc'],
    condition: 'Neuf',
    isBestSeller: true,
    isPublished: true,
    images: [
      {
        url: 'https://via.placeholder.com/500x500?text=Clavier+Mecanique',
        alt: 'Clavier mécanique',
        isPrimary: true
      }
    ],
    seoTitle: 'Clavier Mécanique RGB TKL Pro',
    seoKeywords: ['clavier', 'mécanique', 'rgb', 'gaming']
  }
];

async function seedDatabase() {
  try {
    await mongoose.connect(mongoUri);
    console.log('✅ Connecté à MongoDB');

    // Vérifier si les produits existent déjà
    const existing = await Product.countDocuments();
    if (existing > 0) {
      console.log(`⚠️  ${existing} produits existent déjà`);
    }

    // Ajouter les produits
    const created = await Product.insertMany(testProducts, { ordered: false });
    console.log(`✅ ${created.length} produits créés avec succès!`);

    // Afficher les IDs pour test
    console.log('\n📝 IDs des produits créés:');
    created.forEach((product, idx) => {
      console.log(`  ${idx + 1}. ${product.name}: ${product._id}`);
    });

    console.log('\n🧪 Testez avec: http://localhost:3001/product/[ID_DU_PRODUIT]');

  } catch (error) {
    console.error('❌ Erreur:', error.message);
  } finally {
    await mongoose.connection.close();
  }
}

seedDatabase();
