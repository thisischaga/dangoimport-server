const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    // Informations de base
    name: {
        type: String,
        required: true,
        trim: true,
        index: true
    },
    slug: {
        type: String,
        unique: true,
        lowercase: true,
        index: true
    },
    sku: {
        type: String,
        unique: true,
        sparse: true
    },
    barcode: {
        type: String,
        sparse: true
    },

    // Catégorisation
    brand: {
        type: String,
        trim: true
    },
    category: {
        type: String,
        required: true,
        index: true
    },
    subCategory: {
        type: String
    },
    tags: [String],

    // Tarification
    price: {
        type: Number,
        required: true,
        min: 0
    },
    salePrice: {
        type: Number,
        min: 0
    },
    costPrice: {
        type: Number,
        min: 0
    },

    // Stock
    stock: {
        type: Number,
        required: true,
        default: 0,
        min: 0
    },
    minStock: {
        type: Number,
        default: 10
    },

    // Dimensions et poids
    weight: String,
    length: String,
    width: String,
    height: String,

    // Variantes
    color: [String],
    size: [String],
    material: String,

    // Description
    shortDescription: String,
    description: {
        type: String,
        required: true
    },
    specifications: [
        {
            key: String,
            value: String
        }
    ],
    features: [String],

    // Livraison et garantie
    shippingInfo: String,
    warranty: String,

    // Images et médias
    image: {
        type: String
    },
    images: [
        {
            url: String,
            alt: String,
            isPrimary: { type: Boolean, default: false }
        }
    ],
    videos: [String],
    documents: [String],

    // État du produit
    condition: {
        type: String,
        enum: ['Neuf', 'Occasion', 'Reconditionné'],
        default: 'Neuf'
    },

    // Marqueurs
    isFeatured: {
        type: Boolean,
        default: false,
        index: true
    },
    isBestSeller: {
        type: Boolean,
        default: false
    },
    isNewArrival: {
        type: Boolean,
        default: false
    },
    isPublished: {
        type: Boolean,
        default: true,
        index: true
    },

    // Avis clients
    rating: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
    },
    totalReviews: {
        type: Number,
        default: 0
    },
    reviews: [
        {
            userId: mongoose.Schema.Types.ObjectId,
            userName: String,
            rating: Number,
            comment: String,
            createdAt: { type: Date, default: Date.now }
        }
    ],

    // Statistiques
    totalSales: {
        type: Number,
        default: 0
    },

    // SEO
    seoTitle: String,
    seoDescription: String,
    seoKeywords: [String],

    // Variantes personnalisées (ancienne structure conservée)
    isCustomizable: {
        type: Boolean,
        default: false
    },
    parameters: [
        {
            name: String,
            options: [
                {
                    value: String,
                    priceAdjustment: { type: Number, default: 0 }
                }
            ]
        }
    ],

    // Variantes indépendantes (nouveau système)
    variants: [
        {
            name: { type: String, required: true },
            sku: String,
            price: { type: Number, required: true },
            stock: { type: Number, default: 0 },
            image: String,
            attributes: {
                type: mongoose.Schema.Types.Mixed,
                default: {}
            },
            isDefault: { type: Boolean, default: false },
        }
    ],

    // Informations de vendeur
    vendorName: {
        type: String,
        default: 'Vendeur Indépendant'
    },
    vendorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Vendor'
    },

    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
    date: {
        type: Date,
        default: Date.now,
    }
});

// Optimisation : Indexation pour recherche rapide
productSchema.index({ name: 'text', description: 'text', category: 'text' });
productSchema.index({ category: 1 });
productSchema.index({ isPublished: 1, createdAt: -1 });
productSchema.index({ isFeatured: 1, isPublished: 1 });
productSchema.index({ vendorName: 1, isPublished: 1 });
productSchema.index({ salePrice: 1 });
productSchema.index({ category: 1, isPublished: 1 });

module.exports = mongoose.model('Product', productSchema);
