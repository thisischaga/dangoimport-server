const { alibabaConfig } = require('../config/alibaba');
const { testConnection } = require('../services/alibaba/alibabaClient');
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
    console.error('[alibaba] searchProducts:', error.message);
    return handleError(res, error);
  }
};

exports.getProductDetail = async (req, res) => {
  try {
    const data = await getAlibabaProductForAdmin(req.params.pid);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('[alibaba] getProductDetail:', error.message);
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
    console.error('[alibaba] importProduct:', error.message);
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
