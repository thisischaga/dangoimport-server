function resolveShipFromAreaCode(product = {}) {
  return String(product?.supplier?.shipFromCountryCode || 'CN').trim().toUpperCase().slice(0, 2) || 'CN';
}

/**
 * Regroupement identique au fret CJ : une expédition par origine (srcAreaCode).
 */
function groupDropshippingLinesByOrigin(lines = []) {
  const byOrigin = new Map();
  for (const line of lines) {
    const product = line.product || line;
    const srcAreaCode = line.srcAreaCode || resolveShipFromAreaCode(product);
    if (!byOrigin.has(srcAreaCode)) byOrigin.set(srcAreaCode, []);
    byOrigin.get(srcAreaCode).push(line);
  }
  return byOrigin;
}

module.exports = {
  resolveShipFromAreaCode,
  groupDropshippingLinesByOrigin,
};
