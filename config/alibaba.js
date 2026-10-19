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

const productionBackend = (process.env.BACKEND_URL || process.env.API_BASE_URL || 'https://dangoimport-server.onrender.com').replace(/\/$/, '');
const productionAdmin = (process.env.ADMIN_FRONTEND_URL || 'https://dangoimport-admin-eiim.vercel.app').replace(/\/$/, '');

const alibabaConfig = {
  gateway: (process.env.ALIBABA_API_GATEWAY || 'https://openapi-api.alibaba.com/rest').replace(/\/$/, ''),
  authorizeUrl: (process.env.ALIBABA_AUTHORIZE_URL || 'https://openapi-auth.alibaba.com/oauth/authorize').replace(/\/$/, ''),
  appKey: trimEnv(process.env.ALIBABA_APP_KEY),
  appSecret: trimEnv(process.env.ALIBABA_APP_SECRET),
  accessToken: trimEnv(process.env.ALIBABA_ACCESS_TOKEN),
  redirectUri: trimEnv(process.env.ALIBABA_REDIRECT_URI) || `${productionBackend}/api/admin/suppliers/alibaba/oauth/callback`,
  adminSuccessUrl: trimEnv(process.env.ALIBABA_ADMIN_SUCCESS_URL) || `${productionAdmin}/suppliers/alibaba`,
  enabled: toBool(process.env.ALIBABA_API_ENABLED, false),
  apiVersion: String(process.env.ALIBABA_API_VERSION || '1').trim() || '1',
  requestTimeoutMs: Math.max(5000, toNumber(process.env.ALIBABA_REQUEST_TIMEOUT_MS, 30000)),
  cnyToXofRate: Math.max(1, toNumber(process.env.ALIBABA_CNY_TO_XOF_RATE, 85)),
  cnyToUsdRate: Math.max(0.01, toNumber(process.env.ALIBABA_CNY_TO_USD_RATE, 7.2)),
  defaultPublicStock: Math.max(1, toNumber(process.env.ALIBABA_DEFAULT_PUBLIC_STOCK, 50)),
  defaultCountry: trimEnv(process.env.ALIBABA_DEFAULT_COUNTRY) || 'US',
  defaultPoolId: trimEnv(process.env.ALIBABA_DEFAULT_POOL_ID) || '9031800410',
  productGetPath: trimEnv(process.env.ALIBABA_PRODUCT_GET_PATH) || '/icbu/product/get',
  productListPath: trimEnv(process.env.ALIBABA_PRODUCT_LIST_PATH),
  platformKey: 'alibaba',
  supplierName: 'Alibaba.com',
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
