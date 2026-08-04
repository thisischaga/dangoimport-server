const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY || 're_placeholder_key');

const emailService = {
  // 1. Email d'approbation
  sendApprovalEmail: async ({ vendorEmail, vendorName, productName, productUrl }) => {
    try {
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #ea580c; font-size: 24px; font-weight: 800; margin: 0;">Dango Import Seller</h1>
            <p style="color: #64748b; font-size: 14px;">Notification Marketplace</p>
          </div>
          <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
            <h2 style="color: #166534; font-size: 18px; margin: 0 0 8px;">Félicitations ${vendorName || 'Vendeur'} !</h2>
            <p style="color: #15803d; font-size: 14px; margin: 0;">Votre produit <strong>${productName}</strong> a été validé par notre équipe.</p>
          </div>
          <p style="color: #334155; font-size: 14px; line-height: 1.6;">
            Il est maintenant officiellement publié et visible par tous les acheteurs sur la marketplace Dango Import.
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${productUrl || 'https://dangoimport.com'}" style="background: #ea580c; color: #ffffff; padding: 12px 28px; font-weight: 700; font-size: 14px; border-radius: 8px; text-decoration: none; display: inline-block;">
              Voir mon produit sur Dango Import
            </a>
          </div>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
          <p style="color: #94a3b8; font-size: 12px; text-align: center;">Dango Import Marketplace — Tous droits réservés.</p>
        </div>
      `;

      await resend.emails.send({
        from: 'Dango Import Marketplace <marketplace@dangoimport.com>',
        to: vendorEmail,
        subject: `Votre produit "${productName}" a été approuvé !`,
        html,
      });
    } catch (err) {
      console.warn('⚠️ [Resend Email] Approval email skipped or failed:', err.message);
    }
  },

  // 2. Email de rejet
  sendRejectionEmail: async ({ vendorEmail, vendorName, productName, rejectionReason, editUrl }) => {
    try {
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #ea580c; font-size: 24px; font-weight: 800; margin: 0;">Dango Import Seller</h1>
            <p style="color: #64748b; font-size: 14px;">Notification Marketplace</p>
          </div>
          <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
            <h2 style="color: #991b1b; font-size: 18px; margin: 0 0 8px;">Produit non approuvé</h2>
            <p style="color: #b91c1c; font-size: 14px; margin: 0;">Votre produit <strong>${productName}</strong> n'a pas pu être publié sur la plateforme.</p>
          </div>
          <div style="margin-bottom: 20px;">
            <h3 style="color: #334155; font-size: 14px; margin-bottom: 6px;">Motif du rejet :</h3>
            <p style="background: #f8fafc; border: 1px dashed #cbd5e1; padding: 12px; border-radius: 6px; color: #475569; font-size: 14px; margin: 0;">
              ${rejectionReason || 'Non-conforme aux exigences de la marketplace.'}
            </p>
          </div>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${editUrl || 'https://seller.dangoimport.com'}" style="background: #475569; color: #ffffff; padding: 12px 28px; font-weight: 700; font-size: 14px; border-radius: 8px; text-decoration: none; display: inline-block;">
              Accéder à Dango Seller
            </a>
          </div>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
          <p style="color: #94a3b8; font-size: 12px; text-align: center;">Dango Import Marketplace — Tous droits réservés.</p>
        </div>
      `;

      await resend.emails.send({
        from: 'Dango Import Marketplace <marketplace@dangoimport.com>',
        to: vendorEmail,
        subject: `Votre produit "${productName}" n'a pas été approuvé`,
        html,
      });
    } catch (err) {
      console.warn('⚠️ [Resend Email] Rejection email skipped or failed:', err.message);
    }
  },

  // 3. Email de demande de modifications
  sendChangesRequestedEmail: async ({ vendorEmail, vendorName, productName, comment, editUrl }) => {
    try {
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #ea580c; font-size: 24px; font-weight: 800; margin: 0;">Dango Import Seller</h1>
            <p style="color: #64748b; font-size: 14px;">Notification Marketplace</p>
          </div>
          <div style="background: #fffbeb; border: 1px solid #fef08a; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
            <h2 style="color: #854d0e; font-size: 18px; margin: 0 0 8px;">Des modifications sont nécessaires</h2>
            <p style="color: #a16207; font-size: 14px; margin: 0;">Notre équipe a examiné votre produit <strong>${productName}</strong>.</p>
          </div>
          <div style="margin-bottom: 20px;">
            <h3 style="color: #334155; font-size: 14px; margin-bottom: 6px;">Corrections attendues :</h3>
            <p style="background: #f8fafc; border: 1px dashed #fde047; padding: 12px; border-radius: 6px; color: #475569; font-size: 14px; margin: 0;">
              ${comment || 'Veuillez réviser les informations du produit.'}
            </p>
          </div>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${editUrl || 'https://seller.dangoimport.com'}" style="background: #ea580c; color: #ffffff; padding: 12px 28px; font-weight: 700; font-size: 14px; border-radius: 8px; text-decoration: none; display: inline-block;">
              Modifier le produit
            </a>
          </div>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
          <p style="color: #94a3b8; font-size: 12px; text-align: center;">Dango Import Marketplace — Tous droits réservés.</p>
        </div>
      `;

      await resend.emails.send({
        from: 'Dango Import Marketplace <marketplace@dangoimport.com>',
        to: vendorEmail,
        subject: `Des modifications sont nécessaires pour "${productName}"`,
        html,
      });
    } catch (err) {
      console.warn('⚠️ [Resend Email] Changes requested email skipped or failed:', err.message);
    }
  },

  sendOrderConfirmedEmail: async ({ customerEmail, customerName, orderNumber, total, qrCode }) => {
    try {
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
          <h2 style="color: #ea580c; margin-bottom: 8px;">Commande confirmée</h2>
          <p>Bonjour ${customerName || 'Client'},</p>
          <p>Votre commande <strong>${orderNumber}</strong> a bien été confirmée.</p>
          <p>Montant total : <strong>${Number(total || 0).toLocaleString('fr-FR')} FCFA</strong></p>
          <p>Votre QR de retrait est disponible dans votre espace Mes commandes.</p>
          ${qrCode ? `<p>Code QR : <strong>${qrCode}</strong></p>` : ''}
        </div>
      `;

      await resend.emails.send({
        from: 'Dango Import Marketplace <marketplace@dangoimport.com>',
        to: customerEmail,
        subject: `Commande confirmée - ${orderNumber}`,
        html,
      });
    } catch (err) {
      console.warn('⚠️ [Resend Email] Order confirmed email skipped or failed:', err.message);
    }
  },

  sendOrderDeliveredEmail: async ({ customerEmail, customerName, orderNumber, vendorName, amount }) => {
    try {
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
          <h2 style="color: #16a34a; margin-bottom: 8px;">Commande livrée</h2>
          <p>Bonjour ${customerName || 'Client'},</p>
          <p>Votre commande <strong>${orderNumber}</strong> a été livrée par ${vendorName || 'le vendeur'}.</p>
          <p>Montant total : <strong>${Number(amount || 0).toLocaleString('fr-FR')} FCFA</strong></p>
        </div>
      `;

      await resend.emails.send({
        from: 'Dango Import Marketplace <marketplace@dangoimport.com>',
        to: customerEmail,
        subject: `Commande livrée - ${orderNumber}`,
        html,
      });
    } catch (err) {
      console.warn('⚠️ [Resend Email] Order delivered email skipped or failed:', err.message);
    }
  },
};

module.exports = emailService;
