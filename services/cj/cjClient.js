const { cjConfig, assertCjConfigured } = require('../../config/cj');
const { withRateLimit, sleep } = require('./cjRateLimiter');

function sanitizeForLog(value) {
  const str = String(value || '');
  if (cjConfig.accessToken && str.includes(cjConfig.accessToken)) {
    return str.replaceAll(cjConfig.accessToken, '[REDACTED]');
  }
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
    err.status = 401;
    err.cj = data;
    throw err;
  }
  if (response.status === 403) {
    const err = new Error('Accès CJ refusé.');
    err.status = 403;
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

async function request(method, path, { query, body, retry = 0 } = {}) {
  assertCjConfigured();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cjConfig.requestTimeoutMs);

  try {
    return await withRateLimit(async () => {
      const response = await fetch(buildUrl(path, query), {
        method,
        headers: {
          'CJ-Access-Token': cjConfig.accessToken,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      return parseResponse(response);
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
