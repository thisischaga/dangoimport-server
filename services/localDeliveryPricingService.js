const LocalDeliveryConfig = require('../Models/LocalDeliveryConfig');
const { parseWeightToKg } = require('../utils/importPricing');

const CATEGORIES = ['S', 'M', 'L', 'XL'];
const COUNTRY_NAMES = { BJ: 'Bénin', TG: 'Togo' };
const DEFAULT_LOCAL_DELIVERY_CONFIG = {
  revision: 1,
  classification: {
    standardMaxWeightKg: 5,
    mediumMaxWeightKg: 15,
    largeMaxWeightKg: 30,
    standardVolumeM3: 0.036,
    largeMaxVolumeM3: 0.3,
  },
  surcharges: { fragile: 300, extraParcel: 300 },
  countryRates: {
    BJ: { S: 1000, M: 1500, L: 3000, XL: null },
    TG: { S: 1000, M: 1500, L: 3000, XL: null },
  },
  zones: [
    { id: 'bj-cotonou-centre', countryCode: 'BJ', name: 'Cotonou centre', aliases: ['cotonou centre', 'centre-ville'], rates: { S: 1000, M: 1500, L: 3000, XL: null } },
    { id: 'bj-cotonou-peripherie', countryCode: 'BJ', name: 'Cotonou périphérie', aliases: ['cotonou peripherie'], rates: { S: 1500, M: 2000, L: 3500, XL: null } },
    { id: 'bj-calavi-proche', countryCode: 'BJ', name: 'Calavi proche', aliases: ['calavi proche', 'abomey calavi proche'], rates: { S: 2000, M: 2500, L: 4000, XL: null } },
    { id: 'bj-calavi-eloigne', countryCode: 'BJ', name: 'Calavi éloigné', aliases: ['calavi eloigne', 'abomey calavi eloigne'], rates: { S: 2500, M: 3000, L: 5000, XL: null } },
    { id: 'tg-lome-centre', countryCode: 'TG', name: 'Lomé centre', aliases: ['lome centre', 'centre-ville'], rates: { S: 1000, M: 1500, L: 3000, XL: null } },
    { id: 'tg-lome-intermediaire', countryCode: 'TG', name: 'Lomé intermédiaire', aliases: ['lome intermediaire'], rates: { S: 1500, M: 2000, L: 3500, XL: null } },
    { id: 'tg-lome-peripherie', countryCode: 'TG', name: 'Lomé périphérie', aliases: ['lome peripherie'], rates: { S: 2000, M: 2500, L: 4000, XL: null } },
  ],
};

let cachedConfig = null;
let cachedAt = 0;
const CACHE_MS = 15_000;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function positiveNumber(value, label, { min = 0, allowNull = false } = {}) {
  if (allowNull && (value === null || value === '')) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min) {
    throw validationError(`${label} doit être un nombre supérieur ou égal à ${min}.`);
  }
  return number;
}

function normalizeConfig(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const base = clone(DEFAULT_LOCAL_DELIVERY_CONFIG);
  const classification = source.classification || {};
  base.classification = {
    standardMaxWeightKg: positiveNumber(classification.standardMaxWeightKg ?? base.classification.standardMaxWeightKg, 'Poids maximal S', { min: 0.01 }),
    mediumMaxWeightKg: positiveNumber(classification.mediumMaxWeightKg ?? base.classification.mediumMaxWeightKg, 'Poids maximal M', { min: 0.01 }),
    largeMaxWeightKg: positiveNumber(classification.largeMaxWeightKg ?? base.classification.largeMaxWeightKg, 'Poids maximal L', { min: 0.01 }),
    standardVolumeM3: positiveNumber(classification.standardVolumeM3 ?? base.classification.standardVolumeM3, 'Volume maximal S', { min: 0.000001 }),
    largeMaxVolumeM3: positiveNumber(classification.largeMaxVolumeM3 ?? base.classification.largeMaxVolumeM3, 'Volume maximal L', { min: 0.000001 }),
  };
  if (!(base.classification.standardMaxWeightKg < base.classification.mediumMaxWeightKg
    && base.classification.mediumMaxWeightKg < base.classification.largeMaxWeightKg)) {
    throw validationError('Les seuils de poids S, M et L doivent être croissants.');
  }

  const surcharges = source.surcharges || {};
  base.surcharges = {
    fragile: positiveNumber(surcharges.fragile ?? base.surcharges.fragile, 'Supplément fragile'),
    extraParcel: positiveNumber(surcharges.extraParcel ?? base.surcharges.extraParcel, 'Supplément colis additionnel'),
  };

  const zones = Array.isArray(source.zones) ? source.zones : base.zones;
  if (!zones.length) throw validationError('Au moins une zone de livraison doit être configurée.');
  const ids = new Set();
  base.zones = zones.map((zone, index) => {
    const id = String(zone.id || `zone-${index + 1}`).trim();
    const countryCode = String(zone.countryCode || '').trim().toUpperCase();
    const name = String(zone.name || '').trim();
    if (!id || ids.has(id)) throw validationError('Chaque zone doit avoir un identifiant unique.');
    if (!['BJ', 'TG'].includes(countryCode)) throw validationError(`Pays invalide pour la zone ${name || id}.`);
    if (!name) throw validationError('Le nom de chaque zone est obligatoire.');
    ids.add(id);
    const rates = {};
    for (const category of CATEGORIES) {
      const value = zone.rates?.[category];
      rates[category] = category === 'XL'
        ? positiveNumber(value, `Tarif ${name} / XL`, { min: 0.01, allowNull: true })
        : positiveNumber(value, `Tarif ${name} / ${category}`, { min: 0.01 });
    }
    return {
      id,
      countryCode,
      name,
      aliases: [...new Set([name, ...(Array.isArray(zone.aliases) ? zone.aliases : [])].map((alias) => String(alias).trim()).filter(Boolean))],
      rates,
    };
  });
  base.countryRates = Object.fromEntries(Object.keys(COUNTRY_NAMES).map((countryCode) => {
    const rates = source.countryRates?.[countryCode]
      || base.zones.find((zone) => zone.countryCode === countryCode)?.rates
      || base.countryRates[countryCode];
    const normalizedRates = {};
    for (const category of CATEGORIES) {
      normalizedRates[category] = category === 'XL'
        ? positiveNumber(rates?.[category], `Tarif ${COUNTRY_NAMES[countryCode]} / XL`, { min: 0.01, allowNull: true })
        : positiveNumber(rates?.[category], `Tarif ${COUNTRY_NAMES[countryCode]} / ${category}`, { min: 0.01 });
    }
    return [countryCode, normalizedRates];
  }));
  return base;
}

function resolveConfig(doc) {
  const plain = doc?.toObject ? doc.toObject() : doc || {};
  return {
    ...normalizeConfig(plain.config || {}),
    revision: Number(plain.revision) || 1,
    updatedBy: plain.updatedBy || '',
    updatedAt: plain.updatedAt || null,
    changeHistory: plain.changeHistory || [],
  };
}

async function getLocalDeliveryConfig({ forceRefresh = false } = {}) {
  if (!forceRefresh && cachedConfig && Date.now() - cachedAt < CACHE_MS) {
    return clone(cachedConfig);
  }
  const doc = await LocalDeliveryConfig.findOneAndUpdate(
    { key: 'default' },
    { $setOnInsert: { key: 'default', config: DEFAULT_LOCAL_DELIVERY_CONFIG, revision: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  cachedConfig = resolveConfig(doc);
  cachedAt = Date.now();
  return clone(cachedConfig);
}

async function updateLocalDeliveryConfig(payload = {}, changedBy = 'admin') {
  const current = await getLocalDeliveryConfig({ forceRefresh: true });
  const next = normalizeConfig(payload);
  const revision = current.revision + 1;
  const actor = String(changedBy || 'admin');
  const doc = await LocalDeliveryConfig.findOneAndUpdate(
    { key: 'default' },
    {
      $set: { config: next, revision, updatedBy: actor, updatedAt: new Date() },
      $push: { changeHistory: { $each: [{ changedAt: new Date(), changedBy: actor, revision }], $slice: -100 } },
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );
  cachedConfig = resolveConfig(doc);
  cachedAt = Date.now();
  return clone(cachedConfig);
}

function readProductWeightKg(product) {
  const logistics = product.logistics || {};
  const packageWeightKg = logistics.grossWeight ?? logistics.netWeight;
  if (packageWeightKg !== null && packageWeightKg !== undefined && packageWeightKg !== '') {
    return parseWeightToKg(`${packageWeightKg} kg`);
  }
  if (product.weightKg !== null && product.weightKg !== undefined && product.weightKg !== '') {
    return parseWeightToKg(`${product.weightKg} kg`);
  }
  const candidate = logistics.weight ?? product.weightKg ?? product.weight;
  const unit = logistics.weightUnit || product.weightUnit;
  if (typeof candidate === 'number' && unit) {
    const weightKg = parseWeightToKg(`${candidate} ${unit}`);
    if (weightKg > 0) return weightKg;
  } else {
    const weightKg = parseWeightToKg(candidate);
    if (weightKg > 0) return weightKg;
  }
  const specification = getProductSpecifications(product).find(({ key }) => /weight|poids|masse/i.test(key));
  return specification ? parseWeightToKg(specification.value) : 0;
}

function getProductSpecifications(product) {
  const rows = [];
  const addRow = (key, value) => {
    if (key == null || value == null) return;
    const normalizedKey = String(key).trim();
    const normalizedValue = String(value).trim();
    if (normalizedKey && normalizedValue) rows.push({ key: normalizedKey, value: normalizedValue });
  };
  const visit = (value, depth = 0) => {
    if (depth > 8 || value == null) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, depth + 1));
      return;
    }
    if (typeof value !== 'object') return;

    const key = value.key || value.name || value.attr_name_desc || value.attr_name
      || value.attributeName || value.prop_name || value.property_name;
    const rowValue = value.value ?? value.val ?? value.attr_value_desc ?? value.attr_value
      ?? value.attributeValue ?? value.prop_value ?? value.property_value;
    if (key && rowValue != null) {
      addRow(key, rowValue);
    } else if (key && Array.isArray(value.values)) {
      value.values.forEach((entry) => {
        addRow(key, typeof entry === 'object' ? entry?.value ?? entry?.attr_value_desc : entry);
      });
    }

    for (const field of ['specifications', 'attributes', 'attribute_list', 'attr_list', 'product_attributes']) {
      if (value[field]) visit(value[field], depth + 1);
    }
  };

  visit(product.specifications);
  visit(product.attributes);
  visit(product.rawSections?.keyAttributes);
  visit(product.rawPayload?.keyAttributes);
  visit(product.rawPayload?.result_data?.keyAttributes);
  visit(product.rawPayload?.raw?.keyAttributes);
  return rows;
}

function volumeFromPackageSize(value) {
  const text = String(value || '').trim().toLowerCase().replace(/,/g, '.');
  const dimensions = text.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
  if (!dimensions || dimensions.length !== 3 || dimensions.some((dimension) => dimension <= 0)) return 0;
  const unit = text.match(/\b(mm|millimeters?|millimetres?|cm|centimeters?|centimetres?|m|meters?|metres?)\b/i)?.[1]?.toLowerCase() || 'cm';
  const toMeters = unit.startsWith('mm') || unit.startsWith('millimet') ? 0.001
    : unit.startsWith('m') && !unit.startsWith('mm') && !unit.startsWith('millimet') ? 1
      : 0.01;
  return dimensions.reduce((volume, dimension) => volume * dimension * toMeters, 1);
}

function readProductVolumeM3(product) {
  const logistics = product.logistics || {};
  const volumeM3 = Number(logistics.volumeM3 ?? product.volumeM3);
  if (Number.isFinite(volumeM3) && volumeM3 > 0) return volumeM3;
  const volumeCm3 = Number(logistics.volumeCm3 ?? product.volumeCm3);
  if (Number.isFinite(volumeCm3) && volumeCm3 > 0) return volumeCm3 / 1_000_000;

  const dimensions = [
    logistics.packageLength,
    logistics.packageWidth,
    logistics.packageHeight,
  ].map(Number);
  if (dimensions.every((dimension) => Number.isFinite(dimension) && dimension > 0)) {
    const unit = String(logistics.dimensionUnit || 'cm').trim().toLowerCase();
    const toMeters = unit === 'm' ? 1 : unit === 'mm' ? 0.001 : unit === 'cm' ? 0.01 : 0;
    if (toMeters) return dimensions.reduce((volume, dimension) => volume * dimension * toMeters, 1);
  }

  const packageSize = product.packageSize
    || product.packaging?.packageSize
    || product.dimensions?.formatted
    || product.packaging?.dimensions?.formatted
    || getProductSpecifications(product).find(({ key }) => /package size|dimensions?|taille du colis/i.test(key))?.value;
  return volumeFromPackageSize(packageSize);
}

function classifyBasket(lines, config) {
  let minimumCategoryIndex = 0;
  let totalWeightKg = 0;
  let totalVolumeM3 = 0;
  const missingMeasurements = [];

  for (const line of lines) {
    const product = line.product || line;
    const quantity = Math.max(1, Number(line.quantity) || 1);
    const weightKg = readProductWeightKg(product);
    const volumeM3 = readProductVolumeM3(product);
    if (!(weightKg > 0) || !(volumeM3 > 0)) {
      missingMeasurements.push(product.name || product.title || 'Produit');
      continue;
    }
    totalWeightKg += weightKg * quantity;
    totalVolumeM3 += volumeM3 * quantity;
  }

  if (missingMeasurements.length) {
    const error = new Error(`Poids ou volume manquant dans la base pour : ${missingMeasurements.join(', ')}. Complétez ces données produit pour calculer la livraison locale.`);
    error.status = 422;
    error.code = 'LOCAL_DELIVERY_MEASUREMENTS_REQUIRED';
    throw error;
  }

  const thresholds = config.classification;
  if (totalWeightKg > thresholds.largeMaxWeightKg || totalVolumeM3 > thresholds.largeMaxVolumeM3) {
    minimumCategoryIndex = 3;
  } else if (totalWeightKg > thresholds.mediumMaxWeightKg || totalVolumeM3 > thresholds.standardVolumeM3) {
    minimumCategoryIndex = 2;
  } else if (totalWeightKg > thresholds.standardMaxWeightKg) {
    minimumCategoryIndex = 1;
  }
  return {
    category: CATEGORIES[minimumCategoryIndex],
    internalMeasurements: {
      totalWeightKg: Number(totalWeightKg.toFixed(3)),
      totalVolumeM3: Number(totalVolumeM3.toFixed(6)),
    },
    hasFragileItems: lines.some((line) => (line.product || line).logistics?.fragile === true),
  };
}

function calculateLocalDeliveryQuote({ lines = [], countryCode, config }) {
  const activeConfig = normalizeConfig(config);
  const normalizedCountryCode = String(countryCode || '').trim().toUpperCase();
  const rates = activeConfig.countryRates[normalizedCountryCode];
  if (!rates) {
    const error = new Error('Le pays sélectionné n’est pas pris en charge pour la livraison locale.');
    error.status = 422;
    error.code = 'LOCAL_DELIVERY_COUNTRY_UNSUPPORTED';
    throw error;
  }
  const classified = classifyBasket(lines, activeConfig);
  const baseFee = rates[classified.category];
  if (baseFee === null || baseFee === undefined) {
    const error = new Error(`La livraison locale pour la catégorie ${classified.category} vers le ${COUNTRY_NAMES[normalizedCountryCode]} est sur devis. Contactez Dango avant le paiement.`);
    error.status = 422;
    error.code = 'LOCAL_DELIVERY_QUOTE_REQUIRED';
    throw error;
  }
  const fragileSurcharge = classified.hasFragileItems ? activeConfig.surcharges.fragile : 0;
  const parcelCountsKnown = lines.every((line) => {
    const value = (line.product || line).logistics?.localAdditionalParcelCount;
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
  });
  const additionalParcelCount = parcelCountsKnown
    ? lines.reduce((sum, line) => sum + Number((line.product || line).logistics?.localAdditionalParcelCount || 0)
      * Math.max(1, Number(line.quantity) || 1), 0)
    : 0;
  const extraParcelSurcharge = additionalParcelCount * activeConfig.surcharges.extraParcel;
  return {
    countryCode: normalizedCountryCode,
    zoneId: `country-${normalizedCountryCode}`,
    zoneName: `Tarif national ${COUNTRY_NAMES[normalizedCountryCode]}`,
    category: classified.category,
    baseFee,
    fragileSurcharge,
    extraParcelSurcharge,
    fee: baseFee + fragileSurcharge + extraParcelSurcharge,
    additionalParcelCount,
    revision: Number(config?.revision) || activeConfig.revision,
    internalMeasurements: classified.internalMeasurements,
  };
}

module.exports = {
  DEFAULT_LOCAL_DELIVERY_CONFIG,
  normalizeLocalDeliveryConfig: normalizeConfig,
  getLocalDeliveryConfig,
  updateLocalDeliveryConfig,
  calculateLocalDeliveryQuote,
  readProductWeightKg,
  readProductVolumeM3,
};
