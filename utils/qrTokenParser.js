/**
 * Normalise la donnée lue depuis un QR code (hex brut, URL, JSON).
 */
function extractQrToken(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      return String(parsed.token || parsed.code || parsed.qrCode || parsed.qrToken || '').trim();
    } catch {
      // ignore malformed JSON
    }
  }

  if (/^https?:\/\//i.test(trimmed) || trimmed.includes('?')) {
    try {
      const url = new URL(trimmed.startsWith('http') ? trimmed : `https://local${trimmed.startsWith('/') ? '' : '/'}${trimmed}`);
      const fromQuery = url.searchParams.get('token')
        || url.searchParams.get('code')
        || url.searchParams.get('qrCode')
        || url.searchParams.get('qr');
      if (fromQuery) return String(fromQuery).trim();
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length) return String(parts[parts.length - 1]).trim();
    } catch {
      // ignore malformed URL
    }
  }

  return trimmed;
}

module.exports = { extractQrToken };
