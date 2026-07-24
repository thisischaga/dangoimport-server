const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    // Numéro de commande
    orderNumber: {
        type: String,
        unique: true,
        required: true
    },

    // Client
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    customerName: {
        type: String,
        required: true
    },
    customerEmail: {
        type: String,
        required: true
    },
    customerPhone: {
        type: String,
        required: true
    },

    // Adresse de livraison
    shippingAddress: {
        country: String,
        city: String,
        neighborhood: String,
        fullAddress: String,
        postalCode: String,
        instructions: String
    },

    // Articles commandés
    items: [
        {
            productId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Product',
                required: true
            },
            productName: String,
            productImage: String,
            price: Number,
            quantity: {
                type: Number,
                required: true,
                min: 1
            },
            selectedOptions: {
                color: String,
                size: String,
                material: String
            },
            subtotal: Number
        }
    ],

    // Tarification
    subtotal: {
        type: Number,
        required: true
    },
    shippingCost: {
        type: Number,
        default: 0
    },
    tax: {
        type: Number,
        default: 0
    },
    discount: {
        type: Number,
        default: 0
    },
    total: {
        type: Number,
        required: true
    },

    // Livraison
    shippingMethod: {
        type: String,
        enum: ['standard', 'express', 'pickup'],
        default: 'standard'
    },
    estimatedDelivery: Date,

    // Statut
    status: {
        type: String,
        enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'],
        default: 'pending',
        index: true
    },

    // Paiement
    paymentMethod: {
        type: String,
        enum: ['mobile_money', 'credit_card', 'crypto', 'paypal', 'bank_transfer'],
        required: true
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'refunded'],
        default: 'pending'
    },
    paymentDate: Date,

    // Informations de suivi
    trackingNumber: String,
    carrier: String,

    // Notes
    notes: String,
    adminNotes: String,

    // Dates
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
    confirmedAt: Date,
    shippedAt: Date,
    deliveredAt: Date
});

// Index pour recherches rapides
orderSchema.index({ customerId: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ orderNumber: 1 });

module.exports = mongoose.model('Order', orderSchema);