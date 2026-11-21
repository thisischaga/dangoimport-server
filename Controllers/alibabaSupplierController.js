const mongoose = require('mongoose');
const AlibabaProduct = require('../Models/AlibabaProduct');
const AlibabaConfig = require('../Models/AlibabaConfig');
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
  getAlibabaConfig,
  updateAlibabaConfig,
  repriceAlibabaCatalog,
  calculateAlibabaPrice,
  calculateAlibabaVolumeCm3,
} = require('../services/alibaba/alibabaPricingService');
const {
  getAlibabaFreightConfig,
  updateAlibabaFreightConfig,
} = require('../services/alibaba/alibabaFreightService');
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

  const rawPayloadCandidate = Array.isArray(product.rawPayload) && product.rawPayload.length === 1
    ? product.rawPayload[0]
    : product.rawPayload;
  const rawPayload = rawPayloadCandidate || product.normalized || product.rawSections || {};
  const rawDescription = (
    product.description
    || product.normalized?.description
    || rawPayload?.description
    || rawPayload?.result_data?.description
    || rawPayload?.product?.description
    || rawPayload?.raw?.result?.result_data?.description
    || ''
  );

  const rawSpecsSource = Array.isArray(product.attributes) ? product.attributes : [];
  const rawKeyAttributes = rawPayload?.keyAttributes || rawPayload?.raw?.keyAttributes || {};
  const rawKeyAttributesList = Array.isArray(rawKeyAttributes) && rawKeyAttributes.length === 1
    ? rawKeyAttributes[0]
    : rawKeyAttributes;
  const keyAttributeRows = Array.isArray(rawKeyAttributesList.attributes || rawKeyAttributesList.attribute_list || rawKeyAttributesList.attr_list || rawKeyAttributesList.product_attributes)
    ? (rawKeyAttributesList.attributes || rawKeyAttributesList.attribute_list || rawKeyAttributesList.attr_list || rawKeyAttributesList.product_attributes)
    : [];

  const specifications = [
    ...(Array.isArray(product.specifications) ? product.specifications : []),
    ...rawSpecsSource.map((entry) => ({
      key: entry?.name || entry?.attr_name_desc || entry?.attr_name || entry?.attributeName || entry?.key || '',
      value: entry?.value || entry?.attr_value_desc || entry?.attr_value || entry?.attributeValue || entry?.prop_value || '',
    })),
    ...keyAttributeRows.map((entry) => ({
      key: entry?.attr_name_desc || entry?.attr_name || entry?.attributeName || entry?.prop_name || entry?.name || entry?.key || '',
      value: entry?.attr_value_desc || entry?.attr_value || entry?.attributeValue || entry?.prop_value || entry?.value || '',
    })),
  ].filter((row) => row && row.key && row.value).map((row) => ({
    key: String(row.key).trim(),
    value: String(row.value).trim(),
  }));

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
    ?? product.pricing?.calculation?.salePrice
    ?? product.price
    ?? 0,
  );

  const galleryImages = (Array.isArray(product.images) && product.images.length > 0)
    ? product.images
    : (Array.isArray(rawPayload?.images) && rawPayload.images.length > 0)
      ? rawPayload.images
      : (Array.isArray(rawPayload?.gallery) && rawPayload.gallery.length > 0)
        ? rawPayload.gallery
        : [];

  const primaryImage = product.mainImage
    || (Array.isArray(galleryImages) ? (typeof galleryImages[0] === 'string' ? galleryImages[0] : galleryImages[0]?.url || '') : '')
    || (typeof rawPayload?.mainImage === 'string' ? rawPayload.mainImage : '')
    || ''; 

  return {
    ...product,
    _id: product._id,
    name: product.name || product.title || '',
    description: rawDescription || '',
    shortDescription: product.shortDescription || String(rawDescription || '').slice(0, 220),
    category: product.category || product.normalized?.category || '',
    brand: product.brand || product.normalized?.brand || '',
    price: sellingPrice > 0 ? sellingPrice : Number(product.price || 0),
    image: primaryImage,
    images: galleryImages,
    specifications,
    sourceProductId: product.sourceProductId || product.externalProductId || '',
    supplier: {
      ...(product.supplier || {}),
      platform: 'alibaba',
      productId: product.sourceProductId || product.externalProductId || '',
      productUrl: product.sourceUrl || product.supplier?.productUrl || '',
    },
    importStatus: product.status === 'ERROR' ? 'SYNC_ERROR' : product.status || 'IMPORTED',
    isPublished: Boolean(product.isPublished),
    isDropshippingActive: product.isDropshippingActive !== false,
    importWarnings: Array.isArray(product.importWarnings) ? product.importWarnings : [],
    importErrors: Array.isArray(product.importErrors) ? product.importErrors : [],
    sourcePriceTiers,
    priceBreakdown: product.pricing?.calculation || null,
    rawAlibabaData: rawPayload,
    externalSourceKey: `alibaba:${product.sourceProductId || product.externalProductId || product._id}`,
    lastSyncedAt: product.lastSyncedAt || product.updatedAt || new Date(),
  };
}

exports.getConfig = async (_req, res) => {
  try {
    const config = await getAlibabaConfig({ forceRefresh: true });
    const history = await AlibabaConfig.findOne({ key: 'default' }).select('updatedBy updatedAt changeHistory').lean();
    return res.json({
      success: true,
      config: {
        ...config,
        updatedBy: history?.updatedBy || '',
        updatedAt: history?.updatedAt || null,
        changeHistory: history?.changeHistory || [],
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.updateConfig = async (req, res) => {
  try {
    const result = await updateAlibabaConfig(req.body?.config || req.body || {}, adminId(req));
    let repricing;
    try {
      repricing = await repriceAlibabaCatalog(result.config, adminId(req));
    } catch (error) {
      console.error('[alibaba] catalog repricing failed after config update:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Configuration enregistrée, mais le recalcul du catalogue a échoué. Contactez le support avant de republier les produits.',
      });
    }
    return res.json({
      success: true,
      message: 'Configuration Alibaba enregistrée.',
      config: result.config,
      changedFields: result.changedFields,
      repricedProducts: repricing.updated,
      skippedProducts: repricing.skipped,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.getFreightConfig = async (_req, res) => {
  try {
    const config = await getAlibabaFreightConfig({ forceRefresh: true });
    return res.json({ success: true, config });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.updateFreightConfig = async (req, res) => {
  try {
    const result = await updateAlibabaFreightConfig(req.body?.config || req.body || {}, adminId(req));
    return res.json({
      success: true,
      message: 'Paramètres de transport InterCargo enregistrés.',
      config: result.config,
      changedFields: result.changedFields,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

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
    const data = await buildPricingPreview({
      supplierPrice: req.body?.supplierPrice,
      supplierPriceCny: req.body?.supplierPriceCny,
      supplierPriceUsd: req.body?.supplierPriceUsd,
      currency: req.body?.currency,
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

    const sourceFilter = {
      $or: [
        { source: 'ALIBABA' },
        { source: 'alibaba' },
        { isAlibaba: true },
      ],
    };
    const filters = [sourceFilter];

    if (search) {
      filters.push({ $or: [
        { name: { $regex: search, $options: 'i' } },
        { sourceProductId: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
        { brand: { $regex: search, $options: 'i' } },
      ] });
    }

    if (status === 'published') {
      filters.push({ isPublished: true });
    } else if (status === 'draft') {
      filters.push({ isPublished: false });
    } else if (status === 'to_verify') {
      filters.push({ status: 'IMPORTED' });
    } else if (status === 'ready_to_publish') {
      filters.push({ status: 'IMPORTED' });
    } else if (status === 'sync_error') {
      filters.push({ status: 'ERROR' });
    }
    const baseFilter = { $and: filters };

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
          $match: {
            ...sourceFilter,
          },
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
    if (!product || !(product.isAlibaba || String(product.source || '').toUpperCase() === 'ALIBABA')) {
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

exports.deleteImportedProduct = async (req, res) => {
  try {
    const rawId = String(req.params.id || '').trim();
    if (!rawId) {
      return res.status(400).json({ success: false, message: 'Identifiant produit requis.' });
    }

    const mongoId = mongoose.Types.ObjectId.isValid(rawId) ? rawId : null;
    const alibabaProduct = await AlibabaProduct.findOne({
      source: 'ALIBABA',
      $or: [
        ...(mongoId ? [{ _id: mongoId }] : []),
        { sourceProductId: rawId },
        { externalProductId: rawId },
      ],
    }).lean();

    const deletedAlibabaProduct = alibabaProduct
      ? await AlibabaProduct.findByIdAndDelete(alibabaProduct._id)
      : await AlibabaProduct.findOneAndDelete({
          source: 'ALIBABA',
          $or: [
            { sourceProductId: rawId },
            { externalProductId: rawId },
          ],
        });

    if (!deletedAlibabaProduct) {
      return res.status(404).json({ success: false, message: 'Produit Alibaba importé introuvable.' });
    }

    return res.json({
      success: true,
      message: 'Produit Alibaba supprimé du catalogue.',
      deleted: {
        alibabaProduct: true,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.updateCommercialData = async (req, res) => {
  try {
    const id = req.params.id;
    const product = await AlibabaProduct.findById(id);

    if (!product || !(product.isAlibaba || String(product.source || '').toUpperCase() === 'ALIBABA')) {
      return res.status(404).json({ success: false, message: 'Produit introuvable.' });
    }

    const changedFields = [];
    const allowed = ['name', 'description', 'shortDescription', 'category', 'subCategory', 'shippingInfo', 'brand', 'weight', 'minimumOrderQuantity', 'quantityIncrement'];
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) {
        product[field] = req.body[field];
        changedFields.push(field);
      }
    });

    if (req.body.price !== undefined) {
      const price = Number(req.body.price);
      if (!Number.isFinite(price) || price <= 0) {
        return res.status(400).json({ success: false, message: 'Le prix manuel doit être supérieur à zéro.' });
      }
      product.pricing.manualSalePrice = price;
      changedFields.push('price');
    }
    if (req.body.clearManualPrice === true) {
      product.pricing.manualSalePrice = null;
      changedFields.push('price');
    }
    if (req.body.marginPercent !== undefined) {
      const margin = req.body.marginPercent === null || req.body.marginPercent === ''
        ? null
        : Number(req.body.marginPercent);
      if (margin !== null && (!Number.isFinite(margin) || margin < 0 || margin > 500)) {
        return res.status(400).json({ success: false, message: 'La marge produit doit être comprise entre 0 et 500 %.' });
      }
      product.pricing.marginPercentOverride = margin;
      changedFields.push('marginPercent');
    }

    const logisticsFields = [
      'weight', 'weightUnit', 'netWeight', 'grossWeight',
      'packageLength', 'packageWidth', 'packageHeight', 'dimensionUnit',
      'airCategory', 'seaCategory', 'localDeliveryProfile', 'fragile',
      'hollowOrBulky', 'allowedTransportModes', 'volumeCm3', 'volumetricEnabled',
      'localAdditionalParcelCount',
    ];
    if (req.body.logistics && typeof req.body.logistics === 'object') {
      product.logistics = product.logistics || {};
      for (const field of logisticsFields) {
        if (req.body.logistics[field] === undefined) continue;
        const value = req.body.logistics[field];
        if (['weight', 'netWeight', 'grossWeight', 'packageLength', 'packageWidth', 'packageHeight', 'volumeCm3', 'localAdditionalParcelCount'].includes(field)
          && value !== null && value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
          return res.status(400).json({ success: false, message: `Valeur logistique invalide : ${field}.` });
        }
        if (field === 'allowedTransportModes'
          && (!Array.isArray(value) || value.some((mode) => !['air', 'sea'].includes(mode)))) {
          return res.status(400).json({ success: false, message: 'Modes de transport invalides.' });
        }
        if (['fragile', 'hollowOrBulky'].includes(field) && typeof value !== 'boolean') {
          return res.status(400).json({ success: false, message: `${field} doit être un booléen.` });
        }
        if (field === 'localDeliveryProfile'
          && value !== ''
          && !['S', 'M', 'L', 'XL'].includes(String(value).toUpperCase())) {
          return res.status(400).json({ success: false, message: 'Le profil local doit être S, M, L, XL ou automatique.' });
        }
        if (field === 'volumetricEnabled' && value !== null && value !== '' && typeof value !== 'boolean') {
          return res.status(400).json({ success: false, message: 'volumetricEnabled doit être vrai, faux ou hérité.' });
        }
        product.logistics[field] = value === '' ? null : value;
        changedFields.push(`logistics.${field}`);
      }
      const dims = product.logistics;
      if (['packageLength', 'packageWidth', 'packageHeight', 'dimensionUnit'].some((key) => req.body.logistics[key] !== undefined)) {
        dims.volumeCm3 = dims.packageLength > 0 && dims.packageWidth > 0 && dims.packageHeight > 0 && dims.dimensionUnit
          ? calculateAlibabaVolumeCm3({
            length: dims.packageLength,
            width: dims.packageWidth,
            height: dims.packageHeight,
            unit: dims.dimensionUnit,
          })
          : null;
        if (!changedFields.includes('logistics.volumeCm3')) changedFields.push('logistics.volumeCm3');
      }
    }
    if (req.body.isPublished !== undefined) {
      if (typeof req.body.isPublished !== 'boolean') {
        return res.status(400).json({ success: false, message: 'isPublished doit être un booléen.' });
      }
      product.isPublished = Boolean(req.body.isPublished);
      product.publicationStatus = req.body.isPublished ? 'published' : 'draft';
      changedFields.push('isPublished');
    }
    if (req.body.isActive !== undefined) {
      if (typeof req.body.isActive !== 'boolean') {
        return res.status(400).json({ success: false, message: 'isActive doit être un booléen.' });
      }
      product.isDropshippingActive = req.body.isActive;
      changedFields.push('isActive');
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
        product.isPublished = true;
        product.publicationStatus = 'published';
      } else {
        product.isPublished = false;
        product.publicationStatus = 'draft';
      }
    }

    const sourcePrice = product.pricing?.sourcePrice
      ?? product.supplier?.supplierPrice
      ?? product.normalized?.pricing?.sourcePrice;
    if (sourcePrice != null && Number(sourcePrice) > 0) {
      const pricing = calculateAlibabaPrice({
        sourcePrice,
        currency: product.pricing?.currency || product.supplier?.supplierCurrency || 'USD',
        category: product.category,
        productMarginPercent: product.pricing?.marginPercentOverride,
        manualSalePrice: product.pricing?.manualSalePrice,
        config: await getAlibabaConfig(),
      });
      product.price = pricing.salePrice;
      product.costPrice = pricing.convertedSupplierPrice;
      product.convertedSupplierPriceFCFA = pricing.convertedSupplierPrice;
      product.marginPercent = pricing.marginPercent;
      product.pricing.calculation = {
        exchangeRate: pricing.exchangeRate,
        convertedSupplierPrice: pricing.convertedSupplierPrice,
        marginPercent: pricing.marginPercent,
        marginSource: pricing.marginSource,
        additionalFeesXof: pricing.additionalFeesXof,
        salePrice: pricing.salePrice,
        saleCurrency: pricing.saleCurrency,
        calculatedAt: new Date(),
      };
      product.normalized = {
        ...(product.normalized || {}),
        pricing: {
          ...(product.normalized?.pricing || {}),
          sellingPrice: pricing.salePrice,
          calculation: product.pricing.calculation,
        },
      };
    } else if (req.body.price !== undefined) {
      return res.status(422).json({ success: false, message: 'Prix fournisseur Alibaba absent : le prix de vente ne peut pas être recalculé.' });
    }

    if (changedFields.length) {
      product.adminHistory = [...(product.adminHistory || []), {
        changedAt: new Date(),
        changedBy: adminId(req),
        changedFields: [...new Set(changedFields)],
        action: 'update',
      }].slice(-100);
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
    if (!product || !(product.isAlibaba || String(product.source || '').toUpperCase() === 'ALIBABA')) {
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
    if (!alibabaDoc) {
      return res.status(404).json({ success: false, message: 'Produit introuvable.' });
    }
    const product = mapAlibabaProductForAdmin(alibabaDoc);
    return res.json({ success: true, data: validateProductQualityForPublication(product) });
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports.mapAlibabaProductForAdmin = mapAlibabaProductForAdmin;