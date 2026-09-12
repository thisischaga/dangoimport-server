const express = require('express');
const bcrypt = require('bcryptjs');
const Admin = require('../Models/Admin');
const { verifyAdmin } = require('../Middlewares/verifyTokens');
const { otpLimiter } = require('../Middlewares/rateLimiters');
const {
  signAccessToken,
  signAdmin2FAPendingToken,
  verifyAdmin2FAPendingToken,
} = require('../utils/jwtConfig');
const {
  generateSecret,
  verifyTotpCode,
  buildQrDataUrl,
  generateBackupCodes,
  verifyBackupCode,
} = require('../utils/adminTotp');
const { alertAdminActivity, alertIntrusion } = require('../utils/securityAlerts');

const loginRouter = express.Router();
const adminRouter = express.Router();

function buildAdminUserPayload(admin) {
  return {
    id: admin._id,
    firstname: admin.adminFirstname,
    surname: admin.adminSurname,
    email: admin.adminName,
    role: admin.role,
    totpEnabled: Boolean(admin.totpEnabled),
  };
}

function issueAdminSession(admin) {
  return signAccessToken({ userId: admin._id, role: admin.role });
}

async function consumeBackupCode(admin, code) {
  const index = await verifyBackupCode(code, admin.totpBackupCodes || []);
  if (index < 0) return false;
  admin.totpBackupCodes.splice(index, 1);
  await admin.save();
  return true;
}

loginRouter.post('/verify', otpLimiter, async (req, res) => {
  const { pendingToken, code } = req.body || {};

  if (!pendingToken || !code) {
    return res.status(400).json({ message: 'Code 2FA et jeton temporaire requis.' });
  }

  try {
    const decoded = verifyAdmin2FAPendingToken(pendingToken);
    const admin = await Admin.findById(decoded.userId).select('+totpSecret +totpBackupCodes');

    if (!admin || !admin.totpEnabled || !admin.totpSecret) {
      return res.status(401).json({ message: 'Authentification 2FA invalide.' });
    }

    const normalizedCode = String(code).trim();
    const totpValid = verifyTotpCode(admin.totpSecret, normalizedCode);
    const backupValid = !totpValid
      ? await consumeBackupCode(admin, normalizedCode)
      : false;

    if (!totpValid && !backupValid) {
      await alertIntrusion(req, 'Échec vérification 2FA admin', {
        adminId: admin._id,
        adminName: admin.adminName,
      });
      return res.status(401).json({ message: 'Code 2FA incorrect.' });
    }

    const token = issueAdminSession(admin);

    res.status(200).json({
      message: 'Connexion réussie',
      token,
      user: buildAdminUserPayload(admin),
      usedBackupCode: backupValid,
    });

    req.admin = admin;
    alertAdminActivity(req, 'Connexion administrateur 2FA validée', {
      targetResource: 'admin',
      targetId: admin._id,
      summary: admin.adminName,
    }).catch(() => {});
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        code: 'TWO_FA_EXPIRED',
        message: 'Délai 2FA expiré. Reconnectez-vous.',
      });
    }
    return res.status(401).json({ message: 'Session 2FA invalide.' });
  }
});

adminRouter.get('/status', verifyAdmin, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin._id).select('totpEnabled totpBackupCodes');
    if (!admin) {
      return res.status(404).json({ message: 'Administrateur introuvable.' });
    }

    return res.json({
      enabled: Boolean(admin.totpEnabled),
      backupCodesRemaining: admin.totpBackupCodes?.length || 0,
    });
  } catch (error) {
    console.error('[admin2faRoutes] status:', error);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
});

adminRouter.post('/setup', verifyAdmin, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin._id).select('+totpSecret +totpPendingSecret +totpBackupCodes');
    if (!admin) {
      return res.status(404).json({ message: 'Administrateur introuvable.' });
    }

    if (admin.totpEnabled) {
      return res.status(400).json({ message: 'La 2FA est déjà activée.' });
    }

    const secret = generateSecret();
    admin.totpPendingSecret = secret;
    await admin.save();

    const qrDataUrl = await buildQrDataUrl(admin.adminName, secret);

    return res.json({
      qrDataUrl,
      manualKey: secret,
      message: 'Scannez le QR code avec Google Authenticator, Authy ou une app TOTP compatible.',
    });
  } catch (error) {
    console.error('[admin2faRoutes] setup:', error);
    return res.status(500).json({ message: 'Impossible de préparer la 2FA.' });
  }
});

adminRouter.post('/enable', verifyAdmin, otpLimiter, async (req, res) => {
  const { code } = req.body || {};
  if (!code) {
    return res.status(400).json({ message: 'Code 2FA requis.' });
  }

  try {
    const admin = await Admin.findById(req.admin._id).select('+totpSecret +totpPendingSecret +totpBackupCodes');
    if (!admin) {
      return res.status(404).json({ message: 'Administrateur introuvable.' });
    }

    if (admin.totpEnabled) {
      return res.status(400).json({ message: 'La 2FA est déjà activée.' });
    }

    if (!admin.totpPendingSecret) {
      return res.status(400).json({ message: 'Lancez d’abord la configuration 2FA.' });
    }

    if (!verifyTotpCode(admin.totpPendingSecret, code)) {
      return res.status(400).json({ message: 'Code 2FA incorrect.' });
    }

    const { codes, hashes } = await generateBackupCodes();
    admin.totpSecret = admin.totpPendingSecret;
    admin.totpPendingSecret = undefined;
    admin.totpEnabled = true;
    admin.totpBackupCodes = hashes;
    await admin.save();

    alertAdminActivity(req, 'Activation 2FA admin', {
      targetResource: 'admin',
      targetId: admin._id,
      summary: admin.adminName,
    }).catch(() => {});

    return res.json({
      message: 'Authentification à deux facteurs activée.',
      backupCodes: codes,
    });
  } catch (error) {
    console.error('[admin2faRoutes] enable:', error);
    return res.status(500).json({ message: 'Impossible d’activer la 2FA.' });
  }
});

adminRouter.post('/disable', verifyAdmin, otpLimiter, async (req, res) => {
  const { password, code } = req.body || {};
  if (!password || !code) {
    return res.status(400).json({ message: 'Mot de passe et code 2FA requis.' });
  }

  try {
    const admin = await Admin.findById(req.admin._id).select('+adminPassword +totpSecret +totpBackupCodes +totpPendingSecret');
    if (!admin) {
      return res.status(404).json({ message: 'Administrateur introuvable.' });
    }

    if (!admin.totpEnabled) {
      return res.status(400).json({ message: 'La 2FA n’est pas activée.' });
    }

    const passwordOk = await bcrypt.compare(password, admin.adminPassword);
    if (!passwordOk) {
      await alertIntrusion(req, 'Tentative désactivation 2FA — mot de passe incorrect', {
        adminId: admin._id,
      });
      return res.status(401).json({ message: 'Mot de passe incorrect.' });
    }

    const totpValid = verifyTotpCode(admin.totpSecret, code);
    const backupValid = !totpValid ? await consumeBackupCode(admin, code) : false;

    if (!totpValid && !backupValid) {
      await alertIntrusion(req, 'Tentative désactivation 2FA — code incorrect', {
        adminId: admin._id,
      });
      return res.status(401).json({ message: 'Code 2FA incorrect.' });
    }

    admin.totpEnabled = false;
    admin.totpSecret = undefined;
    admin.totpPendingSecret = undefined;
    admin.totpBackupCodes = [];
    await admin.save();

    alertAdminActivity(req, 'Désactivation 2FA admin', {
      targetResource: 'admin',
      targetId: admin._id,
      summary: admin.adminName,
    }).catch(() => {});

    return res.json({ message: 'Authentification à deux facteurs désactivée.' });
  } catch (error) {
    console.error('[admin2faRoutes] disable:', error);
    return res.status(500).json({ message: 'Impossible de désactiver la 2FA.' });
  }
});

module.exports = {
  loginRouter,
  adminRouter,
};
