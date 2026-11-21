const LocalDeliveryConfig = require('../Models/LocalDeliveryConfig');
const { parseWeightToKg } = require('../utils/importPricing');

const CATEGORIES = ['S', 'M', 'L', 'XL'];
const DEFAULT_LOCAL_DELIVERY_CONFIG = {
  revision: 1,
  classification: {
    standardMaxWeightKg: 5,
    mediumMaxWeightKg: 15,
    largeMaxWeightKg: 30,
    standardDimensionsCm: { length: 40, width: 30, height: 30 },
    standardVolumeM3: 0.036,
    largeMaxVolumeM3: 0.3,
  },
  surcharges: { fragile: 300, extraParcel: 300 },
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

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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
  const dimensions = classification.standardDimensionsCm || {};
  base.classification = {
    standardMaxWeightKg: positiveNumber(classification.standardMaxWeightKg ?? base.classification.standardMaxWeightKg, 'Poids maximal S', { min: 0.01 }),
    mediumMaxWeightKg: positiveNumber(classification.mediumMaxWeightKg ?? base.classification.mediumMaxWeightKg, 'Poids maximal M', { min: 0.01 }),
    largeMaxWeightKg: positiveNumber(classification.largeMaxWeightKg ?? base.classification.largeMaxWeightKg, 'Poids maximal L', { min: 0.01 }),
    standardDimensionsCm: {
      length: positiveNumber(dimensions.length ?? base.classification.standardDimensionsCm.length, 'Longueur maximale S', { min: 0.01 }),
      width: positiveNumber(dimensions.width ?? base.classification.standardDimensionsCm.width, 'Largeur maximale S', { min: 0.01 }),
      height: positiveNumber(dimensions.height ?? base.classification.standardDimensionsCm.height, 'Hauteur maximale S', { min: 0.01 }),
    },
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
  const candidate = logistics.grossWeight ?? logistics.weight ?? product.weightKg ?? product.weight;
  return parseWeightToKg(candidate);
}

function productDimensionsCm(product) {
  const logistics = product.logistics || {};
  const dims = [logistics.packageLength, logistics.packageWidth, logistics.packageHeight].map(Number);
  if (dims.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  const unit = String(logistics.dimensionUnit || 'cm').toLowerCase();
  const scale = unit === 'm' ? 100 : unit === 'mm' ? 0.1 : unit === 'cm' ? 1 : 0;
  return scale ? dims.map((value) => value * scale).sort((a, b) => b - a) : null;
}

function classifyBasket(lines, config) {
  let minimumCategoryIndex = 0;
  let totalWeightKg = 0;
  let totalVolumeM3 = 0;
  const largestDimensionsCm = [0, 0, 0];
  let allProfilesAssigned = true;
  let allMeasurementsAvailable = true;

  for (const line of lines) {
    const product = line.product || line;
    const quantity = Math.max(1, Number(line.quantity) || 1);
    const logistics = product.logistics || {};
    const profile = String(logistics.localDeliveryProfile || '').trim().toUpperCase();
    const explicitIndex = CATEGORIES.indexOf(profile);
    if (explicitIndex >= 0) {
      minimumCategoryIndex = Math.max(minimumCategoryIndex, explicitIndex);
    } else {
      allProfilesAssigned = false;
    }

    const weightKg = readProductWeightKg(product);
    const dimensionsCm = productDimensionsCm(product);
    if (!(weightKg > 0) || !dimensionsCm) {
      allMeasurementsAvailable = false;
    } else {
      totalWeightKg += weightKg * quantity;
      const volumeM3 = dimensionsCm.reduce((volume, dimension) => volume * dimension / 100, 1);
      totalVolumeM3 += volumeM3 * quantity;
      for (let index = 0; index < 3; index += 1) {
        largestDimensionsCm[index] = Math.max(largestDimensionsCm[index], dimensionsCm[index]);
      }
    }
  }

  if (!allProfilesAssigned && !allMeasurementsAvailable) {
    const error = new Error('Les informations logistiques sont insuffisantes pour calculer un tarif local fiable. Dango doit confirmer le profil du colis.');
    error.status = 422;
    error.code = 'LOCAL_DELIVERY_PROFILE_REQUIRED';
    throw error;
  }

  const thresholds = config.classification;
  if (allMeasurementsAvailable) {
    const { length: maxLength, width: maxWidth, height: maxHeight } = thresholds.standardDimensionsCm;
    if (totalWeightKg > thresholds.largeMaxWeightKg || totalVolumeM3 > thresholds.largeMaxVolumeM3) {
      minimumCategoryIndex = Math.max(minimumCategoryIndex, 3);
    } else if (totalWeightKg > thresholds.mediumMaxWeightKg || totalVolumeM3 > thresholds.standardVolumeM3) {
      minimumCategoryIndex = Math.max(minimumCategoryIndex, 2);
    } else if (totalWeightKg > thresholds.standardMaxWeightKg
      || largestDimensionsCm[0] > maxLength
      || largestDimensionsCm[1] > maxWidth
      || largestDimensionsCm[2] > maxHeight) {
      minimumCategoryIndex = Math.max(minimumCategoryIndex, 1);
    }
  }
  return {
    category: CATEGORIES[minimumCategoryIndex],
    internalMeasurements: allMeasurementsAvailable ? {
      totalWeightKg: Number(totalWeightKg.toFixed(3)),
      totalVolumeM3: Number(totalVolumeM3.toFixed(6)),
      largestDimensionsCm,
    } : null,
    hasFragileItems: lines.some((line) => (line.product || line).logistics?.fragile === true),
  };
}

function resolveLocalZone(countryCode, city, district, config) {
  const destination = normalizeText(`${city} ${district}`);
  const districtText = normalizeText(district);
  return config.zones.find((zone) => {
    if (zone.countryCode !== countryCode) return false;
    return zone.aliases.some((alias) => {
      const normalizedAlias = normalizeText(alias);
      return normalizedAlias && (
        normalizedAlias === districtText
        || normalizedAlias === normalizeText(city)
        || destination.includes(normalizedAlias)
      );
    });
  }) || null;
}

function calculateLocalDeliveryQuote({ lines = [], countryCode, city, district, config }) {
  const activeConfig = normalizeConfig(config);
  const zone = resolveLocalZone(String(countryCode || '').toUpperCase(), city, district, activeConfig);
  if (!zone) {
    const error = new Error('Cette destination est hors grille tarifaire. Contactez Dango pour obtenir un devis de livraison locale.');
    error.status = 422;
    error.code = 'LOCAL_DELIVERY_QUOTE_REQUIRED';
    throw error;
  }
  const classified = classifyBasket(lines, activeConfig);
  const baseFee = zone.rates[classified.category];
  if (baseFee === null || baseFee === undefined) {
    const error = new Error(`La livraison locale pour la catégorie ${classified.category} vers ${zone.name} est sur devis. Contactez Dango avant le paiement.`);
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
    countryCode: zone.countryCode,
    zoneId: zone.id,
    zoneName: zone.name,
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
};
