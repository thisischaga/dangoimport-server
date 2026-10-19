const { alibabaConfig } = require('../../config/alibaba');
const { signIop } = require('./alibabaSign');
const { applyAlibabaError } = require('./alibabaErrors');

function stringifyParams(bizParams = {}) {
  return Object.fromEntries(
    Object.entries(bizParams)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : String(value)]),
  );
}

function parseJsonObject(value) {
  if (typeof value !== 'string' || !value.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function wrapEcoBizParams(apiPath, bizParams = {}) {
  if (!String(apiPath || '').startsWith('/eco/')) return bizParams;
  if (bizParams.param0 !== undefined && bizParams.param0 !== null && bizParams.param0 !== '') {
    return bizParams;
  }
  const entries = Object.entries(bizParams)
    .filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (entries.length !== 1) return bizParams;
  const [, value] = entries[0];
  if (typeof value === 'object' && !Array.isArray(value)) return { param0: value };
  const parsed = parseJsonObject(value);
  if (parsed) return { param0: parsed };
  return bizParams;
}

function parseAlibabaPayload(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const err = new Error('Réponse Alibaba invalide.');
    err.status = 502;
    err.details = String(text || '').slice(0, 400);
    throw applyAlibabaError(err);
  }
}

function throwIfFailed(data, response) {
  const code = data.code ?? data.error_code ?? data.errorCode;
  const nestedResultCode = data.result?.result_code;
  const nestedFailed = nestedResultCode !== undefined
    && nestedResultCode !== null
    && String(nestedResultCode) !== '200'
    && String(nestedResultCode) !== '0';
  const raw = data.error_message || data.errorMsg || data.message || data.msg || data.sub_msg
    || data.exception || data.error || data.result?.result_msg || '';
  const failed = (code !== undefined && code !== null && String(code) !== '0' && String(code) !== '200')
    || nestedFailed
    || data.error_response
    || data.error_message
    || data.exception;
  const nested = data.error_response || {};
  const message = (nestedFailed ? data.result?.result_msg : '')
    || raw
    || nested.sub_msg
    || nested.msg
    || (!response.ok ? `Erreur Alibaba HTTP ${response.status}` : '');
  if ((failed || !response.ok) && !data.access_token) {
    const err = new Error(String(message || 'Erreur API Alibaba Open Platform.'));
    err.status = 502;
    err.code = String(nested.code || code || nestedResultCode || 'ALIBABA');
    err.alibaba = { code: nested.code || code, message };
    throw applyAlibabaError(err);
  }
}

function isAuthPath(apiPath) {
  return String(apiPath || '').startsWith('/auth/');
}

function shouldAppendPath(apiPath) {
  const path = String(apiPath || '');
  return path.startsWith('/auth/') || path.startsWith('/eco/');
}

function buildGopRequest(apiPath, bizParams = {}, { accessToken, appendPath } = {}) {
  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const append = appendPath ?? shouldAppendPath(path);
  const params = {
    app_key: alibabaConfig.appKey,
    timestamp: String(Date.now()),
    sign_method: 'sha256',
    ...stringifyParams(wrapEcoBizParams(path, bizParams)),
  };
  if (!append) {
    params.format = 'json';
    params.method = path;
  }
  if (accessToken) params.access_token = accessToken;
  params.sign = signIop(path, params, alibabaConfig.appSecret);
  const url = append ? `${alibabaConfig.gateway}${path}` : alibabaConfig.gateway;
  return { url, path, params, append };
}

function logSafeAlibabaError(path, error, style, params) {
  const prefix = style ? `${path} [${style}]` : path;
  const keys = params ? Object.keys(params).filter((key) => key !== 'sign').sort().join(',') : '';
  console.warn(`[alibaba] ${prefix}: ${error.code || ''} ${error.message}${keys ? ` keys=${keys}` : ''}`.trim());
}

function buildEcoGetRequest(apiPath, bizParams = {}, { accessToken } = {}) {
  const built = buildGopRequest(apiPath, bizParams, { accessToken, appendPath: true });
  return {
    path: built.path,
    params: built.params,
    queryUrl: `${built.url}?${new URLSearchParams(built.params)}`,
    headerHeaders: { 'X-Protocol': 'GOP' },
  };
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
  return data;
}

async function iopPost(apiPath, bizParams = {}, { accessToken, appendPath } = {}) {
  const built = buildGopRequest(apiPath, bizParams, { accessToken, appendPath });
  try {
    return await postForm(built.url, built.params);
  } catch (error) {
    logSafeAlibabaError(built.path, error, undefined, built.params);
    throw error;
  }
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(alibabaConfig.requestTimeoutMs),
  });
  const text = await response.text();
  const data = parseAlibabaPayload(text);
  throwIfFailed(data, response);
  return data;
}

async function iopGet(apiPath, bizParams = {}, { accessToken } = {}) {
  const built = buildEcoGetRequest(apiPath, bizParams, { accessToken });
  try {
    return await getJson(built.queryUrl, built.headerHeaders);
  } catch (error) {
    logSafeAlibabaError(built.path, error, 'query-get', built.params);
    throw error;
  }
}

module.exports = { iopPost, iopGet, buildGopRequest, buildEcoGetRequest, shouldAppendPath, wrapEcoBizParams };
