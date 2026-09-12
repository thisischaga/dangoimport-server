const Admin = require('../Models/Admin');

const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ALLOWED_REDIRECT_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174',
  'https://dangoimport.com',
  'https://www.dangoimport.com',
  'https://business.dangoimport.com',
  'https://dangoimport-admin-eiim.vercel.app',
];

const isAllowedRedirectUrl = (url = '') => {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return ALLOWED_REDIRECT_ORIGINS.some((origin) => {
      const allowed = new URL(origin);
      return parsed.protocol === allowed.protocol && parsed.host === allowed.host;
    }) || parsed.hostname.endsWith('.dangoimport.com');
  } catch {
    return false;
  }
};

const sanitizeRedirectUrl = (url, fallback) => {
  if (isAllowedRedirectUrl(url)) return url.replace(/\/$/, '');
  return (fallback || process.env.FRONTEND_URL || 'https://dangoimport.com').replace(/\/$/, '');
};

const isAdminUser = (req) => {
  if (req.admin) return true;
  return ['admin', 'dev-admin', 'superadmin', 'manager'].includes(req.user?.role);
};

const requireOwnerEmail = (paramName = 'email') => (req, res, next) => {
  const target = String(req.params[paramName] || '').trim().toLowerCase();
  const userEmail = String(req.user?.userEmail || '').trim().toLowerCase();
  if (isAdminUser(req)) return next();
  if (target && userEmail && target === userEmail) return next();
  return res.status(403).json({ message: 'Accès refusé.' });
};

const requireAdminFromDb = async (req, res, next) => {
  if (req.admin) return next();
  const admin = await Admin.findById(req.user?.userId || req.user?.id);
  if (admin && ['admin', 'dev-admin', 'superadmin', 'manager'].includes(admin.role)) {
    req.admin = admin;
    return next();
  }
  return res.status(403).json({ message: 'Accès refusé.' });
};

const timingSafeEqual = (a, b) => {
  const crypto = require('crypto');
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

module.exports = {
  escapeRegExp,
  isAllowedRedirectUrl,
  sanitizeRedirectUrl,
  isAdminUser,
  requireOwnerEmail,
  requireAdminFromDb,
  timingSafeEqual,
};
