const translationCache = new Map();

async function translateEnToFr(text) {
  const source = String(text || '').trim();
  if (!source || source.length < 2) return source;
  if (translationCache.has(source)) return translationCache.get(source);

  const chunk = source.slice(0, 450);
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=en|fr`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await response.json();
    const translated = data?.responseData?.translatedText;
    if (translated && typeof translated === 'string' && !translated.toUpperCase().includes('QUERY LENGTH')) {
      translationCache.set(source, translated);
      return translated;
    }
  } catch {
    /* garder l’original */
  }
  return source;
}

async function maybeTranslateCatalogText(text) {
  const { cjConfig } = require('../../config/cj');
  if (!cjConfig.translateToFr) return String(text || '').trim();
  return translateEnToFr(text);
}

module.exports = {
  maybeTranslateCatalogText,
  translateEnToFr,
};
