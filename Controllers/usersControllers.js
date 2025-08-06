const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const User = require ('../Models/User');


dotenv.config();


const login = async (req,res)=>{
    try {
        const user = await User.findOne({userEmail});

        if (!user) {

            return res.status(401).json({message: "Utilisateur non trouvé ! "})
        }
        const isMatch = await bcrypt.compare(userPassword, user.userPassword);
        if (!isMatch) {
            return res.status(401).json({ message: "Mot de passe incorrect" });
        }
        
        // Générer un token JWT
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.status(200).json({message: 'connexion réussie',token });
        console.log('Un utilisateur vient de se connecter ', userEmail)
        

    } catch (error) {
        res.status(500).json({ message: 'Erreur interne du serveur' });
        console.log('Erreur', error)
    }
}

const signup = async (req,res) =>{
    const {userFirstname, userSurname, userEmail, userPassword} = req.body;
    
    try {
      // Vérification si l'email existe déjà
      const existingUser = await User.findOne({ userEmail });
      if (existingUser) {
        return res.status(400).json(
            { message: "L'email est déjà utilisé ! " }
        );
      }
  
      // Hachage du mot de passe
      const hashedPassword = await bcrypt.hash(userPassword, 10);
  
      // Création de l'utilisateur
      const newUser = new User({userFirstname, userSurname, userEmail, userPassword: hashedPassword });
      await newUser.save();

    //Générer un token JWT
    const token = jwt.sign(
        {userId: newUser._id},
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    )
    res.status(201).json({ message: 'Vous avez créer un compte', token });


    } catch (error) {
      console.log('Erreur du serveur', error)
      res.status(500).json({ message: 'Erreur interne du serveur' });
    }
};


module.exports = { login, signup };































