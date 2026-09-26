const { cjConfig, assertCjConfigured } = require('../../config/cj');
const { withRateLimit, sleep } = require('./cjRateLimiter');
const { getValidAccessToken, invalidateSession } = require('./cjTokenService');

function sanitizeForLog(value) {
  let str = String(value || '');
  [cjConfig.accessToken, cjConfig.apiKey, cjConfig.refreshToken].forEach((secret) => {
    if (secret && str.includes(secret)) str = str.replaceAll(secret, '[REDACTED]');
  });
  return str;
}

function buildUrl(path, query = {}) {
  const base = `${cjConfig.apiBaseUrl}/api2.0/v1${path.startsWith('/') ? path : `/${path}`}`;
  const url = new URL(base);
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((item) => url.searchParams.append(key, String(item)));
      return;
    }
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function parseResponse(response) {
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    const err = new Error(`Réponse CJ invalide (HTTP ${response.status}).`);
    err.status = 502;
    err.details = sanitizeForLog(text.slice(0, 500));
    throw err;
  }

  if (response.status === 401) {
    const err = new Error('Token CJ invalide ou expiré.');
    err.status = 502;
    err.code = 'CJ_AUTH';
    err.cj = data;
    throw err;
  }
  if (response.status === 403) {
    const err = new Error('Accès CJ refusé.');
    err.status = 502;
    err.code = 'CJ_FORBIDDEN';
    err.cj = data;
    throw err;
  }
  if (response.status === 429) {
    const err = new Error('Quota / rate limit CJ atteint.');
    err.status = 429;
    err.cj = data;
    throw err;
  }
  if (response.status >= 500) {
    const err = new Error(`Erreur serveur CJ (HTTP ${response.status}).`);
    err.status = 502;
    err.cj = data;
    throw err;
  }
  if (!response.ok) {
    const err = new Error(data?.message || `Erreur CJ HTTP ${response.status}`);
    err.status = response.status;
    err.cj = data;
    throw err;
  }

  if (data?.result === false || (data?.code && Number(data.code) !== 200)) {
    const err = new Error(data?.message || 'Erreur CJ API.');
    err.status = 502;
    err.cj = data;
    throw err;
  }

  return data;
}

async function request(method, path, { query, body, retry = 0, authRetry = 0 } = {}) {
  assertCjConfigured();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cjConfig.requestTimeoutMs);

  try {
    return await withRateLimit(async () => {
      const accessToken = await getValidAccessToken();
      const response = await fetch(buildUrl(path, query), {
        method,
        headers: {
          'CJ-Access-Token': accessToken,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      try {
        return await parseResponse(response);
      } catch (error) {
        if (error.code === 'CJ_AUTH' && authRetry < 1 && cjConfig.apiKey) {
          invalidateSession();
          return request(method, path, { query, body, retry, authRetry: authRetry + 1 });
        }
        throw error;
      }
    });
  } catch (error) {
    const isAbort = error.name === 'AbortError';
    const retriable = isAbort || [429, 502, 503, 504].includes(Number(error.status));
    if (retriable && retry < cjConfig.maxRetries) {
      await sleep(500 * (retry + 1));
      return request(method, path, { query, body, retry: retry + 1 });
    }

    if (isAbort) {
      const err = new Error('Timeout CJ API.');
      err.status = 504;
      err.code = 'CJ_TIMEOUT';
      throw err;
    }

    const networkMsg = error.cause?.message || error.message || '';
    if (networkMsg.includes('fetch failed') || networkMsg.includes('ECONNREFUSED') || networkMsg.includes('ETIMEDOUT') || networkMsg.includes('Connect Timeout')) {
      const err = new Error(
        'Impossible de joindre l’API CJdropshipping depuis ce serveur (réseau, firewall ou région). '
        + 'Testez avec le backend hébergé (Render) ou vérifiez l’accès à developers.cjdropshipping.com.',
      );
      err.status = 502;
      err.code = 'CJ_NETWORK';
      throw err;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function get(path, query) {
  return request('GET', path, { query });
}

module.exports = {
  get,
  buildUrl,
  sanitizeForLog,
};
