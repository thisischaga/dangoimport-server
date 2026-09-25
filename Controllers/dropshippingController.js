const dropshippingService = require('../services/dropshippingService');
const ShopOrder = require('../Models/ShopOrder');

function handleError(res, error) {
  const status = error.status || 500;
  return res.status(status).json({
    success: false,
    message: error.message || 'Erreur serveur.',
  });
}

exports.list = async (req, res) => {
  try {
    const result = await dropshippingService.listDropshippingProducts(req.query);
    return res.json({ success: true, ...result });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.getById = async (req, res) => {
  try {
    const product = await dropshippingService.getDropshippingProductById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Produit dropshipping introuvable.' });
    }
    return res.json({ success: true, data: product });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.create = async (req, res) => {
  try {
    const product = await dropshippingService.createDropshippingProduct(req.body, req.admin || req.user);
    return res.status(201).json({ success: true, data: product });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.update = async (req, res) => {
  try {
    const product = await dropshippingService.updateDropshippingProduct(req.params.id, req.body, req.admin || req.user);
    return res.json({ success: true, data: product });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.remove = async (req, res) => {
  try {
    await dropshippingService.deleteDropshippingProduct(req.params.id);
    return res.json({ success: true, message: 'Produit dropshipping supprimé.' });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const product = await dropshippingService.updateDropshippingStatus(req.params.id, req.body);
    return res.json({ success: true, data: product });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.importCsv = async (req, res) => {
  try {
    const csvText = req.body?.csv || req.body?.content || '';
    if (!String(csvText).trim()) {
      return res.status(400).json({ success: false, message: 'Contenu CSV manquant.' });
    }
    const result = await dropshippingService.importDropshippingCsv(csvText, req.admin || req.user);
    return res.json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.syncProduct = async (req, res) => {
  try {
    const result = await dropshippingService.syncDropshippingProduct(req.params.id);
    return res.json({ success: result.success, data: result });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.markSupplierOrdered = async (req, res) => {
  try {
    const { orderId, itemIndex } = req.params;
    const order = await ShopOrder.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Commande introuvable.' });
    }

    const index = Number(itemIndex);
    const item = order.items[index];
    if (!item || item.sourceType !== 'DROPSHIPPING') {
      return res.status(400).json({ success: false, message: 'Ligne dropshipping introuvable.' });
    }

    item.fulfillmentStatus = 'SUPPLIER_ORDERED';
    item.supplierOrderedAt = new Date();
    item.supplierOrderNote = req.body?.note || 'Commande fournisseur enregistrée manuellement.';
    order.history = [...(order.history || []), `Commande fournisseur enregistrée pour ${item.productName}`];
    await order.save();

    return res.json({ success: true, data: order });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.previewMargin = async (req, res) => {
  try {
    const margin = dropshippingService.calculateMargin({
      sellingPrice: req.body?.price ?? req.body?.sellingPrice,
      supplierPrice: req.body?.supplierPrice ?? req.body?.supplier?.supplierPrice,
      supplierShippingCost: req.body?.supplierShippingCost ?? req.body?.supplier?.shippingCost,
      otherCosts: req.body?.otherCosts,
    });
    return res.json({ success: true, data: margin });
  } catch (error) {
    return handleError(res, error);
  }
};
