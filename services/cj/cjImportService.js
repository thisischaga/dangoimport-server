const Product = require('../../Models/Product');
const SupplierSyncJob = require('../../Models/SupplierSyncJob');
const { cjConfig, assertCjConfigured } = require('../../config/cj');
const { getCJProducts, getCJProductDetail } = require('./cjProductService');
const { mapCJProductToDangoProduct, mapToDropshippingPayload } = require('./cjMapper');
const {
  normalizeDropshippingInput,
  validateDropshippingPayload,
  createDropshippingProduct,
  updateDropshippingProduct,
} = require('../dropshippingService');
const { calculateMargin, toNumber } = require('../../utils/dropshippingCalculations');
const { hydrateCjPayloadMedia } = require('./cjMediaService');
const { getCJInventoryByPid } = require('./cjInventoryService');
const { resolveSkuForCreate } = require('../../utils/productIdentifiers');
const { convertUsdPriceToXof } = require('../../utils/cjCatalogHelpers');

async function appendJobLog(job, message, level = 'info') {
  job.logs.push({ at: new Date(), level, message });
  if (job.logs.length > 500) {
    job.logs = job.logs.slice(-400);
  }
  await job.save();
}

async function findExistingCjProduct(externalProductId, externalSourceKey) {
  return Product.findOne({
    sourceType: 'DROPSHIPPING',
    $or: [
      { externalSourceKey },
      { 'supplier.platform': cjConfig.platformKey, 'supplier.productId': String(externalProductId) },
    ],
  });
}

function buildAdminActor(createdBy) {
  return { email: createdBy || 'admin', adminName: createdBy || 'admin' };
}

async function upsertCJProductFromListItem(listItem, { fetchDetail = true, publish = false, adminUser } = {}) {
  const externalProductId = String(listItem.externalProductId || listItem.id || '').trim();
  if (!externalProductId) {
    const err = new Error('Produit CJ sans identifiant.');
    err.skippable = true;
    throw err;
  }

  let detail = null;
  let inventory = null;
  if (fetchDetail) {
    try {
      detail = await getCJProductDetail(externalProductId);
      inventory = await getCJInventoryByPid(externalProductId);
    } catch (error) {
      detail = null;
      inventory = null;
    }
  }

  const mapped = await mapCJProductToDangoProduct(listItem, detail, inventory);
  let payload = mapToDropshippingPayload(mapped, { publish });
  payload = await hydrateCjPayloadMedia(payload);
  const existing = await findExistingCjProduct(externalProductId, mapped.externalSourceKey);

  if (existing) {
    const merged = {
      ...payload,
      price: payload.price,
      salePrice: existing.salePrice,
      isPublished: existing.isPublished,
      sku: existing.sku,
    };
    const margin = calculateMargin({
      sellingPrice: merged.price,
      supplierPrice: merged.costPrice ?? convertUsdPriceToXof(merged.supplier?.supplierPrice),
      supplierShippingCost: merged.supplier?.shippingCost,
      otherCosts: merged.otherCosts ?? existing.otherCosts,
    });
    merged.estimatedProfit = margin.estimatedProfit;
    merged.marginPercent = margin.marginPercent;

    const updated = await updateDropshippingProduct(existing._id, merged, adminUser);
    return { action: 'updated', product: updated };
  }

  const normalized = normalizeDropshippingInput(payload);
  const errors = validateDropshippingPayload(normalized);
  if (errors.length) {
    const err = new Error(errors.join(' '));
    err.skippable = true;
    throw err;
  }
  normalized.sku = await resolveSkuForCreate(normalized.sku);
  normalized.history = [{
    action: 'Import CJdropshipping',
    comment: `Produit importé depuis CJ (pid ${externalProductId}).`,
    performedBy: adminUser?.email || 'admin',
    role: 'admin',
    date: new Date(),
  }];

  const created = await Product.create(normalized);
  return { action: 'created', product: created.toObject() };
}

async function processImportPage(job, page, adminUser) {
  const params = job.params || {};
  const size = Math.min(100, Math.max(1, toNumber(params.size, cjConfig.importBatchSize)));
  const result = await getCJProducts({
    page,
    size,
    keyword: params.keyword,
    categoryId: params.categoryId,
    minPrice: params.minPrice,
    maxPrice: params.maxPrice,
    country: params.country,
    sort: params.sort,
  });

  const products = result.products || [];
  job.progress.currentPage = page;
  job.progress.received += products.length;

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  const maxProducts = params.maxProducts != null ? toNumber(params.maxProducts, 0) : 0;
  const totalProcessed = job.progress.imported + job.progress.updated + job.progress.skipped + job.progress.failed;

  for (const item of products) {
    if (maxProducts > 0 && totalProcessed + imported + updated + skipped + failed >= maxProducts) {
      break;
    }
    try {
      const upsert = await upsertCJProductFromListItem(item, {
        fetchDetail: params.fetchDetail !== false,
        publish: Boolean(params.publish),
        adminUser,
      });
      if (upsert.action === 'created') imported += 1;
      else updated += 1;
    } catch (error) {
      if (error.skippable) skipped += 1;
      else failed += 1;
      await appendJobLog(
        job,
        `Échec pid ${item.externalProductId || '?'}: ${error.message}`,
        'error',
      );
    }
  }

  job.progress.imported += imported;
  job.progress.updated += updated;
  job.progress.skipped += skipped;
  job.progress.failed += failed;

  await appendJobLog(
    job,
    `Page ${page}: reçus ${products.length}, créés ${imported}, MAJ ${updated}, ignorés ${skipped}, erreurs ${failed}`,
  );

  return { hasMore: products.length > 0 && page < (result.pagination?.totalPages || page), result };
}

async function runImportJob(jobId) {
  const job = await SupplierSyncJob.findById(jobId);
  if (!job || job.status === 'running') return;

  job.status = 'running';
  job.startedAt = new Date();
  job.error = '';
  await job.save();
  await appendJobLog(job, 'CJ IMPORT STARTED');

  const adminUser = buildAdminActor(job.createdBy);
  const pages = Math.max(1, toNumber(job.params?.pages, 1));
  job.progress.totalPages = pages;

  try {
    assertCjConfigured();
    for (let page = 1; page <= pages; page += 1) {
      const { hasMore } = await processImportPage(job, page, adminUser);
      if (!hasMore && page >= pages) break;
    }
    job.status = 'success';
    await appendJobLog(job, 'CJ IMPORT FINISHED');
  } catch (error) {
    job.status = 'failed';
    job.error = error.message;
    await appendJobLog(job, `CJ IMPORT FAILED: ${error.message}`, 'error');
  } finally {
    job.finishedAt = new Date();
    await job.save();
  }
}

async function runSelectiveImportJob(jobId) {
  const job = await SupplierSyncJob.findById(jobId);
  if (!job || job.status === 'running') return;

  job.status = 'running';
  job.startedAt = new Date();
  job.error = '';
  await job.save();
  await appendJobLog(job, 'CJ SELECTIVE IMPORT STARTED');

  const adminUser = buildAdminActor(job.createdBy);
  const productIds = Array.isArray(job.params?.productIds) ? job.params.productIds : [];

  try {
    assertCjConfigured();
    for (const pid of productIds) {
      try {
        const detail = await getCJProductDetail(pid);
        const listItem = {
          externalProductId: String(pid),
          name: detail?.productNameEn,
          supplierPrice: detail?.sellPrice,
          stock: detail?.warehouseInventoryNum,
          images: detail?.productImage ? [{ url: detail.productImage, isPrimary: true }] : [],
          image: detail?.productImage,
        };
        const upsert = await upsertCJProductFromListItem(listItem, {
          fetchDetail: false,
          publish: Boolean(job.params?.publish),
          adminUser,
        });
        if (upsert.action === 'created') job.progress.imported += 1;
        else job.progress.updated += 1;
        job.progress.received += 1;
      } catch (error) {
        if (error.skippable) job.progress.skipped += 1;
        else job.progress.failed += 1;
        await appendJobLog(job, `Selectif ${pid}: ${error.message}`, 'error');
      }
      await job.save();
    }
    job.status = 'success';
    await appendJobLog(job, 'CJ SELECTIVE IMPORT FINISHED');
  } catch (error) {
    job.status = 'failed';
    job.error = error.message;
    await appendJobLog(job, `CJ SELECTIVE IMPORT FAILED: ${error.message}`, 'error');
  } finally {
    job.finishedAt = new Date();
    await job.save();
  }
}

function scheduleJobRunner(jobId, type) {
  const runner = type === 'selective_import' ? runSelectiveImportJob : runImportJob;
  setImmediate(() => {
    runner(jobId).catch((err) => {
      console.error('[cjImportService] job error:', err.message);
    });
  });
}

async function startImportJob(params, createdBy) {
  assertCjConfigured();
  const job = await SupplierSyncJob.create({
    supplier: 'cj',
    type: 'import',
    status: 'pending',
    params,
    createdBy: createdBy || 'admin',
  });
  scheduleJobRunner(job._id, 'import');
  return job.toObject();
}

async function startSelectiveImportJob(productIds, options, createdBy) {
  assertCjConfigured();
  const job = await SupplierSyncJob.create({
    supplier: 'cj',
    type: 'selective_import',
    status: 'pending',
    params: { productIds, ...options },
    createdBy: createdBy || 'admin',
  });
  scheduleJobRunner(job._id, 'selective_import');
  return job.toObject();
}

module.exports = {
  upsertCJProductFromListItem,
  runImportJob,
  runSelectiveImportJob,
  startImportJob,
  startSelectiveImportJob,
  appendJobLog,
};
