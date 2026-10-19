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
    err.alibaba = { code: nested.code || code, message };
    throw applyAlibabaError(err);
  }
}

function isAuthPath(apiPath) {
  return String(apiPath || '').startsWith('/auth/');
}

function shouldAppendPath(apiPath) {
  return false;
}

function isIncompleteSignature(error) {
  return error?.code === 'IncompleteSignature'
    || /IncompleteSignature|does not conform to platform standards/i.test(String(error?.message || ''));
}

function buildGopRequest(apiPath, bizParams = {}, {
  accessToken,
  appendPath,
  includeMethod = true,
} = {}) {
  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const append = appendPath ?? shouldAppendPath(path);
  const timestamp = String(Date.now());
  const params = includeMethod
    ? {
      app_key: alibabaConfig.appKey,
      format: 'json',
      method: path,
      timestamp,
      sign_method: 'sha256',
      ...stringifyParams(bizParams),
    }
    : {
      app_key: alibabaConfig.appKey,
      sign_method: 'sha256',
      timestamp,
      ...stringifyParams(bizParams),
    };
  if (accessToken) params.access_token = accessToken;
  params.sign = signIop(path, params, alibabaConfig.appSecret);
  const url = append ? `${alibabaConfig.gateway}${path}` : alibabaConfig.gateway;
  return { url, path, params, append, includeMethod };
}

function logSafeAlibabaError(path, error, style) {
  const prefix = style ? `${path} [${style}]` : path;
  console.warn(`[alibaba] ${prefix}: ${error.code || ''} ${error.message}`.trim());
}

async function postForm(url, params) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
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

async function iopPostOnce(apiPath, bizParams, options) {
  const built = buildGopRequest(apiPath, bizParams, options);
  return postForm(built.url, built.params);
}

async function iopPost(apiPath, bizParams = {}, options = {}) {
  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const styles = isAuthPath(path) && options.appendPath === undefined && options.includeMethod === undefined
    ? [
      { name: 'root-gop', appendPath: false, includeMethod: true },
      { name: 'append-python', appendPath: true, includeMethod: false },
      { name: 'append-gop', appendPath: true, includeMethod: true },
    ]
    : [{ name: 'default', appendPath: options.appendPath, includeMethod: options.includeMethod }];

  let lastError;
  for (const style of styles) {
    try {
      return await iopPostOnce(path, bizParams, {
        accessToken: options.accessToken,
        appendPath: style.appendPath,
        includeMethod: style.includeMethod,
      });
    } catch (error) {
      lastError = error;
      logSafeAlibabaError(path, error, style.name);
      if (!isAuthPath(path) || !isIncompleteSignature(error)) throw error;
    }
  }
  throw lastError;
}

module.exports = { iopPost, buildGopRequest, shouldAppendPath, isIncompleteSignature };
