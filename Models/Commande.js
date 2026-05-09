const { required } = require('joi');
const mongoose = require('mongoose');


const userSchema = new mongoose.Schema({
    userName: {
      type: String,
      required: true,
  },
    userEmail: {
      type: String,
      required: true,
    },
    categorie: {
      type: String,
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
    productDescription: {
      type: String,
      require:true,
    },
    selectedCountry: {
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
    }
});
  
module.exports = mongoose.model('Commande', userSchema);