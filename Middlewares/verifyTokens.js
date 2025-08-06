const jwt = require ('jsonwebtoken');


const verifyToken = async (req, res, next)=>{

    const authHeader = req.header('Authorization');
    if(!authHeader){
        return res.status(401).json({message: 'Aucun token fourni'});
    }
    const token = authHeader.split('Bearer')[1]
    if (!token) {
        return res.status(404).json({message: 'Veillez vous identifiez pour poussuvre l\'action'})
        //return res.status(401).json({message: 'Format du token invalide'});
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();

    } catch (error) {
        if (error.name === 'TokenExpiredError'){
            return res.status(401).json({message: 'Token expiré'})
        }
        return res.status(403).json({message: 'Token invalide'})
    }
};

module.exports = verifyToken;