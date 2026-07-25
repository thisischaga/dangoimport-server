const mongoose = require('mongoose');

const quartierSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  price: { type: Number, required: true, min: 0 }
});

const deliveryZoneSchema = new mongoose.Schema({
  country: { type: String, required: true, enum: ['Togo', 'Benin', 'Bénin'] },
  region: { type: String, required: true, trim: true },
  quartiers: [quartierSchema]
});

const vendorProductSchema = new mongoose.Schema({
  storeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  stock: {
    type: Number,
    required: true,
    min: 0
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  isBoosted: {
    type: Boolean,
    default: false
  },
  promoPrice: {
    type: Number,
    min: 0,
    default: null
  },
  promoStart: {
    type: Date,
    default: null
  },
  promoEnd: {
    type: Date,
    default: null
  },
  stockQuantity: {
    type: Number,
    min: 0,
    default: 0
  },
  status: {
    type: String,
    enum: ['draft', 'active', 'out_of_stock'],
    default: 'draft'
  },
  image: {
    type: String,
    default: ''
  },
  deliveryZones: [deliveryZoneSchema],
  characteristics: [
    {
      name: { type: String, required: true, trim: true },
      values: [{ type: String, trim: true }]
    }
  ],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('VendorProduct', vendorProductSchema);
