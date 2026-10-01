const crypto = require('crypto');
const { cjConfig, assertCjConfigured } = require('../../config/cj');
const cjClient = require('./cjClient');
const { getCJProductDetail } = require('./cjProductService');
const { toNumber } = require('../../utils/dropshippingCalculations');
const { convertUsdPriceToXof } = require('../../utils/cjCatalogHelpers');
const { groupDropshippingLinesByOrigin, resolveShipFromAreaCode } = require('../../utils/importShipmentGroups');
const { calculateChinaDomesticShipping } = require('../../utils/importPricing');

const CACHE_TTL_MS = Math.max(30_000, Number(process.env.CJ_FREIGHT_CACHE_TTL_MS) || 300_000);
const freightCache = new Map();

function cacheGet(key) {
  const hit = freightCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    freightCache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  freightCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  if (freightCache.size > 200) {
    const first = freightCache.keys().next().value;
    freightCache.delete(first);
  }
}

function parseWeightGrams(...values) {
  for (const raw of values) {
    if (raw == null || raw === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      return Math.max(1, Math.round(n));
    }
    const str = String(raw).trim().toLowerCase();
    const match = str.match(/([\d.]+)\s*(kg|g)?/);
    if (match) {
      const amount = Number(match[1]);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const unit = match[2] || 'g';
      return Math.max(1, Math.round(unit === 'kg' ? amount * 1000 : amount));
    }
  }
  return 100;
}

function parseVolumeCm3(length, width, height, detail) {
  const dims = [length, width, height].map((v) => toNumber(v, 0));
  if (dims.every((d) => d > 0)) {
    return Math.max(1, Math.round(dims[0] * dims[1] * dims[2]));
  }
  const pack = detail?.packWeight || detail?.productPackWeight;
  if (pack && toNumber(pack, 0) > 0) {
    return Math.max(60000, Math.round(toNumber(pack, 0) * 100));
  }
  return 60000;
}

function parseAgingLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return { minDays: null, maxDays: null, label: null };
  const parts = raw.split(/[-–—]/).map((p) => Number(String(p).replace(/\D/g, ''))).filter((n) => n > 0);
  if (parts.length >= 2) {
    const minDays = Math.min(parts[0], parts[1]);
    const maxDays = Math.max(parts[0], parts[1]);
    return { minDays, maxDays, label: `${minDays}–${maxDays} jours` };
  }
  if (parts.length === 1) {
    return { minDays: parts[0], maxDays: parts[0], label: `${parts[0]} jours` };
  }
  return { minDays: null, maxDays: null, label: raw };
}

function resolveVariant(product, selectedOptions = {}) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const selected = selectedOptions?.selectedVariant;
  if (selected && (selected.sku || selected.attributes?.externalVariantId)) {
    return selected;
  }
  const extId = String(
    selectedOptions?.externalVariantId
    || selected?.attributes?.externalVariantId
    || '',
  ).trim();
  if (extId) {
    const found = variants.find((v) => String(v.attributes?.externalVariantId || v.sku || '') === extId);
    if (found) return found;
  }
  const color = selectedOptions?.selectedColor;
  const size = selectedOptions?.selectedSize;
  if (color || size) {
    const found = variants.find((v) => {
      const n = String(v.name || '').toLowerCase();
      return (!color || n.includes(String(color).toLowerCase()))
        && (!size || n.includes(String(size).toLowerCase()));
    });
    if (found) return found;
  }
  return variants.find((v) => v.isDefault) || variants[0] || null;
}

async function enrichProductFreightMeta(product) {
  const supplier = product.supplier || {};
  let productProp = Array.isArray(supplier.cjProductProps) && supplier.cjProductProps.length
    ? supplier.cjProductProps
    : null;
  let detail = null;
  const pid = supplier.productId;
  const needsDetail = !productProp?.length || !product.weight;
  if (needsDetail && pid && cjConfig.enabled) {
    try {
      detail = await getCJProductDetail(pid);
      if (!productProp?.length) {
        const fromDetail = detail?.productProEnSet || detail?.productProSet;
        if (Array.isArray(fromDetail) && fromDetail.length) {
          productProp = fromDetail.map(String);
        } else if (typeof fromDetail === 'string' && fromDetail.trim()) {
          productProp = [fromDetail.trim()];
        }
      }
    } catch {
      detail = null;
    }
  }
  if (!productProp?.length) {
    productProp = ['COMMON'];
  }
  return { productProp, detail };
}

function buildFreightLineDto(line) {
  const { product, quantity, selectedOptions } = line;
  const variant = resolveVariant(product, selectedOptions);
  const sku = String(variant?.sku || product.sku || '').trim();
  const vid = String(
    variant?.attributes?.externalVariantId
    || selectedOptions?.externalVariantId
    || '',
  ).trim();
  if (!sku && !vid) {
    const err = new Error(`Variante CJ introuvable pour « ${product.name} ».`);
    err.status = 400;
    throw err;
  }
  const supplier = product.supplier || {};
  const srcAreaCode = resolveShipFromAreaCode(product);
  return {
    product,
    quantity: Math.max(1, toNumber(quantity, 1)),
    sku: sku || vid,
    vid,
    srcAreaCode,
    unitSupplierUsd: toNumber(supplier.supplierPrice, 0),
  };
}

async function buildFreightCalculateTipBody(lines, destination) {
  const destAreaCode = String(destination.countryCode || destination.country || 'TG').trim().toUpperCase().slice(0, 2);
  const city = String(destination.city || '').trim();

  const enriched = [];
  for (const line of lines) {
    const base = buildFreightLineDto(line);
    const { productProp, detail } = await enrichProductFreightMeta(line.product);
    const weightG = parseWeightGrams(line.product.weight, detail?.productWeight, detail?.packWeight);
    const volume = parseVolumeCm3(
      line.product.length,
      line.product.width,
      line.product.height,
      detail,
    );
    enriched.push({
      ...base,
      productProp,
      weightG,
      volume,
      wrapWeight: weightG,
    });
  }

  const byOrigin = groupDropshippingLinesByOrigin(enriched);

  const reqDTOS = [];
  for (const [srcAreaCode, group] of byOrigin.entries()) {
    let totalWeight = 0;
    let totalVolume = 0;
    let totalGoodsAmount = 0;
    const freightTrialSkuList = [];
    const skuList = [];
    const productPropSet = new Set();

    for (const row of group) {
      totalWeight += row.weightG * row.quantity;
      totalVolume += row.volume * row.quantity;
      totalGoodsAmount += row.unitSupplierUsd * row.quantity;
      productPropSet.add(row.productProp[0] || 'COMMON');
      freightTrialSkuList.push({
        sku: row.sku,
        skuQuantity: row.quantity,
        vid: row.vid || undefined,
        skuWeight: row.weightG,
        skuVolume: row.volume,
        productPropList: row.productProp,
      });
      skuList.push(row.sku);
    }

    reqDTOS.push({
      srcAreaCode,
      destAreaCode,
      city: city || undefined,
      weight: Math.max(1, Math.round(totalWeight)),
      wrapWeight: Math.max(1, Math.round(totalWeight)),
      volume: Math.max(1, Math.round(totalVolume)),
      productProp: [...productPropSet],
      skuList,
      freightTrialSkuList,
      totalGoodsAmount: totalGoodsAmount > 0 ? Number(totalGoodsAmount.toFixed(2)) : undefined,
    });
  }

  return { reqDTOS, destAreaCode };
}

function supplierUsdFromCjRow(row) {
  const postage = toNumber(row.wrapPostage ?? row.postage ?? row.logisticPrice, 0);
  return postage;
}

function applyShippingMarginUsd(usd) {
  const marginPct = toNumber(cjConfig.shippingMarginPercent, 0);
  if (marginPct <= 0) return usd;
  return usd * (1 + marginPct / 100);
}

function customerPriceXofFromUsd(usd) {
  return Math.round(convertUsdPriceToXof(applyShippingMarginUsd(usd)));
}

function normalizeCJShippingOptions(rawRows = []) {
  const rows = Array.isArray(rawRows) ? rawRows : [];
  const options = [];

  for (const row of rows) {
    if (!row || row.error || row.errorEn) continue;
    const logisticName = String(
      row.option?.enName
      || row.option?.cnName
      || row.logisticName
      || row.channel?.enName
      || '',
    ).trim();
    if (!logisticName) continue;

    const optionId = String(row.optionId || row.option?.id || row.channelId || '').trim();
    const supplierPriceUsd = supplierUsdFromCjRow(row);
    if (!Number.isFinite(supplierPriceUsd) || supplierPriceUsd < 0) continue;

    const aging = parseAgingLabel(row.arrivalTime || row.option?.arrivalTime || row.logisticAging);
    const stableId = optionId
      ? `cj:${optionId}`
      : `cj:${crypto.createHash('sha1').update(logisticName).digest('hex').slice(0, 16)}`;

    options.push({
      id: stableId,
      provider: 'CJdropshipping',
      logisticName,
      price: Number(supplierPriceUsd.toFixed(2)),
      currency: 'USD',
      customerPrice: customerPriceXofFromUsd(supplierPriceUsd),
      customerCurrency: 'XOF',
      estimatedDelivery: {
        minDays: aging.minDays,
        maxDays: aging.maxDays,
        label: aging.label,
      },
      channelId: row.channelId || row.channel?.id || null,
      optionId: optionId || null,
      raw: {
        postage: row.postage,
        wrapPostage: row.wrapPostage,
        arrivalTime: row.arrivalTime || row.option?.arrivalTime,
      },
    });
  }

  options.sort((a, b) => a.customerPrice - b.customerPrice);
  return options;
}

function mergeMultiOriginOptions(optionGroups) {
  if (!optionGroups.length) return [];
  if (optionGroups.length === 1) return optionGroups[0];

  const byId = new Map();
  for (const group of optionGroups) {
    for (const opt of group) {
      const prev = byId.get(opt.id);
      if (!prev) {
        byId.set(opt.id, { ...opt });
        continue;
      }
      prev.price = Number((prev.price + opt.price).toFixed(2));
      prev.customerPrice = customerPriceXofFromUsd(prev.price);
      if (prev.estimatedDelivery?.maxDays != null && opt.estimatedDelivery?.maxDays != null) {
        prev.estimatedDelivery.minDays = Math.max(prev.estimatedDelivery.minDays || 0, opt.estimatedDelivery.minDays || 0);
        prev.estimatedDelivery.maxDays = Math.max(prev.estimatedDelivery.maxDays || 0, opt.estimatedDelivery.maxDays || 0);
        prev.estimatedDelivery.label = `${prev.estimatedDelivery.minDays}–${prev.estimatedDelivery.maxDays} jours`;
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.customerPrice - b.customerPrice);
}

async function callFreightCalculateTip(reqDTOS) {
  const response = await cjClient.post('/logistic/freightCalculateTip', { reqDTOS });
  const data = response?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.respDTOS)) return data.respDTOS;
  return [];
}

async function fetchCjShippingOptionsForLines(lines, destination = {}) {
  const china = calculateChinaDomesticShipping(lines);
  const { reqDTOS } = await buildFreightCalculateTipBody(lines, destination).catch(() => ({ reqDTOS: [] }));
  const options = [{
    id: 'dango-import:china-domestic',
    provider: 'Dango Import',
    logisticName: 'Shipping Chine (transitaire)',
    price: china.usd,
    currency: 'USD',
    customerPrice: china.fcfa,
    customerCurrency: 'XOF',
    estimatedDelivery: null,
    channelId: null,
    optionId: null,
    raw: {
      usdPerGroup: china.usdPerGroup,
      groupCount: china.groupCount,
    },
  }];
  return { options, reqDTOS, chinaDomesticShipping: china };
}

function findShippingOptionById(options, shippingOptionId) {
  const id = String(shippingOptionId || '').trim();
  return (options || []).find((o) => o.id === id) || null;
}

module.exports = {
  parseAgingLabel,
  normalizeCJShippingOptions,
  fetchCjShippingOptionsForLines,
  findShippingOptionById,
  buildFreightCalculateTipBody,
  customerPriceXofFromUsd,
  resolveVariant,
};
