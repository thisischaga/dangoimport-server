const jwt = require('jsonwebtoken');

const JWT_ALGORITHM = 'HS256';
const WEAK_SECRETS = new Set([
  'secret',
  'jwt_secret',
  'changeme',
  'your_jwt_secret',
  'dangoimport',
  'dango',
]);

function getJwtSecret() {
  return String(process.env.JWT_SECRET || '').trim();
}

function assertJwtSecretConfigured() {
  const secret = getJwtSecret();
  const isProd = process.env.NODE_ENV === 'production';

  if (!secret) {
    const message = 'JWT_SECRET manquant.';
    if (isProd) throw new Error(message);
    console.warn(`[jwtConfig] ${message}`);
    return;
  }

  if (secret.length < 32 || WEAK_SECRETS.has(secret.toLowerCase())) {
    const message = 'JWT_SECRET trop faible (minimum 32 caractères aléatoires en production).';
    if (isProd) throw new Error(message);
    console.warn(`[jwtConfig] ${message}`);
  }
}

function signAccessToken(payload, options = {}) {
  const secret = getJwtSecret();
  if (!secret) {
    throw new Error('JWT_SECRET non configuré.');
  }

  const role = payload?.role;
  const isAdminRole = ['admin', 'dev-admin', 'superadmin', 'manager'].includes(role);
  const defaultExpiry = isAdminRole
    ? (process.env.JWT_ADMIN_EXPIRES_IN || '30m')
    : (process.env.JWT_EXPIRES_IN || '12h');

  return jwt.sign(payload, secret, {
    expiresIn: options.expiresIn || defaultExpiry,
    algorithm: JWT_ALGORITHM,
  });
}

function verifyAccessToken(token) {
  const secret = getJwtSecret();
  if (!secret) {
    throw new Error('JWT_SECRET non configuré.');
  }
  return jwt.verify(token, secret, { algorithms: [JWT_ALGORITHM] });
}

module.exports = {
  JWT_ALGORITHM,
  assertJwtSecretConfigured,
  signAccessToken,
  verifyAccessToken,
};
