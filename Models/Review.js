const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
    productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true,
        index: true
    },

    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    userName: String,

    rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5
    },

    title: {
        type: String,
        required: true
    },

    comment: {
        type: String,
        required: true
    },

    images: [String],

    verified: {
        type: Boolean,
        default: false
    },

    helpful: {
        type: Number,
        default: 0
    },

    notHelpful: {
        type: Number,
        default: 0
    },

    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    },

    updatedAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Review', reviewSchema);
