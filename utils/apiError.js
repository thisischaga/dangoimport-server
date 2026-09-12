const isProduction = () => process.env.NODE_ENV === 'production';

function sanitizeErrorMessage(error, fallback = 'Erreur serveur') {
  console.error('[apiError]', error?.stack || error?.message || error);
  if (!isProduction()) {
    return error?.message || fallback;
  }
  return fallback;
}

function sendServerError(res, error, fallback = 'Erreur serveur') {
  return res.status(500).json({ message: sanitizeErrorMessage(error, fallback) });
}

function createGlobalErrorHandler() {
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);
    console.error('[globalErrorHandler]', err?.stack || err?.message || err);
    res.status(err.status || 500).json({
      message: isProduction() ? 'Erreur serveur' : (err.message || 'Erreur serveur'),
    });
  };
}

module.exports = {
  sanitizeErrorMessage,
  sendServerError,
  createGlobalErrorHandler,
};
