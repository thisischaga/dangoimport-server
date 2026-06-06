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
    },
    balance: {
        type: Number,
        default: 0,
    },
    bankDetails: {
        accountHolder: {
            type: String,
            default: '',
        },
        accountNumber: {
            type: String,
            default: '',
        },
        bankName: {
            type: String,
            default: '',
        },
        iban: {
            type: String,
            default: '',
        }
    }
});

module.exports = mongoose.model('User', userSchema);
