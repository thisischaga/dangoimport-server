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
    }
});

module.exports = mongoose.model('User', userSchema);
