const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();


const connectDB = ()=>{

    const mongoURI = process.env.MONGO_URI;
    mongoose.connect(mongoURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log("✅ Connexion à MongoDB réussie !"))
.catch(err => console.error("❌Erreur de connexion à MongoDB :", err));
}

module.exports = connectDB;