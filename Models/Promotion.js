const mongoose = require('mongoose');

const promotionSchema = new mongoose.Schema({
    code: {
        type: String,
        unique: true,
        required: true,
        uppercase: true,
        trim: true
    },

    description: String,

    discountType: {
        type: String,
        enum: ['percentage', 'fixed'],
        required: true
    },

    discountValue: {
        type: Number,
        required: true,
        min: 0
    },

    maxDiscount: Number,

    minOrderAmount: {
        type: Number,
        default: 0
    },

    applicableCategories: [String],

    applicableProducts: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product'
        }
    ],

    usageLimit: Number,

    usageCount: {
        type: Number,
        default: 0
    },

    startDate: Date,

    endDate: Date,

    isActive: {
        type: Boolean,
        default: true
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

module.exports = mongoose.model('Promotion', promotionSchema);
