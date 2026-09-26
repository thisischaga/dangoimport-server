const { isPrimarilyChinese } = require('../../utils/cjCatalogHelpers');

const translationCache = new Map();

async function translateToFr(text) {
  const source = String(text || '').trim();
  if (!source || source.length < 2) return source;
  if (translationCache.has(source)) return translationCache.get(source);

  const chunk = source.slice(0, 450);
  const langpair = isPrimarilyChinese(source) ? 'zh-CN|fr' : 'en|fr';
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${langpair}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const data = await response.json();
    const translated = data?.responseData?.translatedText;
    if (translated && typeof translated === 'string' && !translated.toUpperCase().includes('QUERY LENGTH')) {
      const cleaned = translated.trim();
      if (cleaned && cleaned !== source) {
        translationCache.set(source, cleaned);
        return cleaned;
      }
    }
  } catch {
    /* garder l’original */
  }
  return source;
}

async function maybeTranslateCatalogText(text) {
  const { cjConfig } = require('../../config/cj');
  const source = String(text || '').trim();
  if (!source) return source;
  if (!cjConfig.translateToFr) return source;
  if (!isPrimarilyChinese(source) && /^[\x00-\x7F\s]+$/.test(source)) {
    return translateToFr(source);
  }
  if (isPrimarilyChinese(source)) {
    return translateToFr(source);
  }
  return translateToFr(source);
}

module.exports = {
  maybeTranslateCatalogText,
  translateToFr,
};
