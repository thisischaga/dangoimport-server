const mongoose = require('mongoose');

const withdrawalRequestSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    vendorEmail: {
        type: String,
        required: true,
    },
    amount: {
        type: Number,
        required: true,
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'completed'],
        default: 'pending'
    },
    bankDetails: {
        accountHolder: {
            type: String,
            required: true,
        },
        accountNumber: {
            type: String,
            required: true,
        },
        bankName: {
            type: String,
            required: true,
        },
        iban: {
            type: String,
            default: '',
        }
    },
    rejectionReason: {
        type: String,
        default: '',
    },
    transactionReference: {
        type: String,
        default: '',
    },
    date: {
        type: Date,
        default: Date.now,
    },
    processedAt: {
        type: Date,
        default: null,
    }
});

module.exports = mongoose.model('WithdrawalRequest', withdrawalRequestSchema);
