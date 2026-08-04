const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  productName: String,
  productImage: String,
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  vendorName: String,
  price: Number,
  originalPrice: Number,
  salePrice: Number,
  category: String,
  quantity: {
    type: Number,
    required: true,
    min: 1,
  },
  selectedOptions: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  subtotal: Number,
  delivered: {
    type: Boolean,
    default: false,
  },
  deliveredAt: Date,
});

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    unique: true,
    required: true,
    index: true,
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  customerName: String,
  customerEmail: String,
  customerPhone: String,
  shippingAddress: {
    country: String,
    city: String,
    neighborhood: String,
    fullAddress: String,
    postalCode: String,
    instructions: String,
  },
  items: [orderItemSchema],
  subtotal: {
    type: Number,
    required: true,
  },
  shippingCost: {
    type: Number,
    default: 0,
  },
  tax: {
    type: Number,
    default: 0,
  },
  discount: {
    type: Number,
    default: 0,
  },
  total: {
    type: Number,
    required: true,
  },
  shippingMethod: {
    type: String,
    enum: ['standard', 'express', 'pickup'],
    default: 'standard',
  },
  estimatedDelivery: Date,
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'],
    default: 'pending',
    index: true,
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending',
    index: true,
  },
  paymentMethod: {
    type: String,
    enum: ['FedaPay'],
    default: 'FedaPay',
  },
  paymentDate: Date,
  trackingNumber: String,
  carrier: String,
  notes: String,
  adminNotes: String,
  history: [
    {
      type: String,
      required: true,
    }
  ],
  qrCodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QRCode',
    default: null,
    index: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

orderSchema.index({ customerId: 1, createdAt: -1 });
orderSchema.index({ status: 1, paymentStatus: 1, createdAt: -1 });
orderSchema.index({ orderNumber: 1 });

orderSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('ShopOrder', orderSchema);
