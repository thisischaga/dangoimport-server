const crypto = require('crypto');
const AlibabaToken = require('../../Models/AlibabaToken');
const { alibabaConfig } = require('../../config/alibaba');
const { iopPost } = require('./alibabaHttp');

const pendingStates = new Map();

function getRedirectUri() {
  return String(alibabaConfig.redirectUri || '').trim();
}

function getAuthorizeUrl(state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: alibabaConfig.appKey,
    redirect_uri: getRedirectUri(),
    state: String(state || ''),
    view: 'web',
    sp: 'icbu',
  });
  return `${alibabaConfig.authorizeUrl}?${params.toString()}`;
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
      aliId: String(payload.havana_id || payload.buyer_id || payload.aliId || payload.ali_id || ''),
      resourceOwner: String(payload.account || payload.user_nick || payload.resource_owner || payload.resourceOwner || ''),
      updatedAt: new Date(),
    },
    { upsert: true, new: true },
  );
  return doc.toObject();
}

function assertAppCredentials() {
  if (!alibabaConfig.appKey || !alibabaConfig.appSecret) {
    const err = new Error('ALIBABA_APP_KEY / ALIBABA_APP_SECRET absents sur le serveur (à définir sur Render).');
    err.status = 503;
    throw err;
  }
}

async function exchangeAuthorizationCode(code) {
  assertAppCredentials();
  const redirectUri = getRedirectUri();
  if (!redirectUri) {
    const err = new Error('ALIBABA_REDIRECT_URI manquant. Ajoutez l’URL de callback dans la console openapi.alibaba.com.');
    err.status = 503;
    throw err;
  }
  const data = await iopPost('/auth/token/create', {
    code: String(code || '').trim(),
  });
  if (!data.access_token && !data.accessToken) {
    const err = new Error(data.error_description || data.error_message || data.message || 'Échange du code OAuth Alibaba impossible.');
    err.status = 502;
    err.alibaba = data;
    throw err;
  }
  return saveToken(data);
}

async function refreshAccessToken(refreshToken) {
  const data = await iopPost('/auth/token/refresh', {
    refresh_token: refreshToken,
  });
  if (!data.access_token && !data.accessToken) {
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
    const err = new Error('Aucun access token Alibaba. Cliquez sur « Connecter Alibaba » (OAuth Open Platform).');
    err.status = 503;
    throw err;
  }
  const soon = Date.now() + 30 * 60 * 1000;
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
    platform: 'alibaba.com',
    hasAppKey: Boolean(alibabaConfig.appKey),
    appKeyHint: alibabaConfig.appKey ? `…${alibabaConfig.appKey.slice(-2)} (${alibabaConfig.appKey.length} car.)` : '',
    hasAppSecret: Boolean(alibabaConfig.appSecret),
    hasToken: Boolean(alibabaConfig.accessToken || stored?.accessToken),
    tokenSource: alibabaConfig.accessToken ? 'env' : stored?.accessToken ? 'oauth' : 'none',
    expiresAt: stored?.expiresAt || null,
    resourceOwner: stored?.resourceOwner || '',
    gateway: alibabaConfig.gateway,
    authorizeUrl: alibabaConfig.authorizeUrl,
    redirectUri: getRedirectUri(),
    adminSuccessUrl: alibabaConfig.adminSuccessUrl,
    productGetPath: alibabaConfig.productGetPath,
    productListPath: alibabaConfig.productListPath || '',
    keywordSearchEnabled: Boolean(alibabaConfig.productListPath),
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
