const Admin = require('../Models/Admin');
const User = require('../Models/User');
const Driver = require('../Models/Driver');
const { verifyAccessToken } = require('../utils/jwtConfig');
const { alertIntrusion } = require('../utils/securityAlerts');

const denyAdmin = (req, res, status, body, reason) => {
  alertIntrusion(req, reason, { status }).catch(() => {});
  return res.status(status).json(body);
};

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
    const decoded = verifyAccessToken(token);
    const userId = decoded.userId || decoded.id;

    if (['admin', 'dev-admin', 'superadmin', 'manager'].includes(decoded.role)) {
      const admin = await Admin.findById(userId).select('-adminPassword');
      if (admin) {
        req.user = {
          ...decoded,
          id: admin._id,
          userId: admin._id,
          userFirstname: admin.adminFirstname || '',
          userSurname: admin.adminSurname || '',
          userEmail: admin.adminName || '',
          userPhone: admin.adminPhone || '',
          role: admin.role || decoded.role,
        };
        req.admin = admin;
        return next();
      }
    }

    const user = await User.findById(userId).select('userFirstname userSurname userEmail userPhone role');
    if (user) {
      const driverProfile = await Driver.findOne({ userId: user._id }).lean();
      const effectiveRole = user.role === 'driver' || driverProfile ? 'driver' : (user.role || decoded.role || 'user');
      req.user = {
        ...decoded,
        id: user._id,
        userId: user._id,
        userFirstname: user.userFirstname || '',
        userSurname: user.userSurname || '',
        userEmail: user.userEmail || '',
        userPhone: user.userPhone || '',
        role: effectiveRole,
      };
      return next();
    }

    return res.status(401).json({ message: 'Utilisateur introuvable.' });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        code: 'TOKEN_EXPIRED',
        message: 'Session expirée, veuillez vous reconnecter.',
      });
    }
    return res.status(403).json({ message: 'Token invalide.' });
  }
};

/**
 * Middleware verifyAdmin — vérifie que le token appartient bien à un admin
 */
const verifyAdmin = async (req, res, next) => {
  const authHeader = req.header('Authorization');
  if (!authHeader) {
    return denyAdmin(req, res, 401, { message: 'Accès refusé : authentification requise.' }, 'Token admin absent');
  }

  const token = authHeader.split(' ')[1] || authHeader;
  if (!token) {
    return denyAdmin(req, res, 401, { message: 'Format de token invalide.' }, 'Format token admin invalide');
  }

  try {
    const decoded = verifyAccessToken(token);
    const admin = await Admin.findById(decoded.userId).select('-adminPassword');
    if (!admin) {
      return denyAdmin(req, res, 401, { message: 'Compte administrateur introuvable ou supprimé.' }, 'Compte admin introuvable');
    }

    req.user = decoded;
    req.admin = admin;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return denyAdmin(req, res, 401, {
        code: 'TOKEN_EXPIRED',
        message: 'Session expirée, veuillez vous reconnecter.',
      }, 'Session admin expirée');
    }
    return denyAdmin(req, res, 403, { message: 'Token invalide.' }, 'Token admin invalide');
  }
};

/**
 * Middleware verifyDevAdmin — réservé au rôle dev-admin uniquement
 */
const verifyDevAdmin = async (req, res, next) => {
  await verifyAdmin(req, res, () => {
    if (req.admin?.role !== 'dev-admin') {
      return denyAdmin(req, res, 403, { message: 'Action réservée au Dev Admin.' }, 'Accès dev-admin refusé');
    }
    next();
  });
};

module.exports = verifyToken;
module.exports.verifyAdmin = verifyAdmin;
module.exports.verifyDevAdmin = verifyDevAdmin;
