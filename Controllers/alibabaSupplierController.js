const Product = require('../Models/Product');
const AlibabaProduct = require('../Models/AlibabaProduct');
const { alibabaConfig } = require('../config/alibaba');
const { testConnection, alibabaCall } = require('../services/alibaba/alibabaClient');
const {
  getAuthStatus,
  getAuthorizeUrl,
  createOauthState,
  consumeOauthState,
  exchangeAuthorizationCode,
  getRedirectUri,
} = require('../services/alibaba/alibabaTokenService');
const {
  searchAlibabaForAdmin,
  getAlibabaProductForAdmin,
  getImportStatus,
  importAlibabaProductForAdmin,
  buildPricingPreview,
} = require('../services/alibaba/alibabaExplorerService');
const { getAlibabaRawProduct } = require('../services/alibaba/alibabaProductService');
const {
  upsertAlibabaProduct,
  validateProductQualityForPublication,
} = require('../services/alibaba/alibabaImportService');

function handleError(res, error) {
  let status = error.status || 500;
  if (status === 401 || status === 403) status = 502;
  return res.status(status).json({
    success: false,
    message: error.message || 'Erreur Alibaba.',
    code: error.code || undefined,
    alibaba: Boolean(error.alibabaOrigin || error.alibaba),
  });
}

function adminId(req) {
  return req.admin?.email || req.user?.email || req.user?.adminName || 'admin';
}

function mapAlibabaProductForAdmin(doc) {
  if (!doc) return null;
  const product = doc.toObject ? doc.toObject() : { ...doc };
  const sourcePriceTiers = Array.isArray(product.pricing?.tiers)
    ? product.pricing.tiers.map((tier) => ({
        minQty: tier.minQuantity ?? tier.minQty ?? 1,
        maxQty: tier.maxQuantity ?? tier.maxQty ?? null,
        price: tier.price ?? 0,
        currency: tier.currency || product.pricing?.currency || 'USD',
      }))
    : Array.isArray(product.normalized?.sourcePriceTiers)
      ? product.normalized.sourcePriceTiers
      : [];

  const sellingPrice = Number(
    product.normalized?.pricing?.sellingPrice
    ?? product.normalized?.pricing?.price
    ?? product.normalized?.price
    ?? product.price
    ?? product.pricing?.sourcePrice
    ?? 0,
  );

  return {
    ...product,
    _id: product._id,
    name: product.name || product.title || '',
    description: product.description || '',
    category: product.category || product.normalized?.category || '',
    brand: product.brand || product.normalized?.brand || '',
    price: sellingPrice > 0 ? sellingPrice : Number(product.pricing?.sourcePrice || 0),
    image: product.mainImage || (Array.isArray(product.images) ? product.images[0]?.url : '') || '',
    images: Array.isArray(product.images) ? product.images : [],
    sourceProductId: product.sourceProductId || product.externalProductId || '',
    supplier: {
      ...(product.supplier || {}),
      platform: 'alibaba',
      productId: product.sourceProductId || product.externalProductId || '',
      productUrl: product.sourceUrl || product.supplier?.productUrl || '',
    },
    importStatus: product.status === 'ERROR' ? 'SYNC_ERROR' : product.status || 'IMPORTED',
    isPublished: Boolean(product.isPublished),
    importWarnings: Array.isArray(product.importWarnings) ? product.importWarnings : [],
    importErrors: Array.isArray(product.importErrors) ? product.importErrors : [],
    sourcePriceTiers,
    rawAlibabaData: product.rawPayload || product.normalized || {},
    externalSourceKey: `alibaba:${product.sourceProductId || product.externalProductId || product._id}`,
    lastSyncedAt: product.lastSyncedAt || product.updatedAt || new Date(),
  };
}

exports.status = async (_req, res) => {
  try {
    const auth = await getAuthStatus();
    return res.json({
      success: true,
      data: {
        auth,
        config: {
          apiEnabled: alibabaConfig.enabled,
          gateway: alibabaConfig.gateway,
          cnyToXofRate: alibabaConfig.cnyToXofRate,
          productGetPath: alibabaConfig.productGetPath,
          productSearchPath: alibabaConfig.productSearchPath,
          productListPath: alibabaConfig.productListPath || '',
          keywordSearchEnabled: Boolean(alibabaConfig.productSearchPath),
          productGetEnabled: Boolean(alibabaConfig.productGetPath),
        },
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.oauthStart = async (_req, res) => {
  try {
    if (!alibabaConfig.appKey || !alibabaConfig.appSecret) {
      return res.status(503).json({ success: false, message: 'App Key / App Secret Alibaba manquants.' });
    }
    if (!getRedirectUri()) {
      return res.status(503).json({
        success: false,
        message: 'Définissez ALIBABA_REDIRECT_URI (même URL que dans la console openapi.alibaba.com).',
      });
    }
    const state = await createOauthState();
    return res.json({
      success: true,
      data: {
        authorizeUrl: getAuthorizeUrl(state),
        redirectUri: getRedirectUri(),
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.oauthCallback = async (req, res) => {
  const successUrl = alibabaConfig.adminSuccessUrl;
  try {
    const { code, state, error } = req.query;
    if (error) {
      return res.redirect(`${successUrl}?alibaba=error&message=${encodeURIComponent(String(error))}`);
    }
    if (!(await consumeOauthState(state))) {
      return res.redirect(`${successUrl}?alibaba=error&message=${encodeURIComponent('Session OAuth expirée. Relancez « Connecter Alibaba ».')}`);
    }
    await exchangeAuthorizationCode(code);
    return res.redirect(`${successUrl}?alibaba=connected`);
  } catch (err) {
    return res.redirect(`${successUrl}?alibaba=error&message=${encodeURIComponent(err.message || 'OAuth Alibaba échoué')}`);
  }
};

exports.oauthExchange = async (req, res) => {
  try {
    const code = String(req.body?.code || '').trim();
    if (!code) {
      return res.status(400).json({ success: false, message: 'Collez le code OAuth renvoyé par Alibaba.com.' });
    }
    await exchangeAuthorizationCode(code);
    const auth = await getAuthStatus();
    return res.json({ success: true, message: 'Access token Alibaba enregistré.', data: { auth } });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.test = async (_req, res) => {
  try {
    const data = await testConnection();
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.searchProducts = async (req, res) => {
  try {
    const result = await searchAlibabaForAdmin({
      page: req.query.page,
      size: req.query.size,
      keyword: req.query.keyword,
      categoryId: req.query.categoryId,
      minPrice: req.query.minPrice,
      maxPrice: req.query.maxPrice,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('[alibaba] searchProducts:', error.code, error.message);
    return handleError(res, error);
  }
};

exports.getProductDetail = async (req, res) => {
  try {
    const data = await getAlibabaProductForAdmin(req.params.pid);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('[alibaba] getProductDetail:', error.code, error.message);
    return handleError(res, error);
  }
};

exports.getProductRaw = async (req, res) => {
  try {
    const id = req.params.pid || req.query.id || req.query.productId || req.query.keyword;
    if (!id) {
      return res.status(400).json({ success: false, message: 'ID ou URL Alibaba manquant (passer :pid ou ?id=).' });
    }
    const data = await getAlibabaRawProduct(id);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('[alibaba] getProductRaw:', error.code, error.message);
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
      supplierPriceCny: req.body?.supplierPriceCny ?? req.body?.supplierPrice,
      supplierPriceUsd: req.body?.supplierPriceUsd,
      weight: req.body?.weight,
      name: req.body?.name,
      category: req.body?.category,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.importProduct = async (req, res) => {
  try {
    const result = await importAlibabaProductForAdmin(
      req.params.pid,
      {
        publish: req.body?.publish === true,
        update: req.body?.update === true,
        variantIds: req.body?.variantIds,
      },
      { email: adminId(req) },
    );
    if (result.alreadyImported) {
      return res.json({
        success: true,
        alreadyImported: true,
        message: 'Ce produit Alibaba est déjà importé.',
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
    console.error('[alibaba] importProduct:', error.code, error.message);
    return handleError(res, error);
  }
};

exports.importSelected = async (req, res) => {
  try {
    const ids = req.body?.productIds || req.body?.ids || [];
    const results = [];
    for (const id of ids) {
      try {
        const item = await importAlibabaProductForAdmin(id, { publish: false }, { email: adminId(req) });
        results.push({ id, ok: true, alreadyImported: item.alreadyImported, productId: item.product?._id });
      } catch (error) {
        results.push({ id, ok: false, message: error.message });
      }
    }
    return res.json({ success: true, data: { results, imported: results.filter((r) => r.ok).length } });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.getImportedProducts = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || 'all').toLowerCase();
    const sort = String(req.query.sort || 'recent');

    const baseFilter = {
      source: 'ALIBABA',
    };

    if (search) {
      baseFilter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { sourceProductId: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
        { brand: { $regex: search, $options: 'i' } },
      ];
    }

    if (status === 'published') {
      baseFilter.isPublished = true;
    } else if (status === 'draft') {
      baseFilter.isPublished = false;
    } else if (status === 'to_verify') {
      baseFilter.status = 'IMPORTED';
    } else if (status === 'ready_to_publish') {
      baseFilter.status = 'IMPORTED';
    } else if (status === 'sync_error') {
      baseFilter.status = 'ERROR';
    }

    let sortOptions = { updatedAt: -1 };
    if (sort === 'oldest') sortOptions = { createdAt: 1 };
    else if (sort === 'price_asc') sortOptions = { 'pricing.sourcePrice': 1 };
    else if (sort === 'price_desc') sortOptions = { 'pricing.sourcePrice': -1 };
    else if (sort === 'name') sortOptions = { name: 1 };

    const [total, products, statsCounts] = await Promise.all([
      AlibabaProduct.countDocuments(baseFilter),
      AlibabaProduct.find(baseFilter)
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .lean(),
      AlibabaProduct.aggregate([
        {
          $match: { source: 'ALIBABA' },
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            published: { $sum: { $cond: [{ $eq: ['$isPublished', true] }, 1, 0] } },
            drafts: { $sum: { $cond: [{ $eq: ['$isPublished', false] }, 1, 0] } },
            toVerify: { $sum: { $cond: [{ $eq: ['$status', 'IMPORTED'] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const stats = statsCounts[0] || { total: 0, published: 0, drafts: 0, toVerify: 0 };
    const normalizedProducts = (products || []).map(mapAlibabaProductForAdmin);

    return res.json({
      success: true,
      products: normalizedProducts,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit) || 1,
        limit,
      },
      stats,
    });
  } catch (error) {
    console.error('[alibaba] getImportedProducts error:', error.message);
    return handleError(res, error);
  }
};

exports.getImportedProductById = async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    let product = null;
    if (id.match(/^[0-9a-fA-F]{24}$/)) {
      product = await AlibabaProduct.findById(id).lean();
    }
    if (!product) {
      product = await AlibabaProduct.findOne({
        source: 'ALIBABA',
        $or: [
          { sourceProductId: id },
          { externalProductId: id },
        ],
      }).lean();
    }
    if (!product) {
      return res.status(404).json({ success: false, message: 'Produit Alibaba importé introuvable.' });
    }

    const compatible = mapAlibabaProductForAdmin(product);
    const quality = validateProductQualityForPublication(compatible);
    return res.json({
      success: true,
      product: compatible,
      quality,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.updateCommercialData = async (req, res) => {
  try {
    const id = req.params.id;
    let product = await Product.findById(id);
    let sourceType = 'Product';

    if (!product) {
      product = await AlibabaProduct.findById(id);
      sourceType = 'AlibabaProduct';
    }

    if (!product) {
      return res.status(404).json({ success: false, message: 'Produit introuvable.' });
    }

    const allowed = ['name', 'description', 'shortDescription', 'category', 'subCategory', 'price', 'marginPercent', 'shippingInfo', 'brand', 'weight', 'minimumOrderQuantity', 'quantityIncrement'];
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) {
        product[field] = req.body[field];
      }
    });

    if (sourceType === 'AlibabaProduct') {
      if (req.body.name !== undefined) product.name = req.body.name;
      if (req.body.description !== undefined) product.description = req.body.description;
      if (req.body.category !== undefined) product.category = req.body.category;
      if (req.body.brand !== undefined) product.brand = req.body.brand;
      if (req.body.price !== undefined) {
        product.normalized = {
          ...(product.normalized || {}),
          pricing: {
            ...(product.normalized?.pricing || {}),
            sellingPrice: Number(req.body.price),
          },
        };
      }
      if (req.body.isPublished !== undefined) {
        product.isPublished = Boolean(req.body.isPublished);
        product.status = req.body.isPublished ? 'IMPORTED' : 'RAW';
      }
    }

    if (req.body.isPublished !== undefined) {
      if (req.body.isPublished === true) {
        const quality = validateProductQualityForPublication(mapAlibabaProductForAdmin(product));
        if (!quality.canPublish) {
          return res.status(400).json({
            success: false,
            message: 'Publication refusée : le produit ne satisfait pas les règles qualité.',
            errors: quality.errors,
            warnings: quality.warnings,
          });
        }
        if (sourceType === 'Product') {
          product.isPublished = true;
          product.publicationStatus = 'published';
          product.importStatus = 'PUBLISHED';
        } else {
          product.isPublished = true;
          product.status = 'IMPORTED';
        }
      } else {
        if (sourceType === 'Product') {
          product.isPublished = false;
          product.publicationStatus = 'unpublished';
          if (product.importStatus === 'PUBLISHED') {
            product.importStatus = 'READY_TO_PUBLISH';
          }
        } else {
          product.isPublished = false;
          product.status = 'RAW';
        }
      }
    }

    product.updatedAt = new Date();
    await product.save();
    const responseProduct = product && typeof product.toObject === 'function' ? product.toObject() : product;
    return res.json({
      success: true,
      message: 'Données commerciales mises à jour.',
      product: mapAlibabaProductForAdmin(responseProduct) || responseProduct,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.syncImportedProduct = async (req, res) => {
  try {
    const id = req.params.id;
    const product = await AlibabaProduct.findById(id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Produit introuvable.' });
    }
    const pid = product.sourceProductId || product.externalProductId || product.supplier?.productId;
    if (!pid) {
      return res.status(400).json({ success: false, message: 'Identifiant fournisseur Alibaba manquant sur ce produit.' });
    }
    const result = await upsertAlibabaProduct(pid, {
      update: true,
      overwriteCommercial: false,
      adminUser: { email: adminId(req) },
    });
    return res.json({
      success: true,
      message: 'Produit synchronisé depuis Alibaba. Données commerciales préservées.',
      data: result,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.validateQuality = async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();

    const alibabaDoc = await AlibabaProduct.findById(id).lean();
    if (alibabaDoc) {
      const product = mapAlibabaProductForAdmin(alibabaDoc);
      return res.json({ success: true, data: validateProductQualityForPublication(product) });
    }

    const product = await Product.findById(id).lean();
    if (!product) {
      return res.status(404).json({ success: false, message: 'Produit introuvable.' });
    }
    const quality = validateProductQualityForPublication(product);
    return res.json({ success: true, data: quality });
  } catch (error) {
    return handleError(res, error);
  }
};