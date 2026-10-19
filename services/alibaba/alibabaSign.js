const crypto = require('crypto');

function signIop(apiPath, params, secret) {
  const keys = Object.keys(params)
    .filter((key) => key !== 'sign' && params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort();
  let assembled = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  keys.forEach((key) => {
    assembled += `${key}${params[key]}`;
  });
  return crypto.createHmac('sha256', secret).update(assembled, 'utf8').digest('hex').toUpperCase();
}

module.exports = { signIop };
