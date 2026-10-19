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
  return isAuthPath(apiPath);
}

function buildGopRequest(apiPath, bizParams = {}, { accessToken, appendPath } = {}) {
  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const append = appendPath ?? shouldAppendPath(path);
  const params = {
    app_key: alibabaConfig.appKey,
    format: 'json',
    method: path,
    timestamp: String(Date.now()),
    sign_method: 'sha256',
    ...stringifyParams(bizParams),
  };
  if (accessToken) params.access_token = accessToken;
  params.sign = signIop(path, params, alibabaConfig.appSecret);
  const url = append ? `${alibabaConfig.gateway}${path}` : alibabaConfig.gateway;
  return { url, path, params, append };
}

function isIncompleteSignature(error) {
  return error?.code === 'IncompleteSignature'
    || /IncompleteSignature|does not conform to platform standards/i.test(String(error?.message || ''));
}

function isMissingAppKey(error) {
  return error?.code === 'MISSING_APP_KEY'
    || /app_key.+not supplied|mandatory for processing this request is not supplied/i.test(String(error?.message || ''));
}

function logSafeAlibabaError(path, error, style) {
  const prefix = style ? `${path} [${style}]` : path;
  console.warn(`[alibaba] ${prefix}: ${error.code || ''} ${error.message}`.trim());
}

function buildEcoGetRequest(apiPath, bizParams = {}, { accessToken } = {}) {
  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const biz = stringifyParams(bizParams);
  const sys = {
    app_key: alibabaConfig.appKey,
    timestamp: String(Date.now()),
    sign_method: 'sha256',
  };
  if (accessToken) sys.access_token = accessToken;
  const signParams = { ...sys, ...biz };
  const sign = signIop(path, signParams, alibabaConfig.appSecret);
  const query = new URLSearchParams({ ...signParams, sign });
  return {
    path,
    queryUrl: `${alibabaConfig.gateway}${path}?${query}`,
    headerHeaders: { ...sys, sign, 'X-Protocol': 'GOP' },
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
    logSafeAlibabaError(built.path, error);
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
    logSafeAlibabaError(built.path, error, 'query-get');
    if (!isIncompleteSignature(error) && !isMissingAppKey(error)) throw error;
  }
  try {
    return await iopPost(apiPath, bizParams, { accessToken, appendPath: false });
  } catch (error) {
    logSafeAlibabaError(apiPath, error, 'form-post');
    throw error;
  }
}

module.exports = { iopPost, iopGet, buildGopRequest, buildEcoGetRequest, shouldAppendPath };
