const crypto = require('crypto');
const AlibabaToken = require('../../Models/AlibabaToken');
const { alibabaConfig } = require('../../config/alibaba');

const pendingStates = new Map();

function getRedirectUri() {
  return String(alibabaConfig.redirectUri || '').trim();
}

function getAuthorizeUrl(state) {
  const redirect = encodeURIComponent(getRedirectUri());
  return `https://auth.1688.com/oauth/authorize?client_id=${encodeURIComponent(alibabaConfig.appKey)}&site=1688&redirect_uri=${redirect}&state=${encodeURIComponent(state)}`;
}

function createOauthState() {
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, Date.now() + 10 * 60 * 1000);
  return state;
}

function consumeOauthState(state) {
  const expires = pendingStates.get(String(state || ''));
  pendingStates.delete(String(state || ''));
  return Boolean(expires && expires > Date.now());
}

async function loadStoredToken() {
  return AlibabaToken.findOne({ key: 'default' }).lean();
}

async function saveToken(payload = {}) {
  const expiresIn = Number(payload.expires_in || payload.expiresIn || 0);
  const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;
  const doc = await AlibabaToken.findOneAndUpdate(
    { key: 'default' },
    {
      accessToken: payload.access_token || payload.accessToken || '',
      refreshToken: payload.refresh_token || payload.refreshToken || '',
      expiresAt,
      aliId: String(payload.aliId || payload.ali_id || ''),
      resourceOwner: String(payload.resource_owner || payload.resourceOwner || ''),
      updatedAt: new Date(),
    },
    { upsert: true, new: true },
  );
  return doc.toObject();
}

async function exchangeAuthorizationCode(code) {
  const redirectUri = getRedirectUri();
  if (!redirectUri) {
    const err = new Error('ALIBABA_REDIRECT_URI manquant. Ajoutez l’URL de callback dans le .env et dans la console 1688.');
    err.status = 503;
    throw err;
  }
  const url = new URL(`https://gw.open.1688.com/openapi/http/1/system.oauth2/getToken/${alibabaConfig.appKey}`);
  url.searchParams.set('grant_type', 'authorization_code');
  url.searchParams.set('need_refresh_token', 'true');
  url.searchParams.set('client_id', alibabaConfig.appKey);
  url.searchParams.set('client_secret', alibabaConfig.appSecret);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code', String(code || '').trim());

  const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(alibabaConfig.requestTimeoutMs) });
  const data = await response.json().catch(() => ({}));
  if (!data.access_token) {
    const err = new Error(data.error_description || data.error_message || data.error || 'Échange du code OAuth Alibaba impossible.');
    err.status = 502;
    err.alibaba = data;
    throw err;
  }
  return saveToken(data);
}

async function refreshAccessToken(refreshToken) {
  const url = new URL(`https://gw.open.1688.com/openapi/http/1/system.oauth2/getToken/${alibabaConfig.appKey}`);
  url.searchParams.set('grant_type', 'refresh_token');
  url.searchParams.set('client_id', alibabaConfig.appKey);
  url.searchParams.set('client_secret', alibabaConfig.appSecret);
  url.searchParams.set('refresh_token', refreshToken);
  const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(alibabaConfig.requestTimeoutMs) });
  const data = await response.json().catch(() => ({}));
  if (!data.access_token) {
    const err = new Error(data.error_description || data.error_message || 'Rafraîchissement du token Alibaba impossible.');
    err.status = 502;
    throw err;
  }
  return saveToken(data);
}

async function getValidAccessToken() {
  if (alibabaConfig.accessToken) return alibabaConfig.accessToken;
  const stored = await loadStoredToken();
  if (!stored?.accessToken) {
    const err = new Error('Aucun access token Alibaba. Cliquez sur « Connecter Alibaba » pour autoriser l’application (OAuth 1688).');
    err.status = 503;
    throw err;
  }
  const soon = Date.now() + 60 * 60 * 1000;
  if (stored.expiresAt && new Date(stored.expiresAt).getTime() < soon && stored.refreshToken) {
    try {
      const refreshed = await refreshAccessToken(stored.refreshToken);
      return refreshed.accessToken;
    } catch (error) {
      console.warn('[alibaba] refresh token failed:', error.message);
    }
  }
  return stored.accessToken;
}

async function getAuthStatus() {
  const stored = await loadStoredToken().catch(() => null);
  return {
    enabled: alibabaConfig.enabled,
    hasAppKey: Boolean(alibabaConfig.appKey),
    hasAppSecret: Boolean(alibabaConfig.appSecret),
    hasToken: Boolean(alibabaConfig.accessToken || stored?.accessToken),
    tokenSource: alibabaConfig.accessToken ? 'env' : stored?.accessToken ? 'oauth' : 'none',
    expiresAt: stored?.expiresAt || null,
    resourceOwner: stored?.resourceOwner || '',
    gateway: alibabaConfig.gateway,
    redirectUri: getRedirectUri(),
    adminSuccessUrl: alibabaConfig.adminSuccessUrl,
  };
}

module.exports = {
  getRedirectUri,
  getAuthorizeUrl,
  createOauthState,
  consumeOauthState,
  exchangeAuthorizationCode,
  getValidAccessToken,
  getAuthStatus,
  saveToken,
};
