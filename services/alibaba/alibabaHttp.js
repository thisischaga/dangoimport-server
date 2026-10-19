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
  return isAuthPath(apiPath);
}

function buildGopRequest(apiPath, bizParams = {}, { accessToken, appendPath } = {}) {
  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const append = appendPath ?? shouldAppendPath(path);
  const timestamp = String(Date.now());
  const params = isAuthPath(path)
    ? {
      app_key: alibabaConfig.appKey,
      sign_method: 'sha256',
      timestamp,
      ...stringifyParams(bizParams),
    }
    : {
      app_key: alibabaConfig.appKey,
      format: 'json',
      method: path,
      timestamp,
      sign_method: 'sha256',
      ...stringifyParams(bizParams),
    };
  if (accessToken && !isAuthPath(path)) params.access_token = accessToken;
  params.sign = signIop(path, params, alibabaConfig.appSecret);
  const url = append ? `${alibabaConfig.gateway}${path}` : alibabaConfig.gateway;
  return { url, path, params, append };
}

function logSafeAlibabaError(path, error) {
  console.warn(`[alibaba] ${path}: ${error.code || ''} ${error.message}`.trim());
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

module.exports = { iopPost, buildGopRequest, shouldAppendPath };
