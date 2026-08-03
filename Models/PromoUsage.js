const mongoose = require('mongoose');

const promoUsageSchema = new mongoose.Schema({
  promotionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Promotion',
    required: true,
  },
  code: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    default: null,
  },
  subtotal: {
    type: Number,
    default: 0,
  },
  discountAmount: {
    type: Number,
    default: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

promoUsageSchema.index({ promotionId: 1, userId: 1, code: 1, createdAt: -1 });
promoUsageSchema.index({ code: 1, userId: 1 });

module.exports = mongoose.model('PromoUsage', promoUsageSchema);
