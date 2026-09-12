const crypto = require('crypto');

const generateOTP = () => crypto.randomInt(100000, 999999).toString();

module.exports = { generateOTP };
