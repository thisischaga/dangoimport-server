const mongoose = require('mongoose');

const vendorRequestSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    businessName: {
        type: String,
        required: true,
    },
    phone: {
        type: String,
        required: true,
    },
    email: {
        type: String,
        required: true,
    },
    city: {
        type: String,
        required: true,
    },
    description: {
        type: String,
        required: true,
    },
    rccmImage: {
        type: String, // Sera du base64 ou URL d'image
        required: true,
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    date: {
        type: Date,
        default: Date.now,
    }
});

module.exports = mongoose.model('VendorRequest', vendorRequestSchema);
