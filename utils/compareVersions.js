function parseVersion(value) {
  return String(value || '0.0.0')
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((part) => Number(part.replace(/\D.*$/, '')) || 0);
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  const length = Math.max(a.length, b.length);

  for (let i = 0; i < length; i += 1) {
    const da = a[i] || 0;
    const db = b[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }

  return 0;
}

module.exports = {
  compareVersions,
};
