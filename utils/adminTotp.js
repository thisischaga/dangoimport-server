const { generateSecret, generateURI, verifySync } = require('otplib');
const QRCode = require('qrcode');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

function normalizeTotpCode(code) {
  return String(code || '').replace(/\s/g, '');
}

function verifyTotpCode(secret, code) {
  if (!secret || !code) return false;
  const result = verifySync({
    secret,
    token: normalizeTotpCode(code),
    epochTolerance: 1,
  });
  return Boolean(result?.valid);
}

async function buildQrDataUrl(adminName, secret) {
  const label = String(adminName || 'admin').toLowerCase();
  const otpauth = generateURI({
    issuer: 'Dango Import Admin',
    label,
    secret,
  });
  return QRCode.toDataURL(otpauth);
}

async function generateBackupCodes(count = 8) {
  const codes = [];
  const hashes = [];

  for (let i = 0; i < count; i += 1) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(code);
    hashes.push(await bcrypt.hash(code, 10));
  }

  return { codes, hashes };
}

async function verifyBackupCode(code, hashedCodes = []) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return -1;

  for (let i = 0; i < hashedCodes.length; i += 1) {
    if (await bcrypt.compare(normalized, hashedCodes[i])) {
      return i;
    }
  }

  return -1;
}

module.exports = {
  generateSecret,
  verifyTotpCode,
  buildQrDataUrl,
  generateBackupCodes,
  verifyBackupCode,
};
