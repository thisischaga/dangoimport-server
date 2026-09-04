const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({

    // Informations de base
    userFirstname: {
        type: String,
        required: true,
        trim: true
    },

    userSurname: {
        type: String,
        required: true,
        trim: true
    },

    userEmail: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        index: true
    },

    // Le mot de passe devient optionnel pour Google OAuth
    userPassword: {
        type: String,
        required: function () {
            return !this.googleId;
        }
    },

    // =========================
    // GOOGLE OAUTH
    // =========================

    googleId: {
        type: String,
        unique: true,
        sparse: true,
        index: true
    },

    authProviders: {
        type: [String],
        default: ['local']
    },

    userPhone: {
        type: String,
        trim: true
    },

    // Profil
    profileImage: String,

    bio: String,

    // Adresses
    addresses: [
        {
            label: {
                type: String,
                enum: ['home', 'work', 'other'],
                default: 'home'
            },

            country: String,
            city: String,
            neighborhood: String,
            fullAddress: String,
            postalCode: String,

            isDefault: {
                type: Boolean,
                default: false
            }
        }
    ],

    // Vérification
    isVerified: {
        type: Boolean,
        default: false
    },

    emailVerificationToken: String,
    phoneVerificationToken: String,

    // Rôle et vendeur
    role: {
        type: String,
        enum: ['customer', 'vendor', 'admin', 'driver'],
        default: 'customer',
        index: true
    },

    // Driver runtime state (if role === 'driver')
    driverStatus: {
        type: String,
        enum: ['available', 'unavailable', 'on_delivery'],
        default: 'unavailable',
        index: true
    },

    currentLocation: {
        latitude: Number,
        longitude: Number,
        accuracy: Number,
        heading: Number,
        speed: Number,
        updatedAt: Date,
    },

    isVendor: {
        type: Boolean,
        default: false
    },

    isCertified: {
        type: Boolean,
        default: false
    },

    vendorName: {
        type: String,
        default: ''
    },

    vendorDescription: String,
    vendorLogo: String,

    vendorRating: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
    },

    // Compte bancaire
    balance: {
        type: Number,
        default: 0
    },

    bankDetails: {
        accountHolder: {
            type: String,
            default: ''
        },

        accountNumber: {
            type: String,
            default: ''
        },

        bankName: {
            type: String,
            default: ''
        },

        iban: {
            type: String,
            default: ''
        }
    },

    // Préférences
    preferences: {
        newsletter: {
            type: Boolean,
            default: true
        },

        notifications: {
            type: Boolean,
            default: true
        },

        currency: {
            type: String,
            default: 'XOF'
        },

        language: {
            type: String,
            default: 'fr'
        }
    },

    // Statistiques
    totalOrders: {
        type: Number,
        default: 0
    },

    totalSpent: {
        type: Number,
        default: 0
    },

    lastOrderDate: Date,

    // Dates
    date: {
        type: Date,
        default: Date.now,
        index: true
    },

    updatedAt: {
        type: Date,
        default: Date.now
    }

});

module.exports = mongoose.model('User', userSchema);