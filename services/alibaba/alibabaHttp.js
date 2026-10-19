const { alibabaConfig } = require('../../config/alibaba');
const { signIop } = require('./alibabaSign');

function stringifyParams(bizParams = {}) {
  return Object.fromEntries(
    Object.entries(bizParams)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : String(value)]),
  );
}

function extractErrorMessage(data = {}) {
  const raw = data.error_message || data.errorMsg || data.message || data.msg || data.exception || data.error_code || data.error || '';
  if (/非法的AppKey|illegal.?app.?key/i.test(String(raw))) {
    return 'Alibaba Open Platform refuse l’AppKey. Vérifiez ALIBABA_APP_KEY sur Render (console openapi.alibaba.com).';
  }
  return String(raw || 'Erreur API Alibaba Open Platform.');
}

async function iopPost(apiPath, bizParams = {}, { accessToken } = {}) {
  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const params = {
    app_key: alibabaConfig.appKey,
    timestamp: String(Date.now()),
    sign_method: 'sha256',
    ...stringifyParams(bizParams),
  };
  if (accessToken) params.access_token = accessToken;
  params.sign = signIop(path, params, alibabaConfig.appSecret);

  const url = `${alibabaConfig.gateway}${path}`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        'X-Protocol': 'GOP',
      },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(alibabaConfig.requestTimeoutMs),
    });
  } catch (error) {
    const err = new Error(`Impossible de joindre Alibaba Open Platform (${error.message}).`);
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
    err.details = String(text || '').slice(0, 400);
    throw err;
  }

  const code = data.code ?? data.error_code ?? data.errorCode;
  const failed = (code !== undefined && code !== null && String(code) !== '0' && String(code) !== '200')
    || data.error_message
    || data.exception;
  if (failed && !data.access_token) {
    const err = new Error(extractErrorMessage(data));
    err.status = 502;
    err.code = String(code || 'ALIBABA');
    err.alibaba = data;
    throw err;
  }

  if (!response.ok && !data.access_token) {
    const err = new Error(extractErrorMessage(data) || `Erreur Alibaba HTTP ${response.status}`);
    err.status = 502;
    err.alibaba = data;
    throw err;
  }

  return data.result || data.data || data;
}

module.exports = { iopPost };
