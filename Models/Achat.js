const { required } = require('joi');
const mongoose = require('mongoose');


const userSchema = new mongoose.Schema({
    userName: {
      type: String,
      required: true,
  },
    userNumber: {
      type: Number,
      required: true,
    },
    productQuantity: {
      type: Number,
      require:true,
    },
    picture: {
      type: String,
      require:true,
    },
    userPref: {
      type: String,
      require:true,
    },
    selectedCountry: {
      type: String,
      required: true,
    },
    userEmail: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      required: true,
    },
    lat: {
      type: Number,
      required: false,
    },
    lng: {
      type: Number,
      required: false,
    },
    deliveryFee: {
      type: Number,
      required: false,
    },
    paymentMethod: {
      type: String,
      required: false,
    },
    address: {
      type: String,
      required: false,
    },
    city: {
      type: String,
      required: false,
    },
    totalPrice: {
      type: Number,
      required: false,
    },
    productPrice: {
      type: Number,
      required: false,
    },
    date: {
      type: String,
      required: true,
    },
    vendorName: {
      type: String,
      required: false,
    }
});

userSchema.index({ userEmail: 1, date: -1 });
userSchema.index({ vendorName: 1, date: -1 });
userSchema.index({ status: 1 });

module.exports = mongoose.model('Achat', userSchema);