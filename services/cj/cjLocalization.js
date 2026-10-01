const { isPrimarilyChinese, isInvalidTranslationText } = require('../../utils/cjCatalogHelpers');

const translationCache = new Map();

/** Indique si MyMemory a refusé une requête pour cause de quota dépassé lors de cette session. */
let _quotaExceeded = false;

function looksFrench(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  if (/[àâäéèêëïîôùûüçœ]/i.test(s)) return true;
  return /\b(le|la|les|des|une|un|pour|avec|sans|dans|sur|femme|homme|taille|couleur|noir|blanc|bleu)\b/i.test(s);
}

function looksEnglish(text) {
  const s = String(text || '').trim();
  if (!s || looksFrench(s) || isPrimarilyChinese(s)) return false;
  // Recherche de mots anglais courants pour éviter les faux positifs sur des codes/SKU
  return /\b(the|and|for|with|women|men|size|color|black|white|blue|shirt|dress|shoes|bag|pack|set|kit|pro|new|hot|free|mini|case|top|best|sale)\b/i.test(s)
    || /\b[a-z]{5,}\b/i.test(s); // Au moins 5 lettres consécutives (évite les SKU/acronymes courts)
}

/**
 * Détecte si un message de réponse MyMemory indique un dépassement de quota.
 * @param {string} text
 * @returns {boolean}
 */
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

/**
 * Appelle MyMemory pour traduire un chunk de texte.
 * @returns {{ text: string, quotaExceeded: boolean }}
 */
async function fetchTranslation(chunk, langpair) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${langpair}`;
  let data;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    data = await response.json();
  } catch (networkErr) {
    // Erreur réseau / timeout — on ne marque PAS le quota comme dépassé
    console.warn('[cjLocalization] MyMemory réseau/timeout:', networkErr.message);
    return { text: '', quotaExceeded: false };
  }

  // Vérifier le code de réponse MyMemory (200 = OK, 429/403 = quota)
  const responseStatus = data?.responseStatus;
  const translated = data?.responseData?.translatedText;
  const translatedStr = String(translated || '').trim();

  // Quota dépassé : code 429/403 ou message d'erreur dans le texte traduit
  if (
    responseStatus === 429
    || responseStatus === 403
    || responseStatus === '429'
    || responseStatus === '403'
    || isMyMemoryQuotaError(translatedStr)
    || isInvalidTranslationText(translatedStr)
    || translatedStr.toUpperCase().includes('QUERY LENGTH')
  ) {
    const isQuota = responseStatus === 429 || responseStatus === 403
      || responseStatus === '429' || responseStatus === '403'
      || isMyMemoryQuotaError(translatedStr);
    if (isQuota) {
      console.warn(
        '[cjLocalization] ⚠️  Quota MyMemory dépassé (responseStatus=%s). '
        + 'Les traductions sont suspendues pour cette session. '
        + 'Relancez le serveur demain ou utilisez une clé API MyMemory.',
        responseStatus,
      );
    }
    return { text: '', quotaExceeded: isQuota };
  }

  if (!translatedStr) return { text: '', quotaExceeded: false };
  return { text: translatedStr, quotaExceeded: false };
}

async function translateToFr(text) {
  const source = String(text || '').trim();
  if (!source || source.length < 2 || isInvalidTranslationText(source)) return source;
  if (looksFrench(source) && !isPrimarilyChinese(source)) return source;
  if (translationCache.has(source)) {
    const cached = translationCache.get(source);
    return isInvalidTranslationText(cached) ? source : cached;
  }

  // Si le quota est déjà dépassé pour cette session, ne pas appeler l'API
  if (_quotaExceeded) {
    return source;
  }

  const langpair = isPrimarilyChinese(source) ? 'zh-CN|fr' : 'en|fr';
  const chunks = [];
  for (let i = 0; i < source.length; i += 450) {
    chunks.push(source.slice(i, i + 450));
  }

  try {
    const parts = [];
    for (const chunk of chunks) {
      const { text: translated, quotaExceeded } = await fetchTranslation(chunk, langpair);
      if (quotaExceeded) {
        _quotaExceeded = true;
        return source; // Arrêter immédiatement, quota dépassé
      }
      parts.push(translated || chunk);
    }
    const cleaned = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (cleaned && cleaned !== source && !isInvalidTranslationText(cleaned)) {
      translationCache.set(source, cleaned);
      return cleaned;
    }
  } catch {
    /* garder l'original */
  }
  return source;
}

/**
 * Réinitialise le flag de quota dépassé (à appeler au démarrage du serveur ou pour les tests).
 */
function resetQuotaFlag() {
  _quotaExceeded = false;
}

/** Retourne true si MyMemory a renvoyé une erreur de quota pendant cette session. */
function isQuotaExceeded() {
  return _quotaExceeded;
}

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

  // Hors import admin : ne jamais appeler l’API de traduction.
  return source;
}

async function translateCatalogTextForImport(text) {
  return maybeTranslateCatalogText(text, { forImport: true });
}

async function translateCatalogProductFields(input = {}) {
  const specifications = Array.isArray(input.specifications) ? input.specifications : [];
  const variants = Array.isArray(input.variants) ? input.variants : [];
  return {
    name: await translateCatalogTextForImport(input.name),
    shortDescription: await translateCatalogTextForImport(input.shortDescription),
    description: await translateCatalogTextForImport(input.description),
    category: await translateCatalogTextForImport(input.category),
    subCategory: await translateCatalogTextForImport(input.subCategory),
    shippingInfo: await translateCatalogTextForImport(input.shippingInfo),
    specifications: await Promise.all(specifications.map(async (row) => ({
      ...(row && typeof row === 'object' ? row : { value: row }),
      key: await translateCatalogTextForImport(row?.key),
      value: await translateCatalogTextForImport(row?.value),
    }))),
    variants: await Promise.all(variants.map(async (variant) => {
      const raw = variant && typeof variant.toObject === 'function' ? variant.toObject() : { ...variant };
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
};
