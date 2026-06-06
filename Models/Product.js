const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    price: {
        type: Number,
        required: true,
    },
    category: {
        type: String,
        required: true,
    },
    description: {
        type: String,
        required: true,
    },
    image: {
        type: String, // Sera du base64 ou URL d'image
        required: true,
    },
    vendorName: {
        type: String,
        required: true,
        default: 'Vendeur Indépendant'
    },
    isCustomizable: {
        type: Boolean,
        default: false
    },
    parameters: [
        {
            name: String, // ex: "Taille", "Couleur"
            options: [
                {
                    value: String, // ex: "S", "M", "L"
                    priceAdjustment: { type: Number, default: 0 } // Surcoût optionnel
                }
            ]
        }
    ],
    rating: {
        type: Number,
        default: 0
    },
    reviews: {
        type: Number,
        default: 0
    },
    date: {
        type: Date,
        default: Date.now,
    }
});

// Optimisation : Indexation pour recherche rapide
productSchema.index({ name: 'text', description: 'text', category: 'text' });
productSchema.index({ category: 1 });

module.exports = mongoose.model('Product', productSchema);
