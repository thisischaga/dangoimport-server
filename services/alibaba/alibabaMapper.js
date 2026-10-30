const slugify = require('slugify');
const { alibabaConfig, convertCnyToUsd } = require('../../config/alibaba');
const { calculateMargin, toNumber, applyProductMarkup } = require('../../utils/dropshippingCalculations');
const { DEFAULT_IMPORT_PRICING } = require('../../config/importPricing');
const { inferShippingCategory, parseWeightToKg } = require('../../utils/importPricing');
const { translateCatalogTextForImport } = require('../cj/cjLocalization');
const { extractImages, extractAlibabaSpecifications } = require('./alibabaProductService');

function convertUsdPriceToXof(amountUsd) {
  const usd = Number(amountUsd) || 0;
  if (usd <= 0) return 0;
  return Math.round(usd * 655);
}

function isInvalidTranslationText(text) {
  if (!text || typeof text !== 'string') return true;
  const t = text.trim();
  if (!t) return true;
  return /^(undefined|null|none|n\/a)$/i.test(t);
}

const DANGO_STORE_CATEGORIES = [
  'Montres', 'Électronique', 'Beauté', 'Vêtements',
  'Accessoires', 'Maison', 'Sport', 'Alimentation', 'Parfum', 'Evènement',
];

function mapAlibabaCategoryToDangoStore(rawCategory, title = '') {
  const raw = (typeof rawCategory === 'object' && rawCategory !== null)
    ? (rawCategory.name || rawCategory.category_name || rawCategory.categoryName || '')
    : String(rawCategory || '').trim();

  const combined = `${raw} ${title}`.toLowerCase();

  if (/montre|smartwatch|watch\b|horlog/i.test(combined)) return 'Montres';
  if (/electronic|téléphone|phone|smartphone|tablette|tablet|computer|laptop|ordinateur|audio|écouteur|earphone|headphone|bluetooth|speaker|câble|cable|chargeur|charger|caméra|camera|gadget/i.test(combined)) {
    return 'Électronique';
  }
  if (/beauté|beauty|cosmetic|cosmétique|skin|maquillage|makeup|cheveux|hair|soin|creme|cream|hygiène/i.test(combined)) {
    return 'Beauté';
  }
  if (/parfum|perfume|fragrance|eau de toilette|eau de parfum/i.test(combined)) {
    return 'Parfum';
  }
  if (/sport|fitness|running|gym|yoga|cycling|vélo|musculation|water bottle|gourde|bouteille de sport|outdoor/i.test(combined)) {
    return 'Sport';
  }
  if (/vêtement|clothing|apparel|robe|dress|pantalon|pants|t-shirt|tee|chemise|shirt|veste|jacket|manteau|coat|hoodie|pull|sweater|sweat|chaussette|sock|sous-vêtement|underwear/i.test(combined)) {
    return 'Vêtements';
  }
  if (/maison|home|kitchen|cuisine|jardin|garden|furniture|meuble|décor|decor|tableware|vaisselle|mug|tasse|verre|glass|bouteille|bottle|rangement|bain|bathroom/i.test(combined)) {
    return 'Maison';
  }
  if (/chaussure|shoe|sneaker|basket|sandale|sandal|botte|boot|sac|bag|sacoche|wallet|portefeuille|bijou|jewel|collier|necklace|bague|ring|ceinture|belt|chapeau|hat|casquette|cap|lunette|sunglass/i.test(combined)) {
    return 'Accessoires';
  }
  if (/aliment|food|thé|tea|café|coffee|snack|épice|boisson|beverage/i.test(combined)) {
    return 'Alimentation';
  }
  if (/fête|party|mariage|wedding|event|anniversaire|décoration fête/i.test(combined)) {
    return 'Evènement';
  }

  const directMatch = DANGO_STORE_CATEGORIES.find((cat) => combined.includes(cat.toLowerCase()));
  if (directMatch) return directMatch;

  return 'Accessoires';
}

function cleanAlibabaDescription(raw, title = '', specifications = []) {
  if (!raw || typeof raw !== 'string') {
    return buildFallbackDescription(title, specifications);
  }

  const cutAtCompanySection = (value) => {
    const markers = [
      /produits?\s+connexes?/i,
      /related\s+products?/i,
      /présentation\s+de\s+la\s+société/i,
      /profil\s+de\s+l['’]entreprise/i,
      /company\s+profile/i,
      /about\s+us/i,
      /our\s+company/i,
      /who\s+we\s+are/i,
      /why\s+choose\s+us/i,
      /why\s+choose\s+our\s+company/i,
      /entreprise\s+individuelle/i,
      /fondée\s+en\s+\d{4}/i,
      /notre\s+entreprise/i,
      /notre\s+société/i,
    ];

    for (const marker of markers) {
      const match = value.match(marker);
      if (match && match.index != null) {
        const cutValue = value.slice(0, match.index).trim();
        if (cutValue.length >= 25) return cutValue;
      }
    }

    const splitIndex = value.search(/\s[*•·]\s*(?:présentation|profil|company|about|why\s+choose|who\s+we)/i);
    if (splitIndex >= 0) {
      const cutValue = value.slice(0, splitIndex).trim();
      if (cutValue.length >= 25) return cutValue;
    }

    return value;
  };

  let text = raw;
  // 1. Supprimer le contenu CSS complet dans les balises <style> et <script>
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  // 2. Supprimer les blocs de style CSS Alibaba (#detail_decorate_root, @media, classes magic)
  text = text.replace(/#detail_decorate_root[\s\S]*?\{[\s\S]*?\}/gi, ' ');
  text = text.replace(/@media[\s\S]*?\{[\s\S]*?\}/gi, ' ');
  text = text.replace(/\{[^{}]*\}/g, ' ');
  text = text.replace(/#detail_decorate_root[^\s;{}]*/gi, ' ');
  text = text.replace(/\.magic-\d+[^\s;{}]*/gi, ' ');
  // 3. Supprimer les balises HTML restantes
  text = text.replace(/<[^>]+>/g, ' ');
  // 4. Décoder les entités HTML
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');
  // 5. Nettoyer les espaces multiples
  text = text.replace(/\s+/g, ' ').trim();
  text = cutAtCompanySection(text)
    .replace(/^\s*description\s+du\s+produit\s*[:*\-–]*/i, '')
    .replace(/^\s*produits?\s+connexes?\s*[:*\-–]*/i, '')
    .replace(/^\s*related\s+products?\s*[:*\-–]*/i, '')
    .replace(/^\s*[\*•·\-–]+\s*/, '')
    .trim();
  // 6. Si le texte résultant est vide ou est un fragment CSS résiduel
  if (
    text.length < 25
    || /^([#\.\w\-\s,>:+*]+;)+$/.test(text)
    || text.includes('#detail_decorate_root')
    || text.includes('.magic-')
    || /\{[a-z\-]+:[^}]+\}/i.test(text)
    || /border-(?:bottom|top|left|right)|padding-(?:top|bottom)|margin-(?:top|bottom)/i.test(text)
  ) {
    return buildFallbackDescription(title, specifications);
  }
  return text.slice(0, 4000);
}

function buildFallbackDescription(title = '', specifications = []) {
  const parts = [];
  if (title) parts.push(title.trim());
  if (Array.isArray(specifications) && specifications.length) {
    const specsList = specifications
      .slice(0, 8)
      .map((s) => `${s.key} : ${s.value}`)
      .join(' · ');
    if (specsList) parts.push(`Caractéristiques : ${specsList}.`);
  }
  return parts.join(' - ') || 'Produit de qualité supérieure importé depuis Alibaba.';
}

const ATTR_TRANSLATIONS = {
  color: 'Couleur',
  colour: 'Couleur',
  capacity: 'Capacité',
  volume: 'Volume',
  material: 'Matériau',
  materials: 'Matériaux',
  size: 'Taille',
  dimensions: 'Dimensions',
  dimension: 'Dimensions',
  weight: 'Poids',
  brand: 'Marque',
  brand_name: 'Marque',
  model: 'Modèle',
  model_number: 'Numéro de modèle',
  feature: 'Fonctionnalité',
  features: 'Fonctionnalités',
  function: 'Fonction',
  certification: 'Certification',
  certifications: 'Certifications',
  origin: 'Origine',
  place_of_origin: "Lieu d'origine",
  package: 'Emballage',
  packaging: 'Emballage',
  warranty: 'Garantie',
  gender: 'Genre',
  style: 'Style',
  type: 'Type',
  usage: 'Utilisation',
  application: 'Application',
  pattern: 'Motif',
  season: 'Saison',
  shape: 'Forme',
  drinkware_type: 'Type de récipient',
  plastic_type: 'Type de plastique',
  thermal_insulation_performance: 'Isolation thermique',
  water_flowing_method: "Mode d'écoulement",
  boiling_water: 'Eau bouillante',
  anti_corrosion_coating: 'Revêtement anti-corrosion',
  outdoor_activity: 'Activité de plein air',
};

const COLOR_TRANSLATIONS = {
  black: 'Noir',
  white: 'Blanc',
  red: 'Rouge',
  blue: 'Bleu',
  green: 'Vert',
  yellow: 'Jaune',
  orange: 'Orange',
  purple: 'Violet',
  pink: 'Rose',
  grey: 'Gris',
  gray: 'Gris',
  brown: 'Marron',
  khaki: 'Kaki',
  beige: 'Beige',
  navy: 'Bleu marine',
  'dark blue': 'Bleu foncé',
  'light blue': 'Bleu ciel',
  'army green': 'Vert armée',
  silver: 'Argenté',
  gold: 'Doré',
  coffee: 'Café',
};

function translateVariantText(rawName) {
  if (!rawName || typeof rawName !== 'string') return rawName;
  let text = rawName;
  // Traduire les clés d'attributs standard
  text = text.replace(/\bColor\b/gi, 'Couleur');
  text = text.replace(/\bSize\b/gi, 'Taille');
  text = text.replace(/\bEUR Size\b/gi, 'Pointure');
  // Traduire les couleurs courantes
  Object.entries(COLOR_TRANSLATIONS).forEach(([en, fr]) => {
    const reg = new RegExp(`\\b${en}\\b`, 'gi');
    text = text.replace(reg, fr);
  });
  return text;
}

function buildExternalSourceKey(externalProductId) {
  return `${alibabaConfig.platformKey}:${String(externalProductId).trim()}`;
}

function parseCnyPrice(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  const match = String(value).replace(',', '.').match(/(\d+(\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

function extractSkuInventory(sku) {
  if (!sku || typeof sku !== 'object') return 0;
  return toNumber(
    sku.amountOnSale ?? sku.amount_on_sale
    ?? sku.canBookCount ?? sku.can_book_count
    ?? sku.availableQuantity ?? sku.available_quantity
    ?? sku.inventoryQuantity ?? sku.inventory_quantity
    ?? sku.sku_inventory ?? sku.sku_stock
    ?? sku.inventory ?? sku.stock
    ?? sku.quantity ?? sku.free_inventory ?? sku.total_inventory,
    0,
  );
function extractPriceTiers(source = {}) {
  const rawTiers = Array.isArray(source.ladderPrices) && source.ladderPrices.length
    ? source.ladderPrices
    : Array.isArray(source.ladder_price) && source.ladder_price.length
      ? source.ladder_price
      : Array.isArray(source.wholesaleTrade?.ladder_price) && source.wholesaleTrade.ladder_price.length
        ? source.wholesaleTrade.ladder_price
        : Array.isArray(source.raw?.wholesale_trade?.ladder_price) && source.raw.wholesale_trade.ladder_price.length
          ? source.raw.wholesale_trade.ladder_price
          : Array.isArray(source.raw?.productPrice?.ladder_price) && source.raw.productPrice.ladder_price.length
            ? source.raw.productPrice.ladder_price
            : Array.isArray(source.raw?.ladder_price) && source.raw.ladder_price.length
              ? source.raw.ladder_price
              : [];

  let candidateTiers = rawTiers;
  if (!candidateTiers.length && Array.isArray(source.skuInfos)) {
    for (const sku of source.skuInfos) {
      if (Array.isArray(sku.ladder_price) && sku.ladder_price.length) {
        candidateTiers = sku.ladder_price;
        break;
      }
    }
  }

  if (!candidateTiers.length) return [];

  return candidateTiers
    .map((tier) => {
      const minQty = Number(tier.min_quantity ?? tier.minQuantity ?? tier.min_order_quantity ?? tier.start_quantity ?? 1);
      const maxRaw = tier.max_quantity ?? tier.maxQuantity ?? tier.end_quantity;
      const maxQty = (maxRaw !== undefined && maxRaw !== null && Number(maxRaw) > 0) ? Number(maxRaw) : null;
      const price = Number(tier.price ?? tier.consign_price ?? tier.unit_price ?? 0);
      const currency = String(tier.currency || source.currency || 'USD').toUpperCase();
      return {
        minQty: Math.max(1, minQty),
        maxQty,
        price,
        currency,
      };
    })
    .filter((t) => t.price > 0)
    .sort((a, b) => a.minQty - b.minQty);
}

function extractPackageDimensions(source = {}) {
  const rawSize = source.packageSize || source.package_size
    || source.wholesaleTrade?.package_size
    || source.raw?.wholesale_trade?.package_size
    || source.raw?.package_size
    || '';
  if (!rawSize) return { length: null, width: null, height: null, unit: 'cm', formatted: '' };

  const cleaned = String(rawSize).replace(/cm|mm|m/gi, '').trim();
  const match = cleaned.match(/(\d+(?:\.\d+)?)\s*[*x×X]\s*(\d+(?:\.\d+)?)\s*[*x×X]\s*(\d+(?:\.\d+)?)/);
  if (match) {
    return {
      length: Number(match[1]),
      width: Number(match[2]),
      height: Number(match[3]),
      unit: 'cm',
      formatted: `${match[1]} × ${match[2]} × ${match[3]} cm`,
    };
  }
  return { length: null, width: null, height: null, unit: 'cm', formatted: String(rawSize) };
}

function detectSuspiciousStock(stock) {
  const n = Number(stock ?? 0);
  if (n >= 2147483647) {
    return {
      isSuspicious: true,
      verifiedStock: 0,
      rawStock: n,
      reason: 'Plafond technique 2147483647 (Integer.MAX_VALUE) détecté : quantité marquée non vérifiée.',
    };
  }
  if (!Number.isFinite(n) || n < 0) {
    return {
      isSuspicious: true,
      verifiedStock: 0,
      rawStock: n,
      reason: 'Valeur de stock négative ou invalide.',
    };
  }
  return {
    isSuspicious: false,
    verifiedStock: n,
    rawStock: n,
  };
}

function detectMoqConflict(declaredMoq, priceTiers = []) {
  const moq = Number(declaredMoq) || 1;
  if (moq > 1 && priceTiers.length > 0) {
    const firstTierMin = Number(priceTiers[0].minQty) || 1;
    if (firstTierMin < moq) {
      return {
        hasConflict: true,
        declaredMoq: moq,
        tierMinQty: firstTierMin,
        message: `Conflit MOQ : Minimum de commande déclaré (${moq} paires) supérieur au 1er palier de prix (${firstTierMin} paire). Validation requise avant mise en vente.`,
      };
    }
  }
  return { hasConflict: false };
}

function extractOriginAndPort(source = {}) {
  const specs = source.specifications || source.raw?.specifications || [];
  let origin = source.shipFromCountryName || source.raw?.ship_from_country_name || '';
  let port = '';

  const getSpec = (pattern) => {
    const found = specs.find((s) => s && s.key && pattern.test(String(s.key)));
    return found ? String(found.value || '').trim() : '';
  };

  const originSpec = getSpec(/lieu d['’]origine|place of origin|origin|pays d['’]origine/i);
  if (originSpec) origin = originSpec;
  const portSpec = getSpec(/port|port de d[ée]part|shipping port/i);
  if (portSpec) port = portSpec;

  const wt = source.wholesaleTrade || source.raw?.wholesale_trade || {};
  if (wt.port) port = wt.port;

  const label = [origin, port ? `Port de ${port}` : ''].filter(Boolean).join(' · ') || 'Chine';
  return {
    country: 'CN',
    countryName: 'Chine',
    origin: origin || 'Chine',
    port: port || '',
    label,
  };
}

function extractSupplyCapacity(source = {}) {
  const specs = source.specifications || source.raw?.specifications || [];
  const found = specs.find((s) => s && s.key && /capacit[ée] d['’]approvisionnement|supply ability|supply capacity/i.test(String(s.key)));
  if (found && found.value) return String(found.value).trim();
  const wt = source.wholesaleTrade || source.raw?.wholesale_trade || {};
  return wt.supply_ability || wt.supplyAbility || '';
}

function extractBrand(source = {}) {
  if (source.brand) return String(source.brand).trim();
  const specs = source.specifications || source.raw?.specifications || [];
  const found = specs.find((s) => s && s.key && /^marque$|^brand$|^brand_name$/i.test(String(s.key).trim()));
  if (found && found.value) return String(found.value).trim();
  return source.supplierName || source.manufacturerName || '';
}

async function mapAlibabaVariants(skuInfos = [], { skipTranslation = false, productTotalStock = 0 } = {}) {
  const list = Array.isArray(skuInfos) ? skuInfos : [];
  if (!list.length) return [];

  const hasIndividualStock = list.some((sku) => {
    const stock = extractSkuInventory(sku);
    return stock > 0 && stock < 2147483647;
  });
  const baseTotalStock = productTotalStock > 0 && productTotalStock < 2147483647 ? productTotalStock : 0;
  const fallbackPerSku = baseTotalStock > 0 ? Math.max(1, Math.floor(baseTotalStock / list.length)) : 0;

  const results = [];
  for (let index = 0; index < list.length; index++) {
    const sku = list[index];
    const ladderPriceArr = Array.isArray(sku.ladder_price) ? sku.ladder_price : [];
    const ladderMinPrice = ladderPriceArr.length
      ? Math.min(...ladderPriceArr.map((t) => Number(t.price) || 0).filter((p) => p > 0))
      : 0;
    const ladderCurrency = ladderPriceArr[0]?.currency || 'USD';
    const rawPriceValue = Number(sku.price || sku.consignPrice || sku.retailPrice || sku.unit_price || 0) || ladderMinPrice;
    const rawCurrency = sku.currency || ladderCurrency;
    const supplierUsd = String(rawCurrency).toUpperCase() === 'CNY'
      ? convertCnyToUsd(rawPriceValue)
      : rawPriceValue;
    const priceXof = applyProductMarkup(convertUsdPriceToXof(supplierUsd), DEFAULT_IMPORT_PRICING.productMarkupMultiplier);

    const variantAttrs = {
      externalVariantId: String(sku.skuId || sku.sku_id || sku.specId || ''),
    };
    let skuName = sku.name || sku.skuName || sku.attributes?.[0]?.attributeValue || '';
    const parts = [];
    if (Array.isArray(sku.sku_attr_list) && sku.sku_attr_list.length) {
      sku.sku_attr_list.forEach((a) => {
        const keyRaw = (a.attr_name_desc || a.attrNameDesc || a.attr_name || a.attrName || '').toLowerCase();
        const keyFr = ATTR_TRANSLATIONS[keyRaw] || a.attr_name_desc || a.attrNameDesc || '';
        let val = a.attr_value_desc || a.attrValueDesc || a.attr_value || a.attrValue || '';
        const lowerVal = val.toLowerCase();
        if (COLOR_TRANSLATIONS[lowerVal]) val = COLOR_TRANSLATIONS[lowerVal];
        if (keyFr && val) {
          variantAttrs[keyFr] = val;
          if (keyFr === 'Couleur' || keyRaw === 'color' || keyRaw === 'colour') {
            variantAttrs.color = val;
          }
          if (keyFr === 'Taille' || keyRaw === 'size') {
            variantAttrs.size = val;
          }
        }
        if (val) parts.push(val);
      });
    } else if (Array.isArray(sku.attributes) && sku.attributes.length) {
      sku.attributes.forEach((a) => {
        const keyRaw = (a.attributeName || a.attrName || a.name || '').toLowerCase();
        const keyFr = ATTR_TRANSLATIONS[keyRaw] || a.attributeName || a.attrName || a.name || '';
        let val = a.attributeValue || a.attrValue || a.value || '';
        const lowerVal = val.toLowerCase();
        if (COLOR_TRANSLATIONS[lowerVal]) val = COLOR_TRANSLATIONS[lowerVal];
        if (keyFr && val) {
          variantAttrs[keyFr] = val;
          if (keyFr === 'Couleur' || keyRaw === 'color' || keyRaw === 'colour') {
            variantAttrs.color = val;
          }
          if (keyFr === 'Taille' || keyRaw === 'size') {
            variantAttrs.size = val;
          }
        }
        if (val) parts.push(val);
      });
    }
    if (!skuName && parts.length) {
      skuName = parts.join(' · ');
    }
    if (!skuName) skuName = `Variante ${index + 1}`;
    skuName = translateVariantText(skuName)
      .replace(/^couleur\s*:\s*/i, '')
      .replace(/\s*\/\s*capacité\s*:\s*/i, ' · ');

    if (!skipTranslation && skuName) {
      try {
        const translated = await translateCatalogTextForImport(skuName);
        if (translated && !isInvalidTranslationText(translated)) {
          skuName = translated;
        }
      } catch (_e) { /* fallback original */ }
    }

    const rawStock = extractSkuInventory(sku);
    const isStockSuspicious = rawStock >= 2147483647;
    const safeStock = isStockSuspicious ? 0 : rawStock;
    const stock = hasIndividualStock
      ? (safeStock > 0 ? safeStock : (String(sku.status || 'NORMAL').toUpperCase() === 'NORMAL' ? fallbackPerSku : 0))
      : 0;

    results.push({
      name: skuName,
      sku: String(sku.skuId || sku.sku_id || sku.specId || ''),
      sourceSkuId: String(sku.skuId || sku.sku_id || sku.specId || sku.seller_sku_id || ''),
      price: priceXof,
      stock,
      sourcePrice: supplierUsd,
      sourceStock: rawStock,
      sourceStockVerified: !isStockSuspicious && rawStock > 0,
      status: sku.status || 'NORMAL',
      image: sku.skuImageUrl || sku.imageUrl || sku.image || '',
      attributes: variantAttrs,
      supplierPriceCny: String(rawCurrency).toUpperCase() === 'CNY' ? rawPriceValue : 0,
      supplierPriceUsd: supplierUsd,
      isDefault: index === 0,
    });
  }
  return results;
}

async function mapAlibabaProductToDango(listItem = {}, detail = null, { skipTranslation = false } = {}) {
  const source = detail || listItem;
  const externalProductId = String(source.externalProductId || source.offerId || listItem.externalProductId || '').trim();
  const rawCurrency = String(source.currency || source.raw?.price?.currency || source.raw?.currency || 'USD').toUpperCase();
  const rawPrice = parseCnyPrice(source.supplierPrice ?? source.price ?? source.raw?.price?.amount ?? source.raw?.price);

  const skuLadderMin = (() => {
    const skus = source.skuInfos || source.raw?.skuInfos || [];
    const prices = (Array.isArray(skus) ? skus : []).flatMap((sku) => {
      if (Array.isArray(sku.ladder_price)) return sku.ladder_price.map((t) => Number(t.price) || 0);
      return [Number(sku.price || sku.consignPrice || sku.retailPrice || sku.unit_price) || 0];
    }).filter((p) => p > 0);
    return prices.length ? Math.min(...prices) : 0;
  })();
  const effectiveRawPrice = rawPrice || skuLadderMin;
  const supplierUsd = rawCurrency === 'CNY' ? convertCnyToUsd(effectiveRawPrice) : effectiveRawPrice;
  const priceCny = rawCurrency === 'CNY' ? effectiveRawPrice : 0;
  const costPriceXof = convertUsdPriceToXof(supplierUsd);
  const sellingPrice = applyProductMarkup(costPriceXof, DEFAULT_IMPORT_PRICING.productMarkupMultiplier);
  const margin = calculateMargin({
    sellingPrice,
    supplierPrice: costPriceXof,
    supplierShippingCost: 0,
    otherCosts: 0,
  });

  const productTotalStock = toNumber(source.stock, 0);
  const stockAnalysis = detectSuspiciousStock(productTotalStock);
  const warnings = [];
  const errors = [];

  if (stockAnalysis.isSuspicious) {
    warnings.push({
      code: 'SUSPICIOUS_STOCK_MAX_INT',
      message: stockAnalysis.reason,
      field: 'stock',
    });
  }

  const priceTiers = extractPriceTiers(source);
  const declaredMoq = Math.max(1, toNumber(source.minOrderQuantity || source.wholesaleTrade?.min_order_quantity, 1));
  const moqConflict = detectMoqConflict(declaredMoq, priceTiers);
  if (moqConflict.hasConflict) {
    warnings.push({
      code: 'MOQ_PRICE_TIER_CONFLICT',
      message: moqConflict.message,
      field: 'minimumOrderQuantity',
    });
  }

  const dimensions = extractPackageDimensions(source);
  const originInfo = extractOriginAndPort(source);
  const supplyCapacity = extractSupplyCapacity(source);
  const brand = extractBrand(source);

  const variants = await mapAlibabaVariants(source.skuInfos || source.raw?.skuInfos, {
    skipTranslation,
    productTotalStock: stockAnalysis.verifiedStock,
  });
  const stockFromVariants = variants.reduce((sum, v) => sum + toNumber(v.stock, 0), 0);
  const stock = stockFromVariants || stockAnalysis.verifiedStock || 0;

  const images = extractImages(source.raw || source).length
    ? extractImages(source.raw || source)
    : (source.images || []).map((img) => (typeof img === 'string' ? { url: img } : img));
  const primaryImage = images[0]?.url || source.image || '';
  if (!images.length && !primaryImage) {
    errors.push({ code: 'MISSING_IMAGES', message: 'Aucune image exploitable trouvée.', field: 'images' });
  }

  let name = String(source.name || source.subject || `Produit Alibaba ${externalProductId}`).trim();

  let specifications = extractAlibabaSpecifications(source)
    .filter((row) => row && row.key && row.value && !/^marque$/i.test(String(row.key).trim()));
  if (!skipTranslation && specifications.length) {
    specifications = await Promise.all(specifications.map(async (row) => {
      let key = row.key;
      let value = row.value;
      const lowerKey = key.toLowerCase().replace(/[\s-]+/g, '_');
      if (ATTR_TRANSLATIONS[lowerKey]) {
        key = ATTR_TRANSLATIONS[lowerKey];
      } else {
        try {
          const tKey = await translateCatalogTextForImport(key);
          if (tKey && !isInvalidTranslationText(tKey)) key = tKey;
        } catch (_e) {}
      }
      try {
        const tVal = await translateCatalogTextForImport(value);
        if (tVal && !isInvalidTranslationText(tVal)) value = tVal;
      } catch (_e) {}
      return { key, value };
    }));
  }

  let description = cleanAlibabaDescription(source.description || name, name, specifications);

  if (!skipTranslation) {
    try {
      const translatedName = await translateCatalogTextForImport(name);
      if (translatedName && !isInvalidTranslationText(translatedName)) {
        name = translatedName;
      }
    } catch (_e) { /* fallback */ }
    try {
      const translatedDesc = await translateCatalogTextForImport(description);
      if (translatedDesc && !isInvalidTranslationText(translatedDesc)) {
        description = translatedDesc;
      }
    } catch (_e) { /* fallback */ }
  }

  const weightKg = parseWeightToKg(source.weight || source.raw?.productShippingInfo?.weight || source.wholesaleTrade?.weight);
  const weightRaw = weightKg > 0 ? String(weightKg) : '';
  const category = mapAlibabaCategoryToDangoStore(source.category || 'Général', name);

  const productColors = [...new Set(variants.map((v) => v.attributes?.color || v.attributes?.Couleur).filter(Boolean))];
  const productSizes = [...new Set(variants.map((v) => v.attributes?.size || v.attributes?.Taille).filter(Boolean))];

  const rawPayload = source.raw || source.rawAlibabaData || source;
  const productUrl = source.productUrl || `https://www.alibaba.com/product-detail/${externalProductId}.html`;
  const importStatus = errors.length > 0 ? 'SYNC_ERROR' : warnings.length > 0 ? 'TO_VERIFY' : 'IMPORTED';

  return {
    source: 'ALIBABA',
    sourceProductId: externalProductId,
    sourceUrl: productUrl,
    externalProductId,
    externalSourceKey: buildExternalSourceKey(externalProductId),
    name,
    slug: `${slugify(name, { lower: true, strict: true }).slice(0, 80)}-${externalProductId.slice(0, 8)}`,
    description,
    shortDescription: description.slice(0, 220),
    category,
    subCategory: '',
    weight: weightRaw,
    images,
    image: primaryImage,
    variants,
    color: productColors,
    size: productSizes,
    isAlibaba: true,
    fulfillmentPlatform: 'Alibaba',
    specifications,
    brand,
    shippingInfo: 'Frais d\'importation calculés au checkout',
    convertedSupplierPriceFCFA: costPriceXof,
    productMarkupMultiplier: DEFAULT_IMPORT_PRICING.productMarkupMultiplier,
    minimumOrderQuantity: declaredMoq,
    quantityIncrement: 1,
    shippingCategory: inferShippingCategory({ name, category, weight: weightRaw }),
    estimatedImportDays: { min: 20, max: 30 },
    videos: source.videoUrl ? [source.videoUrl] : [],
    rawAlibabaData: rawPayload,
    sourcePriceTiers: priceTiers,
    currency: 'USD',
    sourceInventory: {
      rawStock: productTotalStock,
      verifiedStock: stockAnalysis.verifiedStock,
      isSuspicious: stockAnalysis.isSuspicious,
      unit: source.unit || source.wholesaleTrade?.unit_type || 'paire',
      supplyCapacity,
    },
    shippingOrigin: originInfo,
    dimensions,
    packageSize: dimensions.formatted || source.packageSize || '',
    supplyCapacity,
    importStatus,
    publicationStatus: 'draft',
    importWarnings: warnings,
    importErrors: errors,
    supplier: {
      name: source.supplierName || source.raw?.sellerLoginId || brand || alibabaConfig.supplierName,
      platform: alibabaConfig.platformKey,
      productId: externalProductId,
      productUrl,
      supplierPrice: supplierUsd,
      supplierCurrency: 'USD',
      shippingCost: 0,
      estimatedDeliveryDays: 25,
      lastSyncedAt: new Date(),
      convertedSupplierPriceFCFA: costPriceXof,
      alibabaPriceCny: priceCny,
      eCompanyId: source.eCompanyId || '',
      alibabaCategoryId: source.categoryId || '',
      wholesaleTrade: source.wholesaleTrade || null,
      skus: source.skus || [],
      videoUrl: source.videoUrl || '',
      shipFromCountryName: originInfo.origin || 'Chine',
    },
    pricing: {
      supplierPrice: supplierUsd,
      supplierPriceCny: priceCny,
      sellingPrice,
      currency: 'XOF',
      marginPercent: margin.marginPercent,
      estimatedProfit: margin.estimatedProfit,
    },
    stock,
    importSourceType: 'ALIBABA_API',
  };
}

function mapToDropshippingPayload(mapped, { publish = false } = {}) {
  const canPublish = Boolean(publish)
    && mapped.importStatus !== 'TO_VERIFY'
    && (!mapped.importErrors || mapped.importErrors.length === 0)
    && Number(mapped?.pricing?.sellingPrice || 0) > 0;

  return {
    source: 'ALIBABA',
    sourceProductId: mapped.sourceProductId || mapped.externalProductId,
    sourceUrl: mapped.sourceUrl,
    name: mapped.name,
    slug: mapped.slug,
    description: mapped.description,
    shortDescription: mapped.shortDescription,
    category: mapped.category,
    subCategory: mapped.subCategory,
    price: mapped.pricing.sellingPrice,
    costPrice: mapped.convertedSupplierPriceFCFA,
    stock: mapped.stock,
    weight: mapped.weight || '',
    image: mapped.image,
    images: mapped.images,
    videos: mapped.videos || [],
    variants: mapped.variants,
    color: mapped.color || [],
    size: mapped.size || [],
    isAlibaba: true,
    fulfillmentPlatform: 'Alibaba',
    specifications: mapped.specifications,
    brand: mapped.brand,
    shippingInfo: mapped.shippingInfo,
    importSourceType: 'ALIBABA_API',
    isPublished: canPublish,
    publicationStatus: canPublish ? 'published' : 'draft',
    importStatus: canPublish ? 'PUBLISHED' : (mapped.importStatus || 'IMPORTED'),
    isDropshippingActive: true,
    otherCosts: 0,
    estimatedProfit: mapped.pricing.estimatedProfit,
    marginPercent: mapped.pricing.marginPercent,
    convertedSupplierPriceFCFA: mapped.convertedSupplierPriceFCFA,
    productMarkupMultiplier: mapped.productMarkupMultiplier,
    shippingCategory: mapped.shippingCategory || 'normal',
    estimatedImportDays: mapped.estimatedImportDays,
    minimumOrderQuantity: mapped.minimumOrderQuantity,
    quantityIncrement: mapped.quantityIncrement,
    rawAlibabaData: mapped.rawAlibabaData,
    sourcePriceTiers: mapped.sourcePriceTiers || [],
    currency: mapped.currency || 'USD',
    sourceInventory: mapped.sourceInventory,
    shippingOrigin: mapped.shippingOrigin,
    dimensions: mapped.dimensions,
    packageSize: mapped.packageSize || '',
    supplyCapacity: mapped.supplyCapacity || '',
    importWarnings: mapped.importWarnings || [],
    importErrors: mapped.importErrors || [],
    supplier: mapped.supplier,
    externalSourceKey: mapped.externalSourceKey,
    syncStatus: 'success',
    lastSyncedAt: new Date(),
  };
}

module.exports = {
  buildExternalSourceKey,
  cleanAlibabaDescription,
  convertUsdPriceToXof,
  mapAlibabaCategoryToDangoStore,
  mapAlibabaProductToDango,
  mapToDropshippingPayload,
  extractPriceTiers,
  extractPackageDimensions,
  detectSuspiciousStock,
  detectMoqConflict,
  extractOriginAndPort,
  extractSupplyCapacity,
  extractBrand,
  ATTR_TRANSLATIONS,
};
