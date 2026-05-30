const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    userFirstname: {
        type: String,
        required: true,
    },
    userSurname: {
        type: String,
        required: true,
    },
    userEmail: {
        type: String,
        required: true,
        unique: true,
    },
    userPassword: {
        type: String,
        required: true,
    },
    isVerified: {
        type: Boolean,
        default: false,
    },
    date: {
        type: Date,
        default: Date.now,
    },
    isVendor: {
        type: Boolean,
        default: false,
    },
    vendorName: {
        type: String,
        default: '',
    }
});

module.exports = mongoose.model('User', userSchema);
