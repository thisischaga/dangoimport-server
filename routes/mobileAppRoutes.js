const express = require('express');
const { compareVersions } = require('../utils/compareVersions');

const router = express.Router();

function getDriverAppConfig() {
  return {
    minVersion: process.env.DRIVER_APP_MIN_VERSION || '1.0.0',
    latestVersion: process.env.DRIVER_APP_LATEST_VERSION || process.env.DRIVER_APP_MIN_VERSION || '1.0.0',
    forceUpdate: String(process.env.DRIVER_APP_FORCE_UPDATE || '').toLowerCase() === 'true',
    storeUrl: process.env.DRIVER_APP_STORE_URL || '',
    supportEmail: process.env.DRIVER_APP_SUPPORT_EMAIL || 'contact@dangoimport.com',
    supportPhone: process.env.DRIVER_APP_SUPPORT_PHONE || '+2290158266342',
  };
}

router.get('/version-check', (req, res) => {
  try {
    const app = String(req.query.app || 'dango-driver');
    const platform = String(req.query.platform || 'android');
    const version = String(req.query.version || '0.0.0');
    const config = getDriverAppConfig();

    if (app !== 'dango-driver') {
      return res.status(400).json({
        success: false,
        message: 'Application non reconnue.',
      });
    }

    const supported = compareVersions(version, config.minVersion) >= 0;
    const updateAvailable = compareVersions(version, config.latestVersion) < 0;
    const mustUpdate = !supported || (config.forceUpdate && updateAvailable);

    return res.json({
      success: true,
      supported,
      updateAvailable,
      forceUpdate: mustUpdate,
      minVersion: config.minVersion,
      latestVersion: config.latestVersion,
      currentVersion: version,
      platform,
      storeUrl: config.storeUrl,
      supportEmail: config.supportEmail,
      supportPhone: config.supportPhone,
      message: mustUpdate
        ? 'Une nouvelle version de l’application livreur est requise.'
        : 'Version compatible.',
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/support', (req, res) => {
  const config = getDriverAppConfig();
  return res.json({
    success: true,
    data: {
      supportEmail: config.supportEmail,
      supportPhone: config.supportPhone,
      helpTopics: [
        'Scannez le QR code du colis pour valider chaque étape.',
        'Acceptez une livraison avant de vous rendre chez le vendeur.',
        'Utilisez les adresses cliquables pour ouvrir Google Maps.',
        'En cas de problème de connexion, déconnectez-vous puis reconnectez-vous.',
      ],
      policySummary:
        'L’application livreur Dango Import est réservée aux livreurs autorisés. Vos données de localisation et d’activité sont utilisées uniquement pour le suivi des livraisons.',
    },
  });
});

module.exports = router;
