const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGO_URI;
    await mongoose.connect(mongoURI); 
    console.log("✅ Connexion à MongoDB réussie !");
  } catch (err) {
    console.error("❌ Erreur de connexion à MongoDB :", err);
    throw err; 
  }
};

module.exports = connectDB;
