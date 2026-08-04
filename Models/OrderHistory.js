const mongoose = require('mongoose');

const historySchema = new mongoose.Schema({
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ShopOrder',
    required: true,
    index: true,
  },
  event: {
    type: String,
    required: true,
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  createdBy: {
    type: String,
    default: 'system',
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

module.exports = mongoose.model('OrderHistory', historySchema);
