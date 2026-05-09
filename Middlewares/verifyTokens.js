const jwt = require('jsonwebtoken');
const Admin = require('../Models/Admin');

/**
 * Middleware verifyToken — vérifie que le JWT est valide
 */
const verifyToken = async (req, res, next) => {
  const authHeader = req.header('Authorization');
  if (!authHeader) {
    return res.status(401).json({ message: 'Aucun token fourni' });
  }

  const token = authHeader.split(' ')[1] || authHeader;
  if (!token) {
    return res.status(401).json({ message: 'Format de token invalide' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Session expirée, veuillez vous reconnecter.' });
    }
    return res.status(403).json({ message: 'Token invalide.' });
  }
};

/**
 * Middleware verifyAdmin — vérifie que le token appartient bien à un admin
 * et enrichit req.admin avec les données du compte
 */
const verifyAdmin = async (req, res, next) => {
  const authHeader = req.header('Authorization');
  if (!authHeader) {
    return res.status(401).json({ message: 'Accès refusé : authentification requise.' });
  }

  const token = authHeader.split(' ')[1] || authHeader;
  if (!token) {
    return res.status(401).json({ message: 'Format de token invalide.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Vérifier en BDD que l'admin existe toujours (pas supprimé)
    const admin = await Admin.findById(decoded.userId).select('-adminPassword');
    if (!admin) {
      return res.status(401).json({ message: 'Compte administrateur introuvable ou supprimé.' });
    }

    req.user = decoded;
    req.admin = admin;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Session expirée, veuillez vous reconnecter.' });
    }
    return res.status(403).json({ message: 'Token invalide.' });
  }
};

/**
 * Middleware verifyDevAdmin — réservé au rôle dev-admin uniquement
 */
const verifyDevAdmin = async (req, res, next) => {
  await verifyAdmin(req, res, () => {
    if (req.admin?.role !== 'dev-admin') {
      return res.status(403).json({ message: 'Action réservée au Dev Admin.' });
    }
    next();
  });
};

module.exports = verifyToken;
module.exports.verifyAdmin = verifyAdmin;
module.exports.verifyDevAdmin = verifyDevAdmin;