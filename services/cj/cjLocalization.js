const { isPrimarilyChinese, isInvalidTranslationText } = require('../../utils/cjCatalogHelpers');

const translationCache = new Map();

function looksFrench(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  if (/[àâäéèêëïîôùûüçœ]/i.test(s)) return true;
  return /\b(le|la|les|des|une|un|pour|avec|sans|dans|sur|femme|homme|taille|couleur|noir|blanc|bleu)\b/i.test(s);
}

function looksEnglish(text) {
  const s = String(text || '').trim();
  if (!s || looksFrench(s) || isPrimarilyChinese(s)) return false;
  return /\b(the|and|for|with|women|men|size|color|black|white|blue|shirt|dress|shoes|bag)\b/i.test(s)
    || /[a-z]{4,}/i.test(s);
}

async function fetchTranslation(chunk, langpair) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${langpair}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  const data = await response.json();
  const translated = data?.responseData?.translatedText;
  if (!translated || typeof translated !== 'string') return '';
  const cleaned = translated.trim();
  if (
    !cleaned
    || isInvalidTranslationText(cleaned)
    || cleaned.toUpperCase().includes('QUERY LENGTH')
  ) {
    return '';
  }
  return cleaned;
}

async function translateToFr(text) {
  const source = String(text || '').trim();
  if (!source || source.length < 2 || isInvalidTranslationText(source)) return source;
  if (looksFrench(source) && !isPrimarilyChinese(source)) return source;
  if (translationCache.has(source)) {
    const cached = translationCache.get(source);
    return isInvalidTranslationText(cached) ? source : cached;
  }

  const langpair = isPrimarilyChinese(source) ? 'zh-CN|fr' : 'en|fr';
  const chunks = [];
  for (let i = 0; i < source.length; i += 450) {
    chunks.push(source.slice(i, i + 450));
  }

  try {
    const parts = [];
    for (const chunk of chunks) {
      const translated = await fetchTranslation(chunk, langpair);
      parts.push(translated || chunk);
    }
    const cleaned = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (cleaned && cleaned !== source && !isInvalidTranslationText(cleaned)) {
      translationCache.set(source, cleaned);
      return cleaned;
    }
  } catch {
    /* garder l’original */
  }
  return source;
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
};
