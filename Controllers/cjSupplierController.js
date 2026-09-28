const SupplierSyncJob = require('../Models/SupplierSyncJob');
const { cjConfig } = require('../config/cj');
const { getAuthStatus, testConnection } = require('../services/cj/cjAuthService');
const { getCJProducts, getCJCategories } = require('../services/cj/cjProductService');
const { startImportJob, startSelectiveImportJob } = require('../services/cj/cjImportService');
const {
  searchCJProducts,
  getCJProductForAdmin,
  getImportStatus,
  importCJProductForAdmin,
  buildPricingPreview,
} = require('../services/cj/cjExplorerService');
const { startSyncJob, getCjDashboardStats } = require('../services/cj/cjSyncService');

function handleError(res, error) {
  let status = error.status || 500;
  // Ne jamais renvoyer 401/403 admin : l’intercepteur axios déconnecte l’admin sur 401.
  if (status === 401 || status === 403 || error.code?.startsWith?.('CJ_')) {
    status = 502;
  }
  return res.status(status).json({
    success: false,
    message: error.message || 'Erreur serveur.',
    code: error.code || undefined,
  });
}

function adminId(req) {
  return req.admin?.email || req.user?.email || req.user?.adminName || 'admin';
}

exports.status = async (req, res) => {
  try {
    const auth = getAuthStatus();
    const stats = await getCjDashboardStats();
    return res.json({
      success: true,
      data: {
        auth,
        config: {
          apiEnabled: cjConfig.enabled,
          syncEnabled: cjConfig.syncEnabled,
          importBatchSize: cjConfig.importBatchSize,
          defaultMarginPercent: cjConfig.defaultMarginPercent,
          maxConcurrentRequests: cjConfig.maxConcurrentRequests,
          requestDelayMs: cjConfig.requestDelayMs,
        },
        stats: {
          importedCount: stats.importedCount,
          activeCount: stats.activeCount,
          lastError: stats.lastError,
          lastJob: stats.lastJob,
          runningJob: stats.runningJob,
        },
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.test = async (req, res) => {
  try {
    const result = await testConnection();
    return res.json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.searchProducts = async (req, res) => {
  try {
    const useExplorer = req.query.enriched === '1' || req.query.enriched === 'true';
    const params = {
      page: req.query.page,
      size: req.query.size,
      keyword: req.query.keyword,
      categoryId: req.query.categoryId,
      minPrice: req.query.minPrice,
      maxPrice: req.query.maxPrice,
      country: req.query.country,
      sort: req.query.sort,
      orderBy: req.query.orderBy,
    };
    const result = useExplorer
      ? await searchCJProducts(params)
      : await getCJProducts(params);
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('[cjSupplier] searchProducts:', error.cause?.message || error.message);
    return handleError(res, error);
  }
};

exports.getCategories = async (req, res) => {
  try {
    const categories = await getCJCategories({ refresh: req.query.refresh === '1' });
    return res.json({ success: true, data: categories });
  } catch (error) {
    console.error('[cjSupplier] getCategories:', error.message);
    return handleError(res, error);
  }
};

exports.getProductDetail = async (req, res) => {
  try {
    const data = await getCJProductForAdmin(req.params.pid, {
      countryCode: req.query.country,
    });
    return res.json({ success: true, data });
  } catch (error) {
    console.error('[cjSupplier] getProductDetail:', error.cause?.message || error.message);
    return handleError(res, error);
  }
};

exports.getProductImportStatus = async (req, res) => {
  try {
    const data = await getImportStatus(req.params.pid);
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.previewProductPricing = async (req, res) => {
  try {
    const data = buildPricingPreview({
      supplierPriceUsd: req.body?.supplierPriceUsd ?? req.body?.supplierPrice,
      marginPercent: req.body?.marginPercent,
      shippingCostUsd: req.body?.shippingCostUsd ?? req.body?.shippingCost,
      otherCostsXof: req.body?.otherCosts,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.importProduct = async (req, res) => {
  try {
    const result = await importCJProductForAdmin(
      req.params.pid,
      {
        publish: req.body?.publish === true,
        update: req.body?.update === true,
        variantIds: req.body?.variantIds || req.body?.externalVariantIds,
      },
      { email: adminId(req), adminName: adminId(req) },
    );
    if (result.alreadyImported) {
      return res.json({
        success: true,
        alreadyImported: true,
        message: 'Ce produit est déjà importé.',
        data: {
          productId: result.product._id,
          isPublished: result.product.isPublished,
          name: result.product.name,
        },
      });
    }
    return res.status(result.action === 'created' ? 201 : 200).json({
      success: true,
      alreadyImported: false,
      message: result.action === 'created' ? 'Produit importé en brouillon.' : 'Produit mis à jour.',
      data: {
        action: result.action,
        productId: result.product._id || result.product.id,
        product: result.product,
      },
    });
  } catch (error) {
    console.error('[cjSupplier] importProduct:', error.message);
    return handleError(res, error);
  }
};

exports.updateImportedProduct = async (req, res) => {
  try {
    const result = await importCJProductForAdmin(
      req.params.pid,
      {
        publish: req.body?.publish === true,
        update: true,
        variantIds: req.body?.variantIds || req.body?.externalVariantIds,
      },
      { email: adminId(req), adminName: adminId(req) },
    );
    return res.json({
      success: true,
      message: 'Produit resynchronisé depuis CJ.',
      data: result,
    });
  } catch (error) {
    console.error('[cjSupplier] updateImportedProduct:', error.message);
    return handleError(res, error);
  }
};

exports.importCatalog = async (req, res) => {
  try {
    const job = await startImportJob(req.body || {}, adminId(req));
    return res.status(202).json({
      success: true,
      message: 'Import CJ démarré en arrière-plan.',
      data: job,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.importSelected = async (req, res) => {
  try {
    const productIds = req.body?.productIds || req.body?.pids || [];
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ success: false, message: 'productIds requis.' });
    }
    const job = await startSelectiveImportJob(productIds, {
      publish: req.body?.publish,
    }, adminId(req));
    return res.status(202).json({
      success: true,
      message: 'Import sélectif CJ démarré.',
      data: job,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.sync = async (req, res) => {
  try {
    const job = await startSyncJob(req.body || {}, adminId(req));
    return res.status(202).json({
      success: true,
      message: 'Synchronisation CJ démarrée.',
      data: job,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.syncStatus = async (req, res) => {
  try {
    const jobId = req.query.jobId;
    let job;
    if (jobId) {
      job = await SupplierSyncJob.findOne({ _id: jobId, supplier: 'cj' }).lean();
    } else {
      job = await SupplierSyncJob.findOne({ supplier: 'cj' })
        .sort({ createdAt: -1 })
        .lean();
    }
    if (!job) {
      return res.json({ success: true, data: null });
    }
    return res.json({ success: true, data: job });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.logs = async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const jobs = await SupplierSyncJob.find({ supplier: 'cj' })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('type status progress logs error startedAt finishedAt createdAt params')
      .lean();
    return res.json({ success: true, data: jobs });
  } catch (error) {
    return handleError(res, error);
  }
};
