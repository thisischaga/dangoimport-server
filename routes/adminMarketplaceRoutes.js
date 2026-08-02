const express = require('express');
const Product = require('../Models/Product');
const User = require('../Models/User');
const AuditLog = require('../Models/AuditLog');
const Notification = require('../Models/Notification');
const { verifyAdmin } = require('../Middlewares/verifyTokens');
const emailService = require('../utils/emailService');

const router = express.Router();

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
    const products = await Product.find({ validationStatus: 'pending' }).sort({ createdAt: -1, updatedAt: -1 });
    return res.status(200).json({ success: true, count: products.length, data: products });
  } catch (err) {
    console.error('[AdminMarketplace] get pending products:', err);
    return res.status(500).json({ message: 'Erreur lors de la récupération des produits en attente.' });
  }
});

// 2. GET /api/admin/marketplace/products/all — Tous les produits vendeurs avec filtres
router.get('/products/all', verifyAdmin, async (req, res) => {
  try {
    const { status, category, search } = req.query;
    const query = {};
    if (status) query.validationStatus = status;
    if (category) query.category = category;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { vendorName: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
      ];
    }

    const products = await Product.find(query).sort({ createdAt: -1, updatedAt: -1 });
    return res.status(200).json({ success: true, count: products.length, data: products });
  } catch (err) {
    console.error('[AdminMarketplace] get all products:', err);
    return res.status(500).json({ message: 'Erreur lors de la récupération des produits.' });
  }
});

// 3. PUT /api/admin/marketplace/products/:id/approve — Approuver et publier
router.put('/products/:id/approve', verifyAdmin, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Produit introuvable.' });
    }

    // Validate required fields before approving to avoid Mongoose validation errors
    const missing = [];
    if (!product.name || !String(product.name).trim()) missing.push('name');
    if (!product.category || !String(product.category).trim()) missing.push('category');
    if (product.price === undefined || product.price === null) missing.push('price');
    if (product.stock === undefined || product.stock === null) missing.push('stock');
    if (!product.description || !String(product.description).trim()) missing.push('description');

    if (missing.length > 0) {
      // Do not attempt to save; return a clear error so the admin can request changes
      return res.status(400).json({ success: false, message: 'Impossible d\'approuver : champs requis manquants.', missingFields: missing });
    }

    product.validationStatus = 'approved';
    product.isPublished = true;
    product.rejectionReason = '';
    product.changeRequestComment = '';
    product.updatedAt = new Date();

    const adminUser = req.adminUser || req.admin || req.user || {};
    const adminName = `${adminUser.firstname || ''} ${adminUser.surname || 'Admin'}`.trim();
    product.history.push({
      action: 'Approuvé',
      comment: 'Le produit a été validé et publié sur la marketplace Dango Import.',
      performedBy: adminName,
      role: 'admin',
      date: new Date(),
    });

    await product.save();

    // Audit Log
    await logAudit(req, 'APPROVE_PRODUCT', 'Product', product._id, { productName: product.name });

    // Récupérer l'email du vendeur
    let vendorEmail = '';
    if (product.vendorId) {
      const vendorUser = await User.findById(product.vendorId);
      if (vendorUser) vendorEmail = vendorUser.userEmail;
    }

    // Email Resend
    if (vendorEmail) {
      await emailService.sendApprovalEmail({
        vendorEmail,
        vendorName: product.vendorName,
        productName: product.name,
        productUrl: `https://dangoimport.com/product/${product._id}`,
      });
    }

    // Notification vendeur Dango Seller
    await notifyVendor(req, {
      vendorId: product.vendorId,
      title: 'Produit approuvé ! 🎉',
      message: `Votre produit "${product.name}" a été approuvé par l'équipe et est maintenant en ligne.`,
      type: 'product_approved',
      link: '/products',
    });

    return res.status(200).json({
      success: true,
      message: 'Produit approuvé et publié avec succès.',
      data: product,
    });
  } catch (err) {
    console.error('[AdminMarketplace] approve product:', err);
    // If this is a Mongoose validation error, return a 400 with missing fields for the admin UI
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

    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Produit introuvable.' });
    }

    product.validationStatus = 'rejected';
    product.isPublished = false;
    product.rejectionReason = reason.trim();
    product.updatedAt = new Date();

    const adminUser = req.adminUser || req.admin || req.user || {};
    const adminName = `${adminUser.firstname || ''} ${adminUser.surname || 'Admin'}`.trim();
    product.history.push({
      action: 'Rejeté',
      comment: reason.trim(),
      performedBy: adminName,
      role: 'admin',
      date: new Date(),
    });

    await product.save();

    // Audit Log
    await logAudit(req, 'REJECT_PRODUCT', 'Product', product._id, { productName: product.name, reason });

    // Email & Notification
    let vendorEmail = '';
    if (product.vendorId) {
      const vendorUser = await User.findById(product.vendorId);
      if (vendorUser) vendorEmail = vendorUser.userEmail;
    }

    if (vendorEmail) {
      await emailService.sendRejectionEmail({
        vendorEmail,
        vendorName: product.vendorName,
        productName: product.name,
        rejectionReason: reason.trim(),
        editUrl: 'https://seller.dangoimport.com/products',
      });
    }

    await notifyVendor(req, {
      vendorId: product.vendorId,
      title: 'Produit rejeté ❌',
      message: `Votre produit "${product.name}" a été rejeté. Motif : ${reason.trim()}`,
      type: 'product_rejected',
      link: '/products',
    });

    return res.status(200).json({
      success: true,
      message: 'Produit rejeté avec succès.',
      data: product,
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

    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Produit introuvable.' });
    }

    product.validationStatus = 'changes_requested';
    product.isPublished = false;
    product.changeRequestComment = comment.trim();
    product.updatedAt = new Date();

    const adminUser = req.adminUser || req.admin || req.user || {};
    const adminName = `${adminUser.firstname || ''} ${adminUser.surname || 'Admin'}`.trim();
    product.history.push({
      action: 'Modifications demandées',
      comment: comment.trim(),
      performedBy: adminName,
      role: 'admin',
      date: new Date(),
    });

    await product.save();

    // Audit Log
    await logAudit(req, 'REQUEST_CHANGES_PRODUCT', 'Product', product._id, { productName: product.name, comment });

    // Email & Notification
    let vendorEmail = '';
    if (product.vendorId) {
      const vendorUser = await User.findById(product.vendorId);
      if (vendorUser) vendorEmail = vendorUser.userEmail;
    }

    if (vendorEmail) {
      await emailService.sendChangesRequestedEmail({
        vendorEmail,
        vendorName: product.vendorName,
        productName: product.name,
        comment: comment.trim(),
        editUrl: 'https://seller.dangoimport.com/products',
      });
    }

    await notifyVendor(req, {
      vendorId: product.vendorId,
      title: 'Modifications demandées 📝',
      message: `Des corrections sont nécessaires sur votre produit "${product.name}".`,
      type: 'changes_requested',
      link: '/products',
    });

    return res.status(200).json({
      success: true,
      message: 'Demande de modifications transmise au vendeur.',
      data: product,
    });
  } catch (err) {
    console.error('[AdminMarketplace] request changes:', err);
    return res.status(500).json({ message: 'Erreur lors de la demande de modifications.' });
  }
});

// 6. PUT /api/admin/marketplace/products/:id/toggle-disable — Désactiver/Activer un produit publié
router.put('/products/:id/toggle-disable', verifyAdmin, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Produit introuvable.' });
    }

    const newStatus = product.validationStatus === 'disabled' ? 'approved' : 'disabled';
    product.validationStatus = newStatus;
    product.isPublished = newStatus === 'approved';
    product.updatedAt = new Date();

    const adminUser = req.adminUser || req.admin || req.user || {};
    const adminName = `${adminUser.firstname || ''} ${adminUser.surname || 'Admin'}`.trim();
    product.history.push({
      action: newStatus === 'disabled' ? 'Désactivé par Admin' : 'Réactivé par Admin',
      comment: newStatus === 'disabled' ? 'Masqué temporairement de la marketplace.' : 'Remis en ligne.',
      performedBy: adminName,
      role: 'admin',
      date: new Date(),
    });

    await product.save();

    await logAudit(req, 'TOGGLE_DISABLE_PRODUCT', 'Product', product._id, { newStatus });

    return res.status(200).json({
      success: true,
      message: `Produit ${newStatus === 'disabled' ? 'désactivé' : 'réactivé'} avec succès.`,
      data: product,
    });
  } catch (err) {
    console.error('[AdminMarketplace] toggle disable:', err);
    return res.status(500).json({ message: 'Erreur lors du changement d’état du produit.' });
  }
});

module.exports = router;
