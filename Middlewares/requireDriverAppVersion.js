const { compareVersions } = require('../utils/compareVersions');

function requireDriverAppVersion(req, res, next) {
  const appId = String(req.headers['x-app-id'] || req.query.app || '');
  const version = String(req.headers['x-app-version'] || req.query.version || '');

  if (appId && appId !== 'dango-driver') {
    return next();
  }

  const minVersion = process.env.DRIVER_APP_MIN_VERSION || '1.0.0';

  if (!version) {
    return res.status(426).json({
      success: false,
      code: 'APP_UPDATE_REQUIRED',
      message: 'Version de l’application requise. Mettez à jour l’application livreur.',
      minVersion,
    });
  }

  if (compareVersions(version, minVersion) < 0) {
    return res.status(426).json({
      success: false,
      code: 'APP_UPDATE_REQUIRED',
      message: 'Cette version de l’application n’est plus supportée. Installez la dernière version.',
      minVersion,
      latestVersion: process.env.DRIVER_APP_LATEST_VERSION || minVersion,
      storeUrl: process.env.DRIVER_APP_STORE_URL || '',
    });
  }

  return next();
}

module.exports = requireDriverAppVersion;
