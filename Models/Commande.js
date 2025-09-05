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
    selectedCountry: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      required: true,
    },
    date: {
      type: String,
      required: true,
    }
});
  
module.exports = mongoose.model('Commande', userSchema);