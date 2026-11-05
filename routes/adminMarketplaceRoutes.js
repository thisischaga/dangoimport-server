const express = require('express');
const AlibabaProduct = require('../Models/AlibabaProduct');
const User = require('../Models/User');
const AuditLog = require('../Models/AuditLog');
const Notification = require('../Models/Notification');
const { verifyAdmin } = require('../Middlewares/verifyTokens');
const emailService = require('../utils/emailService');
const { alertAdminActivity } = require('../utils/securityAlerts');

const router = express.Router();

function getMarketplaceMeta(product = {}) {
  const safeNormalized = product.normalized && typeof product.normalized === 'object' ? product.normalized : {};
  return {
    ...(safeNormalized.marketplace || {}),
    history: Array.isArray(safeNormalized.marketplace?.history) ? safeNormalized.marketplace.history : [],
  };
}

function setMarketplaceMeta(product, patch = {}) {
  const current = getMarketplaceMeta(product);
  const next = { ...current, ...patch };
  product.normalized = {
    ...(product.normalized && typeof product.normalized === 'object' ? product.normalized : {}),
    marketplace: next,
  };
  return next;
}

function pushMarketplaceHistory(product, action, comment, performedBy, role = 'admin', date = new Date()) {
  const meta = getMarketplaceMeta(product);
  const next = {
    ...meta,
    history: [
      ...(Array.isArray(meta.history) ? meta.history : []),
      { action, comment, performedBy, role, date },
    ],
  };
  setMarketplaceMeta(product, next);
  return next;
}

function getMarketplaceValidationStatus(product = {}) {
  const meta = getMarketplaceMeta(product);
  if (meta.validationStatus) return meta.validationStatus;
  if (product.isPublished) return 'approved';
  if (product.status === 'ERROR') return 'rejected';
  if (meta.changeRequestComment) return 'changes_requested';
  return 'pending';
}

function normalizeAlibabaMarketplaceProduct(doc) {
  if (!doc) return null;
  const product = doc.toObject ? doc.toObject() : { ...doc };
  const raw = product.normalized && typeof product.normalized === 'object' ? product.normalized : {};
  const marketplace = raw.marketplace || {};
  const description = product.description || raw.description || product.rawPayload?.description || product.rawSections?.product?.description || '';
  const price = Number(
    raw?.pricing?.sellingPrice
    ?? raw?.pricing?.price
    ?? raw?.price
    ?? product.pricing?.sourcePrice
    ?? product.pricing?.tiers?.[0]?.price
    ?? 0,
  );
  const stock = Number(product.inventory?.quantityRaw ?? raw?.inventory?.available ?? raw?.stock ?? product.stock ?? 0);

  return {
    ...product,
    _id: product._id,
    id: String(product._id),
    name: product.name || product.title || '',
    title: product.title || product.name || '',
    description: String(description || '').trim(),
    shortDescription: String(description || '').slice(0, 220),
    category: product.category || raw.category || '',
    brand: product.brand || raw.brand || '',
    vendorName: product.supplier?.name || product.brand || 'Alibaba Supplier',
    vendorId: product.vendorId || product.supplier?.companyId || null,
    image: product.mainImage || product.images?.[0]?.url || '',
    images: Array.isArray(product.images) ? product.images.map((img) => (typeof img === 'string' ? img : img?.url || '')).filter(Boolean) : [],
    price: Number.isFinite(price) ? price : 0,
    stock: Number.isFinite(stock) ? stock : 0,
    validationStatus: getMarketplaceValidationStatus(product),
    isPublished: Boolean(product.isPublished),
    publicationStatus: product.isPublished ? 'published' : 'draft',
    rejectionReason: marketplace.rejectionReason || '',
    changeRequestComment: marketplace.changeRequestComment || '',
    history: Array.isArray(marketplace.history) ? marketplace.history : [],
    updatedAt: product.updatedAt || product.lastSyncedAt || new Date(),
  };
}

// Helper helper for audit logging
const logAudit = async (req, action, targetResource, targetId, details = {}) => {
  try {
    const adminUser = req.adminUser || req.admin || req.user || {};
    await AuditLog.create({
      userId: adminUser.userId || adminUser.id || adminUser._id,
      userName: `${adminUser.firstname || ''} ${adminUser.surname || adminUser.adminName || 'Admin'}`.trim(),
      role: adminUser.role || 'admin',
      action,
      targetResource,
      targetId,
      details,
      ipAddress: req.ip || req.connection?.remoteAddress || '127.0.0.1',
    });
    await alertAdminActivity(req, action, {
      targetResource,
      targetId,
      summary: details?.summary || action,
      ...details,
    }, { skipAuditLog: true });
  } catch (err) {
    console.error('⚠️ [AuditLog Error]:', err.message);
  }
};

// Helper to push notification + socket.io event
const notifyVendor = async (req, { vendorId, vendorEmail, title, message, type, link }) => {
  try {
    const notif = new Notification({
      recipient: vendorId ? String(vendorId) : 'vendor',
      recipientType: 'user',
      title,
      message,
      type,
      link,
      isRead: false,
    });
    await notif.save();

    // Socket.io dispatch
    const io = req.app.get('socketio');
    if (io && vendorId) {
      io.to(`user_${vendorId}`).emit('new_notification', notif);
    }
  } catch (err) {
    console.error('⚠️ [NotifyVendor Error]:', err.message);
  }
};

const getValidationPriority = (status) => {
  switch (status) {
    case 'pending': return 0;
    case 'changes_requested': return 1;
    case 'rejected': return 2;
    case 'approved': return 3;
    case 'disabled': return 4;
    default: return 5;
  }
};

// 1. GET /api/admin/marketplace/products/pending — Produits en attente de validation
router.get('/products/pending', verifyAdmin, async (req, res) => {
  try {
    const products = await AlibabaProduct.find({ source: 'ALIBABA' })
      .sort({ createdAt: -1, updatedAt: -1 })
      .lean();
    const normalized = (products || []).map(normalizeAlibabaMarketplaceProduct).filter((p) => p && p.validationStatus === 'pending');
    return res.status(200).json({ success: true, count: normalized.length, data: normalized });
  } catch (err) {
    console.error('[AdminMarketplace] get pending products:', err);
    return res.status(500).json({ message: 'Erreur lors de la récupération des produits en attente.' });
  }
});

// 2. GET /api/admin/marketplace/products/all — Tous les produits vendeurs avec filtres
router.get('/products/all', verifyAdmin, async (req, res) => {
  try {
    const { status, category, search } = req.query;
    const query = { source: 'ALIBABA' };
    if (category) query.category = category;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { title: { $regex: search, $options: 'i' } },
        { brand: { $regex: search, $options: 'i' } },
        { sourceProductId: { $regex: search, $options: 'i' } },
      ];
    }

    const products = await AlibabaProduct.find(query).sort({ createdAt: -1, updatedAt: -1 }).lean();
    const normalized = (products || []).map(normalizeAlibabaMarketplaceProduct).filter(Boolean);
    const filtered = status
      ? normalized.filter((p) => p.validationStatus === status)
      : normalized;
    return res.status(200).json({ success: true, count: filtered.length, data: filtered });
  } catch (err) {
    console.error('[AdminMarketplace] get all products:', err);
    return res.status(500).json({ message: 'Erreur lors de la récupération des produits.' });
  }
});

// 3. PUT /api/admin/marketplace/products/:id/approve — Approuver et publier
router.put('/products/:id/approve', verifyAdmin, async (req, res) => {
  try {
    const product = await AlibabaProduct.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Produit introuvable.' });
    }

    const normalized = normalizeAlibabaMarketplaceProduct(product);
    const missing = [];
    if (!normalized?.name?.trim()) missing.push('name');
    if (!normalized?.category?.trim()) missing.push('category');
    if (Number(normalized?.price || 0) <= 0) missing.push('price (doit être supérieur à 0)');
    if (Number(normalized?.stock ?? 0) < 0) missing.push('stock');
    if (!normalized?.description?.trim()) missing.push('description');

    if (missing.length > 0) {
      return res.status(400).json({ success: false, message: 'Impossible d\'approuver : champs requis manquants ou prix égal à 0.', missingFields: missing });
    }

    product.isPublished = true;
    product.status = 'IMPORTED';
    product.lastSyncedAt = new Date();
    setMarketplaceMeta(product, {
      validationStatus: 'approved',
      rejectionReason: '',
      changeRequestComment: '',
    });
    pushMarketplaceHistory(product, 'Approuvé', 'Le produit a été validé et publié sur la marketplace Dango Import.', req.adminUser?.firstname || req.admin?.firstname || 'Admin', 'admin');
    await product.save();

    await logAudit(req, 'APPROVE_PRODUCT', 'AlibabaProduct', product._id, { productName: product.name });

    const vendorId = product.vendorId || product.supplier?.companyId || null;
    let vendorEmail = '';
    if (vendorId) {
      const vendorUser = await User.findById(vendorId);
      if (vendorUser) vendorEmail = vendorUser.userEmail;
    }

    if (vendorEmail) {
      await emailService.sendApprovalEmail({
        vendorEmail,
        vendorName: product.supplier?.name || product.brand || 'Alibaba Supplier',
        productName: product.name,
        productUrl: `https://dangoimport.com/product/${product._id}`,
      });
    }

    if (vendorId) {
      await notifyVendor(req, {
        vendorId,
        title: 'Produit approuvé ! 🎉',
        message: `Votre produit "${product.name}" a été approuvé par l'équipe et est maintenant en ligne.`,
        type: 'product_approved',
        link: '/products',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Produit approuvé et publié avec succès.',
      data: normalizeAlibabaMarketplaceProduct(product),
    });
  } catch (err) {
    console.error('[AdminMarketplace] approve product:', err);
    if (err && err.name === 'ValidationError') {
      try {
        const missing = Object.keys(err.errors || {}).filter((k) => err.errors[k] && err.errors[k].kind === 'required');
        return res.status(400).json({ success: false, message: 'Impossible d\'approuver : champs requis manquants.', missingFields: missing });
      } catch (ex) {
        console.error('[AdminMarketplace] error parsing ValidationError:', ex);
      }
    }
    return res.status(500).json({ message: 'Erreur lors de l’approbation du produit.' });
  }
});

// 4. PUT /api/admin/marketplace/products/:id/reject — Rejeter avec motif
router.put('/products/:id/reject', verifyAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ message: 'Le motif du rejet est obligatoire.' });
    }

    const product = await AlibabaProduct.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Produit introuvable.' });
    }

    product.isPublished = false;
    product.status = 'ERROR';
    setMarketplaceMeta(product, {
      validationStatus: 'rejected',
      rejectionReason: reason.trim(),
      changeRequestComment: '',
    });

    const adminUser = req.adminUser || req.admin || req.user || {};
    const adminName = `${adminUser.firstname || ''} ${adminUser.surname || 'Admin'}`.trim();
    pushMarketplaceHistory(product, 'Rejeté', reason.trim(), adminName, 'admin');
    await product.save();

    await logAudit(req, 'REJECT_PRODUCT', 'AlibabaProduct', product._id, { productName: product.name, reason });

    const vendorId = product.vendorId || product.supplier?.companyId || null;
    let vendorEmail = '';
    if (vendorId) {
      const vendorUser = await User.findById(vendorId);
      if (vendorUser) vendorEmail = vendorUser.userEmail;
    }

    if (vendorEmail) {
      await emailService.sendRejectionEmail({
        vendorEmail,
        vendorName: product.supplier?.name || product.brand || 'Alibaba Supplier',
        productName: product.name,
        rejectionReason: reason.trim(),
        editUrl: 'https://business.dangoimport.com/products',
      });
    }

    if (vendorId) {
      await notifyVendor(req, {
        vendorId,
        title: 'Produit rejeté ❌',
        message: `Votre produit "${product.name}" a été rejeté. Motif : ${reason.trim()}`,
        type: 'product_rejected',
        link: '/products',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Produit rejeté avec succès.',
      data: normalizeAlibabaMarketplaceProduct(product),
    });
  } catch (err) {
    console.error('[AdminMarketplace] reject product:', err);
    return res.status(500).json({ message: 'Erreur lors du rejet du produit.' });
  }
});

// 5. PUT /api/admin/marketplace/products/:id/request-changes — Demander des modifications
router.put('/products/:id/request-changes', verifyAdmin, async (req, res) => {
  try {
    const { comment } = req.body;
    if (!comment || !comment.trim()) {
      return res.status(400).json({ message: 'Le commentaire des modifications attendues est obligatoire.' });
    }

    const product = await AlibabaProduct.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Produit introuvable.' });
    }

    product.isPublished = false;
    setMarketplaceMeta(product, {
      validationStatus: 'changes_requested',
      changeRequestComment: comment.trim(),
      rejectionReason: '',
    });

    const adminUser = req.adminUser || req.admin || req.user || {};
    const adminName = `${adminUser.firstname || ''} ${adminUser.surname || 'Admin'}`.trim();
    pushMarketplaceHistory(product, 'Modifications demandées', comment.trim(), adminName, 'admin');
    await product.save();

    await logAudit(req, 'REQUEST_CHANGES_PRODUCT', 'AlibabaProduct', product._id, { productName: product.name, comment });

    const vendorId = product.vendorId || product.supplier?.companyId || null;
    let vendorEmail = '';
    if (vendorId) {
      const vendorUser = await User.findById(vendorId);
      if (vendorUser) vendorEmail = vendorUser.userEmail;
    }

    if (vendorEmail) {
      await emailService.sendChangesRequestedEmail({
        vendorEmail,
        vendorName: product.supplier?.name || product.brand || 'Alibaba Supplier',
        productName: product.name,
        comment: comment.trim(),
        editUrl: 'https://business.dangoimport.com/products',
      });
    }

    if (vendorId) {
      await notifyVendor(req, {
        vendorId,
        title: 'Modifications demandées 📝',
        message: `Des corrections sont nécessaires sur votre produit "${product.name}".`,
        type: 'changes_requested',
        link: '/products',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Demande de modifications transmise au vendeur.',
      data: normalizeAlibabaMarketplaceProduct(product),
    });
  } catch (err) {
    console.error('[AdminMarketplace] request changes:', err);
    return res.status(500).json({ message: 'Erreur lors de la demande de modifications.' });
  }
});

// 6. PUT /api/admin/marketplace/products/:id/toggle-disable — Désactiver/Activer un produit publié
router.put('/products/:id/toggle-disable', verifyAdmin, async (req, res) => {
  try {
    const product = await AlibabaProduct.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Produit introuvable.' });
    }

    const currentStatus = getMarketplaceValidationStatus(product);
    if (currentStatus === 'disabled' && Number(normalizeAlibabaMarketplaceProduct(product).price || 0) <= 0) {
      return res.status(400).json({ success: false, message: 'Impossible de réactiver un produit dont le prix est de 0$ / 0 FCFA.' });
    }

    const newStatus = currentStatus === 'disabled' ? 'approved' : 'disabled';
    product.isPublished = newStatus === 'approved' && Number(normalizeAlibabaMarketplaceProduct(product).price || 0) > 0;
    setMarketplaceMeta(product, {
      validationStatus: newStatus,
      rejectionReason: '',
      changeRequestComment: '',
    });

    const adminUser = req.adminUser || req.admin || req.user || {};
    const adminName = `${adminUser.firstname || ''} ${adminUser.surname || 'Admin'}`.trim();
    pushMarketplaceHistory(product, newStatus === 'disabled' ? 'Désactivé par Admin' : 'Réactivé par Admin', newStatus === 'disabled' ? 'Masqué temporairement de la marketplace.' : 'Remis en ligne.', adminName, 'admin');
    await product.save();

    await logAudit(req, 'TOGGLE_DISABLE_PRODUCT', 'AlibabaProduct', product._id, { newStatus });

    return res.status(200).json({
      success: true,
      message: `Produit ${newStatus === 'disabled' ? 'désactivé' : 'réactivé'} avec succès.`,
      data: normalizeAlibabaMarketplaceProduct(product),
    });
  } catch (err) {
    console.error('[AdminMarketplace] toggle disable:', err);
    return res.status(500).json({ message: 'Erreur lors du changement d’état du produit.' });
  }
});

module.exports = router;
