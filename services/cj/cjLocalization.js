const { isPrimarilyChinese, isInvalidTranslationText } = require('../../utils/cjCatalogHelpers');

// ─── Cache & état global ────────────────────────────────────────────────────

const translationCache = new Map();

/**
 * Moteur actif : 'mymemory' | 'libretranslate' | 'lingva' | 'none'
 * 'none' = tous les moteurs ont échoué pour cette session.
 */
let _activeEngine = 'mymemory';

// ─── Helpers de détection ───────────────────────────────────────────────────

function looksFrench(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  if (/[àâäéèêëïîôùûüçœ]/i.test(s)) return true;
  return /\b(le|la|les|des|une|un|pour|avec|sans|dans|sur|femme|homme|taille|couleur|noir|blanc|bleu)\b/i.test(s);
}

function looksEnglish(text) {
  const s = String(text || '').trim();
  if (!s || looksFrench(s) || isPrimarilyChinese(s)) return false;
  return /\b(the|and|for|with|women|men|size|color|black|white|blue|shirt|dress|shoes|bag|pack|set|kit|pro|new|hot|free|mini|case|top|best|sale)\b/i.test(s)
    || /\b[a-z]{5,}\b/i.test(s);
}

function isMyMemoryQuotaError(text) {
  const upper = String(text || '').toUpperCase();
  return (
    upper.includes('YOU USED ALL AVAILABLE FREE TRANSLATIONS')
    || upper.includes('MYMEMORY WARNING')
    || upper.includes('USAGE LIMITS')
    || upper.includes('TO TRANSLATE MORE')
    || upper.includes('FREE TRANSLATION')
    || upper.includes('MYMEMORY')
    || upper.includes('TRANSLATED.NET')
  );
}

// ─── Config moteurs depuis .env ─────────────────────────────────────────────

function getEngineConfig() {
  return {
    mymemory: {
      apiKey: (process.env.MYMEMORY_API_KEY || '').trim(),
      enabled: true,
    },
    google: {
      enabled: process.env.GOOGLE_GTX_ENABLED !== 'false',
    },
    libretranslate: {
      url: (process.env.LIBRETRANSLATE_URL || 'https://libretranslate.de').replace(/\/$/, ''),
      apiKey: (process.env.LIBRETRANSLATE_API_KEY || '').trim(),
      enabled: Boolean((process.env.LIBRETRANSLATE_URL || '').trim() || (process.env.LIBRETRANSLATE_API_KEY || '').trim()),
    },
    lingva: {
      url: (process.env.LINGVA_URL || 'https://lingva.ml').replace(/\/$/, ''),
      enabled: process.env.LINGVA_ENABLED === 'true',
    },
  };
}

// ─── Moteurs de traduction ───────────────────────────────────────────────────

async function fetchFromMyMemory(chunk, langpair) {
  const config = getEngineConfig().mymemory;
  let url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${langpair}`;
  if (config.apiKey) url += `&key=${encodeURIComponent(config.apiKey)}`;
  let data;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    data = await response.json();
  } catch (networkErr) {
    console.warn('[cjLocalization/mymemory] Reseau/timeout:', networkErr.message);
    return { text: '', quotaExceeded: false };
  }
  const responseStatus = data && data.responseStatus;
  const translatedStr = String((data && data.responseData && data.responseData.translatedText) || '').trim();
  const isQuota = responseStatus === 429 || responseStatus === 403
    || responseStatus === '429' || responseStatus === '403'
    || isMyMemoryQuotaError(translatedStr);
  if (isQuota) {
    console.warn('[cjLocalization] MyMemory quota depasse (status=%s). Passage au moteur suivant.', responseStatus);
    return { text: '', quotaExceeded: true };
  }
  if (!translatedStr || isInvalidTranslationText(translatedStr) || translatedStr.toUpperCase().includes('QUERY LENGTH')) {
    return { text: '', quotaExceeded: false };
  }
  return { text: translatedStr, quotaExceeded: false };
}

async function fetchFromGoogleGtx(chunk, sourceLang) {
  const src = sourceLang === 'zh-CN' ? 'zh-CN' : 'en';
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${src}&tl=fr&dt=t&q=${encodeURIComponent(chunk)}`;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      console.warn('[cjLocalization/google-gtx] HTTP error %d', response.status);
      return '';
    }
    const data = await response.json();
    if (Array.isArray(data) && Array.isArray(data[0])) {
      const translatedText = data[0].map((item) => (item && item[0]) || '').join('');
      if (translatedText && !isInvalidTranslationText(translatedText)) {
        return translatedText.trim();
      }
    }
    return '';
  } catch (err) {
    console.warn('[cjLocalization/google-gtx] Erreur/timeout:', err.message);
    return '';
  }
}

async function fetchFromLibreTranslate(chunk, sourceLang) {
  const config = getEngineConfig().libretranslate;
  if (!config.enabled) return '';
  const source = sourceLang === 'zh-CN' ? 'zh' : sourceLang;
  const body = { q: chunk, source, target: 'fr', format: 'text' };
  if (config.apiKey) body.api_key = config.apiKey;
  try {
    const response = await fetch(`${config.url}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      if (response.status === 429 || response.status === 403 || response.status === 400) {
        console.warn('[cjLocalization/libretranslate] Service non disponible (%d) sur %s. Passage au moteur suivant.', response.status, config.url);
        return null;
      }
      const errBody = await response.text().catch(() => '');
      console.warn('[cjLocalization/libretranslate] Erreur %d: %s', response.status, errBody.slice(0, 120));
      return '';
    }
    const data = await response.json();
    const translated = String((data && data.translatedText) || '').trim();
    if (!translated || isInvalidTranslationText(translated)) return '';
    return translated;
  } catch (err) {
    console.warn('[cjLocalization/libretranslate] Reseau/timeout:', err.message);
    return '';
  }
}

async function fetchFromLingva(chunk, sourceLang) {
  const config = getEngineConfig().lingva;
  if (!config.enabled) return '';
  const source = sourceLang === 'zh-CN' ? 'zh' : sourceLang;
  const encoded = encodeURIComponent(chunk);
  try {
    const response = await fetch(
      `${config.url}/api/v1/${source}/fr/${encoded}`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (!response.ok) {
      if (response.status === 429 || response.status === 503 || response.status === 403) {
        console.warn('[cjLocalization/lingva] Instance %s non accessible (%d).', config.url, response.status);
        return null;
      }
      console.warn('[cjLocalization/lingva] Erreur %d sur %s', response.status, config.url);
      return '';
    }
    const data = await response.json();
    const translated = String((data && data.translation) || '').trim();
    if (!translated || isInvalidTranslationText(translated)) return '';
    return translated;
  } catch (err) {
    console.warn('[cjLocalization/lingva] Reseau/timeout:', err.message);
    return '';
  }
}

// ─── Orchestrateur en cascade ───────────────────────────────────────────────

async function translateChunkCascade(chunk, srcLang) {
  if (_activeEngine === 'none') return chunk;

  if (_activeEngine === 'mymemory') {
    const langpair = srcLang === 'zh-CN' ? 'zh-CN|fr' : 'en|fr';
    const { text, quotaExceeded } = await fetchFromMyMemory(chunk, langpair);
    if (!quotaExceeded && text) return text;
    if (quotaExceeded) {
      console.warn('[cjLocalization] Basculement MyMemory -> Google Translate (GTX)');
      _activeEngine = 'google';
    } else {
      return chunk;
    }
  }

  if (_activeEngine === 'google') {
    const result = await fetchFromGoogleGtx(chunk, srcLang);
    if (result) return result;
    console.warn('[cjLocalization] Google GTX indisponible. Passage aux alternatives secondaires.');
    _activeEngine = 'libretranslate';
  }

  if (_activeEngine === 'libretranslate') {
    const result = await fetchFromLibreTranslate(chunk, srcLang);
    if (result === null || !result) {
      _activeEngine = 'lingva';
    } else {
      return result;
    }
  }

  if (_activeEngine === 'lingva') {
    const result = await fetchFromLingva(chunk, srcLang);
    if (result === null || !result) {
      console.warn('[cjLocalization] Tous les moteurs de traduction sont indisponibles. Texte original conserve.');
      _activeEngine = 'none';
      return chunk;
    }
    return result;
  }

  return chunk;
}

// ─── Traduction principale ───────────────────────────────────────────────────

async function translateToFr(text) {
  const source = String(text || '').trim();
  if (!source || source.length < 2 || isInvalidTranslationText(source)) return source;
  if (looksFrench(source) && !isPrimarilyChinese(source)) return source;
  if (_activeEngine === 'none') return source;

  if (translationCache.has(source)) {
    const cached = translationCache.get(source);
    return isInvalidTranslationText(cached) ? source : cached;
  }

  const srcLang = isPrimarilyChinese(source) ? 'zh-CN' : 'en';
  const chunks = [];
  for (let i = 0; i < source.length; i += 450) {
    chunks.push(source.slice(i, i + 450));
  }

  try {
    const parts = [];
    for (const chunk of chunks) {
      const translated = await translateChunkCascade(chunk, srcLang);
      parts.push(translated || chunk);
    }
    const cleaned = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (cleaned && cleaned !== source && !isInvalidTranslationText(cleaned)) {
      translationCache.set(source, cleaned);
      return cleaned;
    }
  } catch (_err) {
    /* garder l'original */
  }
  return source;
}

// ─── Gestion des moteurs ─────────────────────────────────────────────────────

function resetEngineState() {
  _activeEngine = 'mymemory';
  console.info('[cjLocalization] Moteur de traduction reinitialise -> MyMemory');
}

function getTranslationEngineStatus() {
  const config = getEngineConfig();
  return {
    activeEngine: _activeEngine,
    quotaExceeded: _activeEngine !== 'mymemory',
    allEnginesFailed: _activeEngine === 'none',
    engines: {
      mymemory: { active: _activeEngine === 'mymemory', hasApiKey: Boolean(config.mymemory.apiKey) },
      google: { active: _activeEngine === 'google', enabled: config.google.enabled },
      libretranslate: { active: _activeEngine === 'libretranslate', enabled: config.libretranslate.enabled, url: config.libretranslate.url },
      lingva: { active: _activeEngine === 'lingva', enabled: config.lingva.enabled, url: config.lingva.url },
    },
  };
}

function isQuotaExceeded() {
  return _activeEngine !== 'mymemory';
}

function resetQuotaFlag() {
  resetEngineState();
}

// ─── API catalogue ───────────────────────────────────────────────────────────

async function maybeTranslateCatalogText(text, { forImport = false } = {}) {
  const { cjConfig } = require('../../config/cj');
  const source = String(text || '').trim();
  if (!source || isInvalidTranslationText(source)) return source;
  if (!cjConfig.translateToFr) return source;
  if (looksFrench(source) && !isPrimarilyChinese(source)) return source;

  if (forImport) {
    if (isPrimarilyChinese(source) || looksEnglish(source) || !looksFrench(source)) {
      return translateToFr(source);
    }
    return source;
  }

  return source;
}

async function translateCatalogTextForImport(text) {
  return maybeTranslateCatalogText(text, { forImport: true });
}

async function translateCatalogProductFields(input) {
  const inp = input || {};
  const specifications = Array.isArray(inp.specifications) ? inp.specifications : [];
  const variants = Array.isArray(inp.variants) ? inp.variants : [];
  return {
    name: await translateCatalogTextForImport(inp.name),
    shortDescription: await translateCatalogTextForImport(inp.shortDescription),
    description: await translateCatalogTextForImport(inp.description),
    category: await translateCatalogTextForImport(inp.category),
    subCategory: await translateCatalogTextForImport(inp.subCategory),
    shippingInfo: await translateCatalogTextForImport(inp.shippingInfo),
    specifications: await Promise.all(specifications.map(async (row) => ({
      ...(row && typeof row === 'object' ? row : { value: row }),
      key: await translateCatalogTextForImport(row && row.key),
      value: await translateCatalogTextForImport(row && row.value),
    }))),
    variants: await Promise.all(variants.map(async (variant) => {
      const raw = variant && typeof variant.toObject === 'function' ? variant.toObject() : Object.assign({}, variant);
      return {
        ...raw,
        name: await translateCatalogTextForImport(raw.name),
      };
    })),
  };
}

async function applyCatalogTranslationToProduct(product) {
  const fields = await translateCatalogProductFields(product);
  product.name = fields.name;
  product.shortDescription = fields.shortDescription;
  product.description = fields.description;
  if (fields.category) product.category = fields.category;
  product.subCategory = fields.subCategory;
  if (fields.shippingInfo) product.shippingInfo = fields.shippingInfo;
  if (fields.specifications.length) product.specifications = fields.specifications;
  if (fields.variants.length) product.variants = fields.variants;
  return product;
}

module.exports = {
  maybeTranslateCatalogText,
  translateCatalogTextForImport,
  translateCatalogProductFields,
  applyCatalogTranslationToProduct,
  translateToFr,
  looksFrench,
  isQuotaExceeded,
  resetQuotaFlag,
  resetEngineState,
  getTranslationEngineStatus,
};
