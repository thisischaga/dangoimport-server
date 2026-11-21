const AlibabaFreightConfig = require('../../Models/AlibabaFreightConfig');
const { parseProductWeightKg, isAlibabaManagedProduct } = require('../../utils/importPricing');

const AIR_CATEGORIES = {
  normal: { label: 'Marchandises normales', initialRate: 9000, discountPercent: 2, storageDays: 21, volumetricEnabled: false },
  special: { label: 'Produits spéciaux', initialRate: 10500, discountPercent: 2, storageDays: 30, volumetricEnabled: false },
  medical: { label: 'Médical et autres équipements', initialRate: 11500, discountPercent: 2, storageDays: 30, volumetricEnabled: false },
  computer: { label: 'Ordinateurs', initialRate: 25000, discountPercent: 2, storageDays: 30, volumetricEnabled: false },
  smartphone_tablet: { label: 'Smartphones et tablettes', initialRate: 15000, discountPercent: 2, storageDays: 30, volumetricEnabled: false },
};

const SEA_CATEGORIES = {
  normal: { label: 'Marchandises normales', initialRate: 255000, discountPercent: 2, storageDays: 60 },
  fragile: { label: 'Marchandises fragiles', initialRate: 300000, discountPercent: 2, storageDays: 60 },
  machine: { label: 'Machines', initialRate: 325000, discountPercent: 2, storageDays: 60 },
  heavy: { label: 'Articles lourds', initialRate: 290000, discountPercent: 2, storageDays: 60 },
};

const DEFAULT_ALIBABA_FREIGHT_CONFIG = Object.freeze({
  destinations: {
    BJ: {
      label: 'Bénin',
      defaultMode: 'air',
      air: { enabled: true, categories: AIR_CATEGORIES },
      sea: { enabled: true, fallbackVolumeM3: 0, categories: SEA_CATEGORIES },
    },
    TG: {
      label: 'Togo',
      defaultMode: 'sea',
      air: { enabled: false, categories: AIR_CATEGORIES },
      sea: {
        enabled: true,
        fallbackVolumeM3: 0.01,
        categories: {
          normal: { ...SEA_CATEGORIES.normal, initialRate: 180000 },
          fragile: { ...SEA_CATEGORIES.fragile, initialRate: 210000 },
          machine: { ...SEA_CATEGORIES.machine, initialRate: 210000 },
          heavy: { ...SEA_CATEGORIES.heavy, initialRate: 210000 },
        },
      },
    },
  },
  volumetric: {
    enabled: false,
    coefficient: 167,
    volumeUnit: 'm3',
    method: 'max',
    roundingMode: 'ceil',
    roundingIncrementKg: 1,
  },
});

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

function positiveNumber(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw validationError(`${label} doit être compris entre ${min} et ${max}.`);
  }
  return number;
}

function normalizeConfig(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const defaults = clone(DEFAULT_ALIBABA_FREIGHT_CONFIG);
  const destinations = source.destinations || {};

  for (const [destinationCode, destinationDefault] of Object.entries(defaults.destinations)) {
    const destinationInput = destinations[destinationCode] || {};
    if (destinationInput.defaultMode !== undefined && !['air', 'sea'].includes(destinationInput.defaultMode)) {
      throw validationError(`Mode par défaut invalide pour ${destinationDefault.label}.`);
    }
    defaults.destinations[destinationCode] = {
      label: destinationDefault.label,
      defaultMode: destinationInput.defaultMode || destinationDefault.defaultMode,
      air: normalizeMode(destinationInput.air, destinationDefault.air, `${destinationDefault.label} aérien`),
      sea: normalizeMode(destinationInput.sea, destinationDefault.sea, `${destinationDefault.label} maritime`),
    };
    if (!defaults.destinations[destinationCode][defaults.destinations[destinationCode].defaultMode].enabled) {
      throw validationError(`Le mode par défaut doit être disponible pour ${destinationDefault.label}.`);
    }
  }

  const volumetric = source.volumetric || {};
  if (volumetric.volumeUnit !== undefined && volumetric.volumeUnit !== 'm3') {
    throw validationError('L’unité du coefficient volumétrique doit être m³.');
  }
  if (volumetric.method !== undefined && !['max', 'real_only', 'volumetric_only'].includes(volumetric.method)) {
    throw validationError('Méthode de calcul du poids facturable invalide.');
  }
  if (volumetric.roundingMode !== undefined && !['none', 'ceil', 'nearest', 'floor'].includes(volumetric.roundingMode)) {
    throw validationError('Règle d’arrondi du poids facturable invalide.');
  }
  if (volumetric.enabled !== undefined && typeof volumetric.enabled !== 'boolean') {
    throw validationError('L’activation du poids volumétrique doit être un booléen.');
  }
  defaults.volumetric = {
    enabled: volumetric.enabled === undefined ? defaults.volumetric.enabled : volumetric.enabled,
    coefficient: positiveNumber(volumetric.coefficient ?? defaults.volumetric.coefficient, 'Coefficient volumétrique', { min: 0.01, max: 10000 }),
    volumeUnit: 'm3',
    method: volumetric.method || defaults.volumetric.method,
    roundingMode: volumetric.roundingMode || defaults.volumetric.roundingMode,
    roundingIncrementKg: positiveNumber(
      volumetric.roundingIncrementKg ?? defaults.volumetric.roundingIncrementKg,
      'Incrément d’arrondi du poids',
      { min: 0.001, max: 1000 },
    ),
  };
  return defaults;
}

function normalizeMode(input = {}, defaults, label) {
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
    throw validationError(`La disponibilité ${label} doit être un booléen.`);
  }
  const categories = {};
  for (const [key, categoryDefault] of Object.entries(defaults.categories)) {
    const row = input.categories?.[key] || {};
    if (row.volumetricEnabled !== undefined && typeof row.volumetricEnabled !== 'boolean') {
      throw validationError(`Le calcul volumétrique ${row.label || categoryDefault.label} doit être un booléen.`);
    }
    const initialRate = positiveNumber(row.initialRate ?? categoryDefault.initialRate, `Tarif initial ${label} / ${categoryDefault.label}`);
    const discountPercent = positiveNumber(row.discountPercent ?? categoryDefault.discountPercent, `Réduction ${label} / ${categoryDefault.label}`, { max: 100 });
    const storageDays = positiveNumber(row.storageDays ?? categoryDefault.storageDays, `Délai de stockage ${label} / ${categoryDefault.label}`, { min: 1, max: 3650 });
    categories[key] = {
      label: categoryDefault.label,
      initialRate,
      discountPercent,
      rate: Math.round(initialRate * (1 - discountPercent / 100)),
      storageDays,
      ...(Object.prototype.hasOwnProperty.call(categoryDefault, 'volumetricEnabled')
        ? { volumetricEnabled: row.volumetricEnabled ?? categoryDefault.volumetricEnabled }
        : {}),
    };
  }
  return {
    enabled: input.enabled === undefined ? defaults.enabled : input.enabled,
    ...(Object.prototype.hasOwnProperty.call(defaults, 'fallbackVolumeM3')
      ? {
          fallbackVolumeM3: positiveNumber(
            input.fallbackVolumeM3 ?? defaults.fallbackVolumeM3,
            `Volume forfaitaire ${label}`,
            { min: 0, max: 1 },
          ),
        }
      : {}),
    categories,
  };
}

function resolveDoc(doc) {
  const plain = doc?.toObject ? doc.toObject() : doc || {};
  return {
    ...normalizeConfig({ destinations: plain.destinations, volumetric: plain.volumetric }),
    updatedBy: plain.updatedBy || '',
    updatedAt: plain.updatedAt || null,
    changeHistory: plain.changeHistory || [],
  };
}

async function getAlibabaFreightConfig({ forceRefresh = false } = {}) {
  if (!forceRefresh && cachedConfig && Date.now() - cachedAt < CACHE_MS) {
    return clone(cachedConfig);
  }
  const doc = await AlibabaFreightConfig.findOneAndUpdate(
    { key: 'default' },
    { $setOnInsert: { key: 'default', ...DEFAULT_ALIBABA_FREIGHT_CONFIG } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  cachedConfig = resolveDoc(doc);
  cachedAt = Date.now();
  return clone(cachedConfig);
}

async function updateAlibabaFreightConfig(payload = {}, changedBy = 'admin') {
  const current = await getAlibabaFreightConfig({ forceRefresh: true });
  const next = normalizeConfig({
    destinations: payload.destinations || current.destinations,
    volumetric: payload.volumetric || current.volumetric,
  });
  const changedFields = [];
  for (const [destinationCode, destination] of Object.entries(next.destinations)) {
    for (const mode of ['air', 'sea']) {
      const before = current.destinations[destinationCode][mode];
      const after = destination[mode];
      if (before.enabled !== after.enabled) changedFields.push(`destinations.${destinationCode}.${mode}.enabled`);
      if (before.fallbackVolumeM3 !== after.fallbackVolumeM3) {
        changedFields.push(`destinations.${destinationCode}.${mode}.fallbackVolumeM3`);
      }
      for (const [categoryKey, category] of Object.entries(after.categories)) {
        const oldCategory = before.categories[categoryKey];
        for (const field of ['initialRate', 'discountPercent', 'rate', 'storageDays', 'volumetricEnabled']) {
          if (category[field] !== oldCategory[field]) {
            changedFields.push(`destinations.${destinationCode}.${mode}.categories.${categoryKey}.${field}`);
          }
        }
      }
    }
    if (current.destinations[destinationCode].defaultMode !== destination.defaultMode) {
      changedFields.push(`destinations.${destinationCode}.defaultMode`);
    }
  }
  for (const key of Object.keys(next.volumetric)) {
    if (next.volumetric[key] !== current.volumetric[key]) changedFields.push(`volumetric.${key}`);
  }

  const actor = String(changedBy || 'admin');
  const historyEntry = { changedAt: new Date(), changedBy: actor, changedFields };
  const doc = await AlibabaFreightConfig.findOneAndUpdate(
    { key: 'default' },
    {
      $set: { key: 'default', destinations: next.destinations, volumetric: next.volumetric, updatedBy: actor, updatedAt: new Date() },
      ...(changedFields.length ? { $push: { changeHistory: { $each: [historyEntry], $slice: -100 } } } : {}),
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );
  cachedConfig = resolveDoc(doc);
  cachedAt = Date.now();
  return { config: clone(cachedConfig), changedFields };
}

function normalizeCategory(value, categories) {
  const key = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (categories[key]) return key;
  const aliases = {
    machines: 'machine',
    heavy_articles: 'heavy',
    fragile_goods: 'fragile',
    special_products: 'special',
    medical_equipment: 'medical',
    computers: 'computer',
    smartphones: 'smartphone_tablet',
    tablets: 'smartphone_tablet',
  };
  return categories[aliases[key]] ? aliases[key] : 'normal';
}

function productVolumeM3(product = {}) {
  const logistics = product.logistics || {};
  const storedCm3 = Number(logistics.volumeCm3);
  if (Number.isFinite(storedCm3) && storedCm3 > 0) return storedCm3 / 1_000_000;
  const dims = [logistics.packageLength, logistics.packageWidth, logistics.packageHeight].map(Number);
  if (dims.some((value) => !Number.isFinite(value) || value <= 0)) return 0;
  const unit = String(logistics.dimensionUnit || 'cm').toLowerCase();
  const toMeters = unit === 'm' ? 1 : unit === 'mm' ? 0.001 : unit === 'cm' ? 0.01 : 0;
  return toMeters ? dims.reduce((volume, dimension) => volume * dimension * toMeters, 1) : 0;
}

function roundBillableWeight(weight, settings) {
  const increment = settings.roundingIncrementKg;
  if (settings.roundingMode === 'none') return Math.round(weight * 1000) / 1000;
  const ratio = weight / increment;
  const rounded = settings.roundingMode === 'ceil'
    ? Math.ceil(ratio)
    : settings.roundingMode === 'floor'
      ? Math.floor(ratio)
      : Math.round(ratio);
  return Math.max(0, rounded * increment);
}

function calculateAlibabaFreightQuote(lines, countryCode, requestedMode, config) {
  const destination = config.destinations[countryCode];
  if (!destination) {
    const error = new Error('Destination non configurée pour le transport InterCargo.');
    error.status = 400;
    throw error;
  }
  const modeKey = requestedMode || destination.defaultMode;
  if (!['air', 'sea'].includes(modeKey)) {
    const error = new Error('Mode de transport invalide.');
    error.status = 400;
    throw error;
  }
  const mode = destination[modeKey];
  if (!mode.enabled) {
    const error = new Error(`Le transport ${modeKey === 'air' ? 'aérien' : 'maritime'} vers ${destination.label} est temporairement indisponible.`);
    error.status = 409;
    throw error;
  }

  let cost = 0;
  let totalVolumeM3 = 0;
  let totalBillableWeightKg = 0;
  const details = [];
  for (const line of lines) {
    const product = line.product || line;
    const quantity = Math.max(1, Number(line.quantity) || 1);
    const logistics = product.logistics || {};
    const allowedModes = logistics.allowedTransportModes || [];
    if (allowedModes.length && !allowedModes.includes(modeKey)) {
      const error = new Error(`Le produit « ${product.name || 'Alibaba'} » n’autorise pas le transport ${modeKey === 'air' ? 'aérien' : 'maritime'}.`);
      error.status = 422;
      throw error;
    }
    const categoryKey = normalizeCategory(
      logistics[modeKey === 'air' ? 'airCategory' : 'seaCategory'],
      mode.categories,
    );
    const category = mode.categories[categoryKey];

    if (modeKey === 'sea') {
      const actualVolumeM3 = productVolumeM3(product);
      const volumeEstimated = !(actualVolumeM3 > 0) && mode.fallbackVolumeM3 > 0;
      const volumeM3 = actualVolumeM3 > 0
        ? actualVolumeM3
        : volumeEstimated
          ? mode.fallbackVolumeM3
          : 0;
      if (!(volumeM3 > 0)) {
        const error = new Error(`Dimensions manquantes pour calculer le tarif maritime de « ${product.name || 'un produit Alibaba'} ».`);
        error.status = 422;
        throw error;
      }
      const lineVolume = volumeM3 * quantity;
      const lineCost = Math.round(lineVolume * category.rate);
      cost += lineCost;
      totalVolumeM3 += lineVolume;
      details.push({
        productId: String(product._id || ''),
        name: product.name || '',
        category: categoryKey,
        rate: category.rate,
        quantity,
        volumeM3,
        volumeEstimated,
        billableVolumeM3: lineVolume,
        storageDays: category.storageDays,
        cost: lineCost,
      });
      continue;
    }

    const weightProduct = {
      ...product,
      weight: logistics.grossWeight ?? logistics.weight ?? product.weight,
    };
    const actualWeightKg = parseProductWeightKg(weightProduct);
    if (!(actualWeightKg > 0)) {
      const error = new Error(`Poids manquant pour calculer le tarif aérien de « ${product.name || 'un produit Alibaba'} ».`);
      error.status = 422;
      throw error;
    }
    const productVolumetricSetting = logistics.volumetricEnabled;
    const useVolumetric = config.volumetric.enabled
      && (productVolumetricSetting === null || productVolumetricSetting === undefined
        ? category.volumetricEnabled === true
        : productVolumetricSetting === true);
    const volumeM3 = useVolumetric ? productVolumeM3(product) : 0;
    if (useVolumetric && !(volumeM3 > 0)) {
      const error = new Error(`Dimensions manquantes pour le calcul volumétrique de « ${product.name || 'un produit Alibaba'} ».`);
      error.status = 422;
      throw error;
    }
    const volumetricWeightKg = useVolumetric ? volumeM3 * config.volumetric.coefficient : 0;
    const rawBillableWeight = !useVolumetric || config.volumetric.method === 'real_only'
      ? actualWeightKg
      : config.volumetric.method === 'volumetric_only'
        ? volumetricWeightKg
        : Math.max(actualWeightKg, volumetricWeightKg);
    const billableWeightKg = roundBillableWeight(rawBillableWeight, config.volumetric);
    const lineCost = Math.round(billableWeightKg * quantity * category.rate);
    cost += lineCost;
    totalBillableWeightKg += billableWeightKg * quantity;
    totalVolumeM3 += volumeM3 * quantity;
    details.push({
      productId: String(product._id || ''),
      name: product.name || '',
      category: categoryKey,
      rate: category.rate,
      quantity,
      actualWeightKg,
      volumetricWeightKg: useVolumetric ? volumetricWeightKg : null,
      billableWeightKg,
      storageDays: category.storageDays,
      volumetricApplied: useVolumetric,
      cost: lineCost,
    });
  }

  return {
    destination: countryCode,
    destinationLabel: destination.label,
    transportMode: modeKey,
    transportLabel: modeKey === 'air' ? 'Transport aérien InterCargo' : 'Transport maritime InterCargo',
    cost,
    totalVolumeM3: Number(totalVolumeM3.toFixed(6)),
    billableWeightKg: Number(totalBillableWeightKg.toFixed(3)),
    storageDays: details.length ? Math.min(...details.map((row) => row.storageDays)) : null,
    estimatedDeliveryLabel: 'Délai d’acheminement non confirmé',
    items: details,
  };
}

module.exports = {
  DEFAULT_ALIBABA_FREIGHT_CONFIG,
  getAlibabaFreightConfig,
  updateAlibabaFreightConfig,
  calculateAlibabaFreightQuote,
  normalizeConfig,
};
