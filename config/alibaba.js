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

const alibabaConfig = {
  gateway: (process.env.ALIBABA_API_GATEWAY || 'https://gw.open.1688.com/openapi').replace(/\/$/, ''),
  appKey: trimEnv(process.env.ALIBABA_APP_KEY),
  appSecret: trimEnv(process.env.ALIBABA_APP_SECRET),
  accessToken: trimEnv(process.env.ALIBABA_ACCESS_TOKEN),
  redirectUri: trimEnv(process.env.ALIBABA_REDIRECT_URI),
  adminSuccessUrl: trimEnv(process.env.ALIBABA_ADMIN_SUCCESS_URL) || 'http://localhost:5173/suppliers/alibaba',
  enabled: toBool(process.env.ALIBABA_API_ENABLED, false),
  apiVersion: String(process.env.ALIBABA_API_VERSION || '1').trim() || '1',
  requestTimeoutMs: Math.max(5000, toNumber(process.env.ALIBABA_REQUEST_TIMEOUT_MS, 30000)),
  cnyToXofRate: Math.max(1, toNumber(process.env.ALIBABA_CNY_TO_XOF_RATE, 85)),
  cnyToUsdRate: Math.max(0.01, toNumber(process.env.ALIBABA_CNY_TO_USD_RATE, 7.2)),
  defaultPublicStock: Math.max(1, toNumber(process.env.ALIBABA_DEFAULT_PUBLIC_STOCK, 50)),
  platformKey: 'alibaba',
  supplierName: 'Alibaba / 1688',
};

function assertAlibabaConfigured() {
  if (!alibabaConfig.enabled) {
    const err = new Error('Intégration Alibaba désactivée (ALIBABA_API_ENABLED=false).');
    err.status = 503;
    throw err;
  }
  if (!alibabaConfig.appKey || !alibabaConfig.appSecret) {
    const err = new Error('ALIBABA_APP_KEY et ALIBABA_APP_SECRET sont requis.');
    err.status = 503;
    throw err;
  }
}

function convertCnyToUsd(amountCny) {
  const cny = Number(amountCny) || 0;
  return Number((cny / alibabaConfig.cnyToUsdRate).toFixed(4));
}

function convertCnyToXof(amountCny) {
  const cny = Number(amountCny) || 0;
  return Math.max(0, Math.round(cny * alibabaConfig.cnyToXofRate));
}

module.exports = {
  alibabaConfig,
  assertAlibabaConfigured,
  convertCnyToUsd,
  convertCnyToXof,
};
