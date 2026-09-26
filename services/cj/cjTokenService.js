const { cjConfig } = require('../../config/cj');

/** @type {{ accessToken?: string, refreshToken?: string, accessExpiry?: number | null, refreshExpiry?: number | null } | null} */
let session = null;

function parseExpiry(value) {
  if (!value) return null;
  const ts = Date.parse(String(value));
  return Number.isFinite(ts) ? ts : null;
}

function isSessionAccessValid() {
  if (!session?.accessToken) return false;
  if (!session.accessExpiry) return true;
  return Date.now() < session.accessExpiry - 60_000;
}

function invalidateSession() {
  session = null;
}

function applySession(payload = {}) {
  session = {
    accessToken: payload.accessToken || payload.access_token || '',
    refreshToken: payload.refreshToken || payload.refresh_token || session?.refreshToken || cjConfig.refreshToken || '',
    accessExpiry: parseExpiry(payload.accessTokenExpiryDate || payload.access_token_expiry_date),
    refreshExpiry: parseExpiry(payload.refreshTokenExpiryDate || payload.refresh_token_expiry_date),
  };
  return session.accessToken;
}

async function postAuthentication(path, body) {
  const url = `${cjConfig.apiBaseUrl}/api2.0/v1/authentication/${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cjConfig.requestTimeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      const err = new Error('Réponse CJ auth invalide.');
      err.status = 502;
      throw err;
    }

    if (!response.ok || data?.result === false || (data?.code && Number(data.code) !== 200)) {
      const err = new Error(data?.message || `Échec auth CJ (HTTP ${response.status}).`);
      err.status = 502;
      err.code = 'CJ_AUTH';
      err.cj = data;
      throw err;
    }

    return data?.data || data;
  } finally {
    clearTimeout(timeout);
  }
}

async function exchangeApiKey(apiKey) {
  const payload = await postAuthentication('getAccessToken', { apiKey });
  const token = applySession(payload);
  if (!token) {
    const err = new Error('CJ n’a pas renvoyé d’access token. Vérifiez la clé API.');
    err.status = 502;
    err.code = 'CJ_AUTH';
    throw err;
  }
  return token;
}

async function refreshAccessToken() {
  const refreshToken = session?.refreshToken || cjConfig.refreshToken;
  if (!refreshToken) {
    const err = new Error('Refresh token CJ manquant.');
    err.status = 502;
    err.code = 'CJ_AUTH';
    throw err;
  }
  const payload = await postAuthentication('refreshAccessToken', { refreshToken });
  const token = applySession(payload);
  if (!token) {
    const err = new Error('Échec du refresh token CJ.');
    err.status = 502;
    err.code = 'CJ_AUTH';
    throw err;
  }
  return token;
}

async function getValidAccessToken() {
  if (cjConfig.accessToken) {
    return cjConfig.accessToken;
  }

  if (isSessionAccessValid()) {
    return session.accessToken;
  }

  if (session?.refreshToken || cjConfig.refreshToken) {
    try {
      return await refreshAccessToken();
    } catch {
      invalidateSession();
    }
  }

  if (cjConfig.apiKey) {
    return exchangeApiKey(cjConfig.apiKey);
  }

  const err = new Error('Configuration CJ incomplète : définir CJ_API_KEY ou CJ_ACCESS_TOKEN.');
  err.status = 503;
  throw err;
}

function getTokenDiagnostics() {
  return {
    authMode: cjConfig.accessToken
      ? 'access_token'
      : (cjConfig.apiKey ? 'api_key' : (cjConfig.refreshToken ? 'refresh_token' : 'none')),
    hasApiKey: Boolean(cjConfig.apiKey),
    hasStaticAccessToken: Boolean(cjConfig.accessToken),
    hasRefreshToken: Boolean(cjConfig.refreshToken || session?.refreshToken),
    sessionActive: isSessionAccessValid(),
  };
}

module.exports = {
  getValidAccessToken,
  invalidateSession,
  getTokenDiagnostics,
  exchangeApiKey,
};
