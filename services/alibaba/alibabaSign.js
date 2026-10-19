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

function signTopHmacMd5(params, secret) {
  const keys = Object.keys(params)
    .filter((key) => key !== 'sign' && params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort();
  let assembled = '';
  keys.forEach((key) => {
    assembled += `${key}${params[key]}`;
  });
  return crypto.createHmac('md5', secret).update(assembled, 'utf8').digest('hex').toUpperCase();
}

function gmtPlus8Timestamp() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const cst = new Date(utc + 8 * 3600000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${cst.getFullYear()}-${pad(cst.getMonth() + 1)}-${pad(cst.getDate())} ${pad(cst.getHours())}:${pad(cst.getMinutes())}:${pad(cst.getSeconds())}`;
}

module.exports = { signIop, signTopHmacMd5, gmtPlus8Timestamp };
