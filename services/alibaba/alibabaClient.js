const crypto = require('crypto');
const { alibabaConfig, assertAlibabaConfigured } = require('../../config/alibaba');
const { getValidAccessToken } = require('./alibabaTokenService');

function sanitizeForLog(value) {
  let str = String(value || '');
  [alibabaConfig.appKey, alibabaConfig.appSecret, alibabaConfig.accessToken].forEach((secret) => {
    if (secret && str.includes(secret)) str = str.replaceAll(secret, '[REDACTED]');
  });
  return str;
}

function gmtPlus8Timestamp() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const cst = new Date(utc + 8 * 3600000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${cst.getFullYear()}-${pad(cst.getMonth() + 1)}-${pad(cst.getDate())} ${pad(cst.getHours())}:${pad(cst.getMinutes())}:${pad(cst.getSeconds())}`;
}

/**
 * Signature AOP 1688 : HMAC-SHA1(secret, path + key1value1key2value2…).
 * path = param2/{version}/{namespace}/{apiName}/{appKey}
 */
function signRequest(urlPath, params, secret) {
  const keys = Object.keys(params).filter((key) => key !== '_aop_signature').sort();
  let assembled = urlPath;
  keys.forEach((key) => {
    const value = params[key];
    if (value === undefined || value === null) return;
    assembled += `${key}${value}`;
  });
  return crypto.createHmac('sha1', secret).update(assembled, 'utf8').digest('hex').toUpperCase();
}

function buildUrlPath(namespace, apiName) {
  return `param2/${alibabaConfig.apiVersion}/${namespace}/${apiName}/${alibabaConfig.appKey}`;
}

async function alibabaCall(apiName, bizParams = {}, { namespace = 'com.alibaba.product' } = {}) {
  assertAlibabaConfigured();
  const accessToken = await getValidAccessToken();
  const urlPath = buildUrlPath(namespace, apiName);
  const params = {
    access_token: accessToken,
    _aop_timestamp: String(Date.now()),
    ...Object.fromEntries(
      Object.entries(bizParams).filter(([, value]) => value !== undefined && value !== null && value !== ''),
    ),
  };
  params._aop_signature = signRequest(urlPath, params, alibabaConfig.appSecret);

  const url = `${alibabaConfig.gateway}/${urlPath}`;
  const body = new URLSearchParams(params);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body,
      signal: AbortSignal.timeout(alibabaConfig.requestTimeoutMs),
    });
  } catch (error) {
    const err = new Error(`Impossible de joindre l’API Alibaba (${error.message}).`);
    err.status = 502;
    throw err;
  }

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    const err = new Error(`Réponse Alibaba invalide (HTTP ${response.status}).`);
    err.status = 502;
    err.details = sanitizeForLog(text.slice(0, 400));
    throw err;
  }

  if (data.error_code || data.errorCode || data.error_message || data.exception) {
    const message = data.error_message || data.errorMsg || data.exception || data.error_code || 'Erreur API Alibaba.';
    const err = new Error(String(message));
    err.status = 502;
    err.code = String(data.error_code || data.errorCode || 'ALIBABA');
    err.alibaba = data;
    throw err;
  }

  if (!response.ok) {
    const err = new Error(data?.error_message || `Erreur Alibaba HTTP ${response.status}`);
    err.status = 502;
    err.alibaba = data;
    throw err;
  }

  return data.result || data.data || data;
}

async function testConnection() {
  const started = Date.now();
  const result = await alibabaCall('alibaba.product.search', {
    keywords: 'phone',
    pageNo: 1,
    pageSize: 1,
  });
  return {
    ok: true,
    latencyMs: Date.now() - started,
    sampleCount: Array.isArray(result?.resultList || result?.products || result)
      ? (result.resultList || result.products || result).length
      : 0,
  };
}

module.exports = {
  alibabaCall,
  testConnection,
  signRequest,
  gmtPlus8Timestamp,
};
