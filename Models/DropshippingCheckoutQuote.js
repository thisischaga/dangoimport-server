const mongoose = require('mongoose');

const checkoutQuoteSchema = new mongoose.Schema({
  quoteId: { type: String, required: true, unique: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  cartSignature: { type: String, required: true },
  destinationSignature: { type: String, required: true },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { minimize: false });

module.exports = mongoose.model('DropshippingCheckoutQuote', checkoutQuoteSchema);
