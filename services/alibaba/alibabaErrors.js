function classifyAlibabaError(error) {
  const message = String(error?.message || '');
  const code = String(error?.code || '');
  if (/IncompleteSignature|does not conform to platform standards/i.test(`${code} ${message}`)) {
    return {
      code: 'IncompleteSignature',
      alibaba: true,
      status: 502,
      message: message || 'The request signature does not conform to platform standards',
    };
  }
  if (/specified API Path is invalid|invalid.?api.?path/i.test(message) || code === 'INVALID_API_PATH') {
    return {
      code: 'INVALID_API_PATH',
      alibaba: true,
      status: 502,
      message: message || 'The specified API Path is invalid',
    };
  }
  if (/does not have permission|NO_API_PERMISSION/i.test(message) || code === 'NO_API_PERMISSION') {
    return {
      code: 'NO_API_PERMISSION',
      alibaba: true,
      status: 502,
      message: message || 'App does not have permission to access this api',
    };
  }
  if (/Invalid app Key|非法的AppKey/i.test(message)) {
    return {
      code: 'INVALID_APP_KEY',
      alibaba: true,
      status: 502,
      message: message || 'Invalid app Key',
    };
  }
  if (error?.code === 'PRODUCT_ID_REQUIRED' || error?.status === 400) {
    return {
      code: error.code || 'BAD_REQUEST',
      alibaba: false,
      status: error.status || 400,
      message,
    };
  }
  return {
    code: code && code !== 'ALIBABA' ? code : 'ALIBABA_ERROR',
    alibaba: Boolean(error?.alibaba),
    status: error?.status || 502,
    message: message || 'Erreur API Alibaba Open Platform.',
  };
}

function applyAlibabaError(error) {
  const classified = classifyAlibabaError(error);
  error.status = classified.status;
  error.code = classified.code;
  error.alibabaOrigin = classified.alibaba;
  return error;
}

module.exports = { classifyAlibabaError, applyAlibabaError };
