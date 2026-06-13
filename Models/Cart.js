const mongoose = require('mongoose');

const cartSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
        index: true
    },

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
                min: 1,
                default: 1
            },
            selectedOptions: {
                type: mongoose.Schema.Types.Mixed,
                default: {}
            },
            addedAt: {
                type: Date,
                default: Date.now
            }
        }
    ],

    totalItems: {
        type: Number,
        default: 0
    },

    totalPrice: {
        type: Number,
        default: 0
    },

    createdAt: {
        type: Date,
        default: Date.now
    },

    updatedAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Cart', cartSchema);
