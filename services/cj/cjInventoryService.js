const cjClient = require('./cjClient');
const { toNumber } = require('../../utils/dropshippingCalculations');

const COUNTRY_LABELS_FR = {
  CN: 'Chine',
  US: 'États-Unis',
  GB: 'Royaume-Uni',
  UK: 'Royaume-Uni',
  FR: 'France',
  DE: 'Allemagne',
  ES: 'Espagne',
  IT: 'Italie',
  AU: 'Australie',
  CA: 'Canada',
  JP: 'Japon',
  KR: 'Corée du Sud',
  RU: 'Russie',
  PL: 'Pologne',
  NL: 'Pays-Bas',
  BE: 'Belgique',
  BJ: 'Bénin',
  TG: 'Togo',
  SN: 'Sénégal',
  CI: "Côte d'Ivoire",
};

function countryLabelFr(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return '';
  return COUNTRY_LABELS_FR[c] || c;
}

async function getCJInventoryByPid(pid) {
  const id = String(pid || '').trim();
  if (!id) return null;
  const data = await cjClient.get('/product/stock/getInventoryByPid', { pid: id });
  const raw = data?.data || data?.result || data;
  if (!raw) return null;
  if (Array.isArray(raw.inventories) || Array.isArray(raw.variantInventories)) {
    return raw;
  }
  if (Array.isArray(raw.inventory)) {
    return { inventories: raw.inventory, variantInventories: raw.variantInventories || [] };
  }
  if (Array.isArray(raw)) {
    return { inventories: raw, variantInventories: [] };
  }
  return raw;
}

function sumInventoryFromDetailVariants(detail) {
  const variants = detail?.variants;
  if (!Array.isArray(variants) || !variants.length) return 0;
  return variants.reduce(
    (sum, v) => sum + toNumber(v.variantInventory ?? v.inventoryNum ?? v.stock, 0),
    0,
  );
}

function parseCjStockAndShippingOrigin({ detail = null, listItem = null, inventoryPayload = null } = {}) {
  const warehouses = Array.isArray(inventoryPayload?.inventories) ? inventoryPayload.inventories : [];
  let stockFromWarehouses = warehouses.reduce(
    (sum, row) => sum + toNumber(row.totalInventoryNum ?? row.cjInventoryNum ?? row.storageNum, 0),
    0,
  );

  const variantInventories = Array.isArray(inventoryPayload?.variantInventories)
    ? inventoryPayload.variantInventories
    : [];
  let stockFromVariantInventories = 0;
  variantInventories.forEach((block) => {
    (block.inventory || []).forEach((row) => {
      stockFromVariantInventories += toNumber(
        row.totalInventory ?? row.cjInventory ?? row.factoryInventory,
        0,
      );
    });
  });

  const stockFromDetail = toNumber(
    detail?.warehouseInventoryNum ?? detail?.totalVerifiedInventory ?? listItem?.stock,
    0,
  );
  const stockFromVariants = sumInventoryFromDetailVariants(detail);
  const stockFromList = toNumber(listItem?.stock, 0);

  const stock = Math.max(
    0,
    stockFromWarehouses,
    stockFromVariantInventories,
    stockFromVariants,
    stockFromDetail,
    stockFromList,
  );

  const ranked = [...warehouses].sort(
    (a, b) => toNumber(b.totalInventoryNum, 0) - toNumber(a.totalInventoryNum, 0),
  );
  const primary = ranked.find((w) => toNumber(w.totalInventoryNum, 0) > 0) || ranked[0] || null;

  let shipFromCountryCode = primary?.countryCode || '';
  let shipFromWarehouseName = primary?.areaEn || primary?.countryNameEn || '';

  if (!shipFromCountryCode && variantInventories.length) {
    const firstInv = variantInventories[0]?.inventory?.[0];
    shipFromCountryCode = firstInv?.countryCode || shipFromCountryCode;
  }

  if (!shipFromCountryCode && detail?.variants?.[0]?.inventories?.[0]?.countryCode) {
    shipFromCountryCode = detail.variants[0].inventories[0].countryCode;
  }

  const manufacturerName = String(
    detail?.supplierName
    || detail?.supplierShopName
    || detail?.supplier?.name
    || listItem?.raw?.supplierName
    || '',
  ).trim();

  return {
    stock: Math.max(0, Math.round(stock)),
    shipFromCountryCode: String(shipFromCountryCode || '').toUpperCase(),
    shipFromCountryName: countryLabelFr(shipFromCountryCode),
    shipFromWarehouseName: String(shipFromWarehouseName || '').trim(),
    manufacturerName,
    warehouseInventories: warehouses.map((w) => ({
      countryCode: w.countryCode,
      warehouseName: w.areaEn || w.countryNameEn,
      quantity: toNumber(w.totalInventoryNum, 0),
    })).filter((w) => w.countryCode || w.quantity),
  };
}

module.exports = {
  getCJInventoryByPid,
  parseCjStockAndShippingOrigin,
  countryLabelFr,
};
