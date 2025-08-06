const { required } = require('joi');
const mongoose = require('mongoose');


const userSchema = new mongoose.Schema({
    adminFirstname: {
      type: String,
      required: true,
  },
    adminSurname: {
      type: String,
      required: true,
  },
    adminName: {
      type: String,
      required: true,
      unique: true,
    },
    adminPassword: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      required: true
    }
});
  
module.exports = mongoose.model('Admin', userSchema);
