const rateLimit = require('express-rate-limit');
const { alertRateLimit } = require('../utils/securityAlerts');

const rateLimitHandler = (limiterName) => (req, res) => {
  alertRateLimit(req, limiterName).catch(() => {});
  res.status(429).json({ message: 'Trop de requêtes, réessayez plus tard.' });
};

const authLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler('auth-login'),
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler('otp'),
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler('upload'),
});

module.exports = {
  authLoginLimiter,
  otpLimiter,
  uploadLimiter,
};
