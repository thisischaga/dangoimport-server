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

  sendOrderConfirmedEmail: async ({ customerEmail, customerName, orderNumber, total, qrCode, items, qrCodes }) => {
    try {
      const itemList = items || [];
      const qrList = qrCodes || (qrCode ? [{ code: qrCode, vendorName: 'Boutique', metadata: { vendorTotal: total } }] : []);

      const html = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; border: 1px solid #e2e8f0; border-radius: 20px; background: #ffffff; color: #334155;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #FF6B00; font-size: 28px; font-weight: 800; margin: 0; letter-spacing: -0.5px;">DANGOIMPORT</h1>
            <p style="color: #64748b; font-size: 14px; margin-top: 5px;">Confirmation de votre commande</p>
          </div>
          
          <div style="background: #FFF1E5; border: 1px solid #FFD3B4; border-radius: 12px; padding: 20px; margin-bottom: 25px; text-align: center;">
            <h2 style="color: #FF6B00; font-size: 20px; margin: 0 0 10px;">Merci pour votre achat !</h2>
            <p style="color: #7A3D00; font-size: 14px; margin: 0; font-weight: 500;">Votre commande <strong>${orderNumber}</strong> a bien été confirmée.</p>
            <p style="color: #7A3D00; font-size: 14px; margin: 5px 0 0; font-weight: 500;">Montant total : <strong>${Number(total || 0).toLocaleString('fr-FR')} FCFA</strong></p>
          </div>
          
          ${itemList.length > 0 ? `
            <h3 style="color: #1e293b; font-size: 16px; border-bottom: 2px solid #f1f5f9; padding-bottom: 8px; margin-bottom: 15px;">Détails des articles</h3>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
              <thead>
                <tr style="border-bottom: 1px solid #e2e8f0; text-align: left; font-size: 12px; color: #64748b;">
                  <th style="padding: 8px 0; font-weight: 600;">Article</th>
                  <th style="padding: 8px 0; font-weight: 600; text-align: center;">Qté</th>
                  <th style="padding: 8px 0; font-weight: 600; text-align: right;">Prix</th>
                </tr>
              </thead>
              <tbody>
                ${itemList.map(item => `
                  <tr style="border-bottom: 1px solid #f1f5f9; font-size: 14px;">
                    <td style="padding: 12px 0;">
                      <div style="font-weight: 600; color: #1e293b;">${item.productName}</div>
                      <div style="font-size: 12px; color: #64748b;">Vendeur: ${item.vendorName || 'Dangoimport'}</div>
                    </td>
                    <td style="padding: 12px 0; text-align: center; color: #64748b;">${item.quantity}</td>
                    <td style="padding: 12px 0; text-align: right; font-weight: 600; color: #1e293b;">${Number(item.price * item.quantity).toLocaleString('fr-FR')} FCFA</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : ''}
          
          <h3 style="color: #1e293b; font-size: 16px; border-bottom: 2px solid #f1f5f9; padding-bottom: 8px; margin-bottom: 15px;">Vos bons de retrait (Codes QR)</h3>
          <p style="font-size: 13px; color: #64748b; margin-bottom: 20px;">Veuillez présenter le code QR correspondant à chaque boutique pour retirer ou faire valider vos articles auprès des vendeurs.</p>
          
          <div>
            ${qrList.map(qr => `
              <div style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 15px; margin-bottom: 20px; background: #fafafa; text-align: center;">
                <div style="font-weight: 700; font-size: 14px; color: #1e293b; margin-bottom: 5px;">${qr.vendorName || 'Boutique'}</div>
                ${qr.metadata?.vendorTotal ? `<div style="font-size: 12px; color: #FF6B00; font-weight: 600; margin-bottom: 12px;">Sous-total boutique: ${Number(qr.metadata.vendorTotal).toLocaleString('fr-FR')} FCFA</div>` : ''}
                <div style="margin: 0 auto 12px; width: 160px; height: 160px; background: #ffffff; padding: 10px; border: 1px solid #e2e8f0; border-radius: 8px;">
                  <img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(qr.code)}" alt="Code QR de validation" style="width: 160px; height: 160px; display: block;" />
                </div>
                <div style="font-family: monospace; font-size: 11px; color: #64748b;">Code: ${qr.code}</div>
              </div>
            `).join('')}
          </div>
          
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;" />
          <div style="text-align: center; font-size: 12px; color: #94a3b8;">
            <p>Besoin d'aide ? Contactez notre service client ou visitez notre centre d'aide.</p>
            <p>© ${new Date().getFullYear()} Dangoimport. Tous droits réservés.</p>
          </div>
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
