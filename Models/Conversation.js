const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  buyerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  sellerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    default: null,
    index: true,
  },
  lastMessage: {
    type: String,
    default: '',
  },
  unreadCountBuyer: {
    type: Number,
    default: 0,
  },
  unreadCountSeller: {
    type: Number,
    default: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

conversationSchema.index({ buyerId: 1, sellerId: 1, productId: 1 });

module.exports = mongoose.model('Conversation', conversationSchema);
