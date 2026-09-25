const Product = require('../../Models/Product');
const SupplierSyncJob = require('../../Models/SupplierSyncJob');
const { cjConfig, assertCjConfigured } = require('../../config/cj');
const { getCJProductDetail } = require('./cjProductService');
const { mapCJProductToDangoProduct } = require('./cjMapper');
const { appendJobLog } = require('./cjImportService');
const { calculateMargin, toNumber } = require('../../utils/dropshippingCalculations');

function applyMappedToProductDocument(product, mapped) {
  product.costPrice = mapped.supplier.supplierPrice;
  product.stock = mapped.stock;
  product.variants = mapped.variants;
  if (mapped.images?.length) {
    product.images = mapped.images;
    product.image = mapped.image || mapped.images[0]?.url || product.image;
  }
  product.supplier = {
    ...product.supplier?.toObject?.() || product.supplier,
    ...mapped.supplier,
    lastSyncedAt: new Date(),
  };
  product.syncStatus = 'success';
  product.syncError = '';
  product.lastSyncErrorAt = null;

  const margin = calculateMargin({
    sellingPrice: product.price,
    supplierPrice: product.supplier.supplierPrice,
    supplierShippingCost: product.supplier.shippingCost,
    otherCosts: product.otherCosts,
  });
  product.estimatedProfit = margin.estimatedProfit;
  product.marginPercent = margin.marginPercent;
  product.isDropshippingActive = mapped.stock > 0 && product.isDropshippingActive !== false;
}

async function syncSingleCjProduct(productId) {
  const product = await Product.findOne({
    _id: productId,
    sourceType: 'DROPSHIPPING',
    'supplier.platform': cjConfig.platformKey,
  });
  if (!product) {
    const err = new Error('Produit CJ introuvable.');
    err.status = 404;
    throw err;
  }

  const pid = product.supplier?.productId;
  if (!pid) {
    const err = new Error('Identifiant CJ manquant.');
    err.status = 400;
    throw err;
  }

  assertCjConfigured();
  product.syncStatus = 'running';
  await product.save();

  try {
    const detail = await getCJProductDetail(pid);
    const listItem = {
      externalProductId: pid,
      name: product.name,
      supplierPrice: detail?.sellPrice,
      stock: detail?.warehouseInventoryNum,
    };
    const mapped = mapCJProductToDangoProduct(listItem, detail);
    applyMappedToProductDocument(product, mapped);
    await product.save();
    return { success: true, product: product.toObject() };
  } catch (error) {
    product.syncStatus = 'failed';
    product.syncError = error.message;
    product.lastSyncErrorAt = new Date();
    await product.save();
    return { success: false, product: product.toObject(), message: error.message };
  }
}

async function runSyncJob(jobId) {
  const job = await SupplierSyncJob.findById(jobId);
  if (!job || job.status === 'running') return;

  job.status = 'running';
  job.startedAt = new Date();
  job.error = '';
  await job.save();
  await appendJobLog(job, 'CJ SYNC STARTED');

  try {
    assertCjConfigured();
    if (!cjConfig.syncEnabled) {
      throw new Error('Synchronisation CJ désactivée (CJ_SYNC_ENABLED=false).');
    }

    const query = { sourceType: 'DROPSHIPPING', 'supplier.platform': cjConfig.platformKey };
    const limit = Math.max(1, toNumber(job.params?.limit, 500));
    const products = await Product.find(query).sort({ 'supplier.lastSyncedAt': 1 }).limit(limit);

    job.progress.totalPages = 1;
    job.progress.received = products.length;

    for (const product of products) {
      const result = await syncSingleCjProduct(product._id);
      if (result.success) job.progress.updated += 1;
      else job.progress.failed += 1;
      await job.save();
    }

    job.status = 'success';
    await appendJobLog(
      job,
      `CJ SYNC FINISHED — MAJ ${job.progress.updated}, erreurs ${job.progress.failed}`,
    );
  } catch (error) {
    job.status = 'failed';
    job.error = error.message;
    await appendJobLog(job, `CJ SYNC FAILED: ${error.message}`, 'error');
  } finally {
    job.finishedAt = new Date();
    await job.save();
  }
}

function scheduleSyncJob(jobId) {
  setImmediate(() => {
    runSyncJob(jobId).catch((err) => {
      console.error('[cjSyncService] job error:', err.message);
    });
  });
}

async function startSyncJob(params, createdBy) {
  assertCjConfigured();
  const job = await SupplierSyncJob.create({
    supplier: 'cj',
    type: 'sync',
    status: 'pending',
    params: params || {},
    createdBy: createdBy || 'admin',
  });
  scheduleSyncJob(job._id);
  return job.toObject();
}

async function getCjDashboardStats() {
  const baseQuery = { sourceType: 'DROPSHIPPING', 'supplier.platform': cjConfig.platformKey };
  const [importedCount, activeCount, lastJob, lastFailedJob] = await Promise.all([
    Product.countDocuments(baseQuery),
    Product.countDocuments({ ...baseQuery, isDropshippingActive: true, stock: { $gt: 0 } }),
    SupplierSyncJob.findOne({ supplier: 'cj' }).sort({ createdAt: -1 }).lean(),
    SupplierSyncJob.findOne({ supplier: 'cj', status: 'failed' }).sort({ finishedAt: -1 }).lean(),
  ]);

  const runningJob = await SupplierSyncJob.findOne({ supplier: 'cj', status: { $in: ['pending', 'running'] } })
    .sort({ createdAt: -1 })
    .lean();

  return {
    importedCount,
    activeCount,
    lastJob,
    lastError: lastFailedJob?.error || lastJob?.error || '',
    runningJob,
  };
}

module.exports = {
  syncSingleCjProduct,
  runSyncJob,
  startSyncJob,
  getCjDashboardStats,
  applyMappedToProductDocument,
};
