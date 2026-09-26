require('dotenv').config();

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true' || value === '1';
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function trimEnv(value) {
  return String(value || '').trim().replace(/^["']|["']$/g, '');
}

const rawAccessEnv = trimEnv(process.env.CJ_ACCESS_TOKEN);
const explicitApiKey = trimEnv(process.env.CJ_API_KEY);
const looksLikeApiKey = rawAccessEnv.includes('@api@');

const cjConfig = {
  apiBaseUrl: (process.env.CJ_API_BASE_URL || 'https://developers.cjdropshipping.com').replace(/\/$/, ''),
  /** Access token JWT-like retourné par getAccessToken (pas la clé @api@) */
  accessToken: looksLikeApiKey ? '' : rawAccessEnv,
  /** Clé API CJ (format CJxxxx@api@…) — échange automatique via getAccessToken */
  apiKey: explicitApiKey || (looksLikeApiKey ? rawAccessEnv : ''),
  refreshToken: trimEnv(process.env.CJ_REFRESH_TOKEN),
  enabled: toBool(process.env.CJ_API_ENABLED, false),
  syncEnabled: toBool(process.env.CJ_SYNC_ENABLED, true),
  importBatchSize: Math.min(100, Math.max(1, toNumber(process.env.CJ_IMPORT_BATCH_SIZE, 100))),
  defaultMarginPercent: toNumber(process.env.CJ_DEFAULT_MARGIN_PERCENT, 30),
  maxConcurrentRequests: Math.max(1, toNumber(process.env.CJ_MAX_CONCURRENT_REQUESTS, 1)),
  requestDelayMs: Math.max(0, toNumber(process.env.CJ_REQUEST_DELAY_MS, 1000)),
  requestTimeoutMs: Math.max(5000, toNumber(process.env.CJ_REQUEST_TIMEOUT_MS, 30000)),
  maxRetries: Math.max(0, toNumber(process.env.CJ_MAX_RETRIES, 2)),
  usdToXofRate: Math.max(1, toNumber(process.env.CJ_USD_TO_XOF_RATE, 610)),
  translateToFr: toBool(process.env.CJ_TRANSLATE_TO_FR, true),
  /** Stock affiché boutique si CJ ne remonte pas d’inventaire */
  defaultPublicStock: Math.max(1, toNumber(process.env.CJ_DEFAULT_PUBLIC_STOCK, 50)),
  platformKey: 'cj',
  supplierName: 'CJdropshipping',
};

function assertCjConfigured() {
  if (!cjConfig.enabled) {
    const err = new Error('Intégration CJdropshipping désactivée (CJ_API_ENABLED=false).');
    err.status = 503;
    throw err;
  }
  if (!cjConfig.accessToken && !cjConfig.apiKey && !cjConfig.refreshToken) {
    const err = new Error('CJ_ACCESS_TOKEN, CJ_API_KEY ou CJ_REFRESH_TOKEN requis.');
    err.status = 503;
    throw err;
  }
}

module.exports = {
  cjConfig,
  assertCjConfigured,
};
