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
  image: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['active', 'draft'],
    default: 'active'
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
