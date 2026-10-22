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
  if (/http method is not supported/i.test(message)) {
    return {
      code: 'HTTP_METHOD_NOT_SUPPORTED',
      alibaba: true,
      status: 502,
      message: message || 'This http method is not supported',
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
  if (/app_key.+not supplied/i.test(message)) {
    return {
      code: 'MISSING_APP_KEY',
      alibaba: true,
      status: 502,
      message: message || 'The input parameter “app_key” that is mandatory for processing this request is not supplied',
    };
  }
  if (/param0.+not supplied/i.test(message)) {
    return {
      code: 'MISSING_PARAM0',
      alibaba: true,
      status: 502,
      message: message || 'The input parameter “param0” that is mandatory for processing this request is not supplied',
    };
  }
  if (/[“"]index[”"].+not supplied/i.test(message)) {
    return {
      code: 'MISSING_INDEX',
      alibaba: true,
      status: 502,
      message: message || 'The input parameter “index” that is mandatory for processing this request is not supplied',
    };
  }
  if (/[“"]keyword[”"].+not supplied/i.test(message)) {
    return {
      code: 'MISSING_KEYWORD',
      alibaba: true,
      status: 502,
      message: message || 'The input parameter “keyword” that is mandatory for processing this request is not supplied',
    };
  }
  if (/mandatory for processing this request is not supplied/i.test(message)) {
    return {
      code: 'MISSING_PARAMETER',
      alibaba: true,
      status: 502,
      message,
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
  if (error?.code === 'PRODUCT_DATA_INCOMPLETE' || error?.status === 422) {
    return {
      code: error.code || 'PRODUCT_DATA_INCOMPLETE',
      alibaba: false,
      status: error.status || 422,
      message,
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
