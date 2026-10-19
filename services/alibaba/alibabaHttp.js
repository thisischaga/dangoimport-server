const { alibabaConfig } = require('../../config/alibaba');
const { signIop, signTopHmacMd5, gmtPlus8Timestamp } = require('./alibabaSign');

function stringifyParams(bizParams = {}) {
  return Object.fromEntries(
    Object.entries(bizParams)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : String(value)]),
  );
}

function parseAlibabaPayload(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const err = new Error('Réponse Alibaba invalide.');
    err.status = 502;
    err.details = String(text || '').slice(0, 400);
    throw err;
  }
}

function throwIfFailed(data, response) {
  const code = data.code ?? data.error_code ?? data.errorCode;
  const raw = data.error_message || data.errorMsg || data.message || data.msg || data.sub_msg || data.exception || data.error || '';
  const failed = (code !== undefined && code !== null && String(code) !== '0' && String(code) !== '200')
    || data.error_response
    || data.error_message
    || data.exception;
  const nested = data.error_response || {};
  const message = raw
    || nested.sub_msg
    || nested.msg
    || (!response.ok ? `Erreur Alibaba HTTP ${response.status}` : '');
  if ((failed || !response.ok) && !data.access_token) {
    const err = new Error(String(message || 'Erreur API Alibaba Open Platform.'));
    err.status = 502;
    err.code = String(nested.code || code || 'ALIBABA');
    err.alibaba = data;
    throw err;
  }
}

async function postForm(url, params) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      'X-Protocol': 'GOP',
    },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(alibabaConfig.requestTimeoutMs),
  });
  const text = await response.text();
  const data = parseAlibabaPayload(text);
  throwIfFailed(data, response);
  return data.result || data.data || data;
}

async function iopPost(apiPath, bizParams = {}, { accessToken, appendPath, methodValue } = {}) {
  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const params = {
    app_key: alibabaConfig.appKey,
    format: 'json',
    method: methodValue || path,
    timestamp: String(Date.now()),
    sign_method: 'sha256',
    ...stringifyParams(bizParams),
  };
  if (accessToken) params.access_token = accessToken;
  params.sign = signIop(path, params, alibabaConfig.appSecret);
  const url = appendPath === false
    ? alibabaConfig.gateway
    : `${alibabaConfig.gateway}${path}`;
  return postForm(url, params);
}

function isInvalidApiPath(error) {
  return /specified API Path is invalid|invalid.?api.?path/i.test(String(error?.message || ''));
}

async function iopPostFlexible(apiPath, bizParams = {}, { accessToken } = {}) {
  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const isAuth = path.startsWith('/auth/');
  const modes = isAuth
    ? [{ appendPath: true, label: 'path' }]
    : [{ appendPath: true, label: 'append' }, { appendPath: false, label: 'root' }];
  let lastError;
  for (const mode of modes) {
    try {
      return await iopPost(path, bizParams, {
        accessToken,
        appendPath: mode.appendPath,
        methodValue: path,
      });
    } catch (error) {
      lastError = error;
      console.warn(`[alibaba] ${path} [${mode.label}]: ${error.message}`);
      if (!isInvalidApiPath(error)) throw error;
    }
  }
  throw lastError;
}

async function topPost(method, bizParams = {}, { accessToken } = {}) {
  const params = {
    method,
    app_key: alibabaConfig.appKey,
    timestamp: gmtPlus8Timestamp(),
    format: 'json',
    v: '2.0',
    sign_method: 'hmac',
    simplify: 'true',
    ...stringifyParams(bizParams),
  };
  if (accessToken) params.session = accessToken;
  params.sign = signTopHmacMd5(params, alibabaConfig.appSecret);
  const gateways = [
    'https://eco.taobao.com/router/rest',
    'https://api.alibaba.com/router/rest',
  ];
  let lastError;
  for (const url of gateways) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body: new URLSearchParams(params),
        signal: AbortSignal.timeout(alibabaConfig.requestTimeoutMs),
      });
      const text = await response.text();
      const data = parseAlibabaPayload(text);
      throwIfFailed(data, response);
      const wrapped = Object.values(data).find((value) => value && typeof value === 'object') || data;
      return wrapped;
    } catch (error) {
      lastError = error;
      console.warn(`[alibaba] TOP ${method} @ ${url}: ${error.message}`);
    }
  }
  throw lastError;
}

module.exports = { iopPost, iopPostFlexible, topPost };
