const { FedaPay } = require('fedapay');

function cleanEnv(value) {
  if (!value) return '';
  return String(value).trim().replace(/^["']|["']$/g, '');
}

function resolveFedapayEnvironment(apiKey) {
  // Le préfixe de la clé prime sur FEDAPAY_ENVIRONMENT (évite live key + sandbox)
  if (apiKey.startsWith('sk_live_')) return 'live';
  if (apiKey.startsWith('sk_sandbox_') || apiKey.startsWith('sk_test_')) return 'sandbox';

  const explicit = cleanEnv(process.env.FEDAPAY_ENVIRONMENT).toLowerCase();
  if (explicit === 'live' || explicit === 'production') return 'live';
  if (explicit === 'sandbox' || explicit === 'test') return 'sandbox';

  return 'sandbox';
}

function configureFedapay() {
  const apiKey = cleanEnv(process.env.FEDAPAY_SECRET_KEY);
  if (!apiKey) return { ok: false, reason: 'missing_key' };

  const environment = resolveFedapayEnvironment(apiKey);
  FedaPay.setApiKey(apiKey);
  FedaPay.setEnvironment(environment);

  return {
    ok: true,
    environment,
    keyType: apiKey.startsWith('sk_live_') ? 'live' : apiKey.startsWith('sk_sandbox_') ? 'sandbox' : 'unknown',
  };
}

function getFedapayStatus() {
  const apiKey = cleanEnv(process.env.FEDAPAY_SECRET_KEY);
  if (!apiKey) {
    return { configured: false, environment: null, keyType: null };
  }
  return {
    configured: true,
    environment: resolveFedapayEnvironment(apiKey),
    keyType: apiKey.startsWith('sk_live_') ? 'live' : apiKey.startsWith('sk_sandbox_') ? 'sandbox' : 'unknown',
    apiBase: apiKey.startsWith('sk_live_') ? 'https://api.fedapay.com' : 'https://sandbox-api.fedapay.com',
  };
}

module.exports = { configureFedapay, getFedapayStatus, cleanEnv };
