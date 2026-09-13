const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY || 're_placeholder_key');

const emailService = {
  // 1. Email d'approbation de produit
  sendApprovalEmail: async ({ vendorEmail, vendorName, productName, productUrl }) => {
    try {
      const html = `
        <!DOCTYPE html>
        <html lang="fr">
        <body style="margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:32px 16px;">
            <tr>
              <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 10px 25px rgba(0,0,0,0.05);">
                  <tr>
                    <td style="background:linear-gradient(135deg,#FF6B00 0%,#F68B1E 100%);padding:30px;text-align:center;">
                      <div style="font-size:26px;font-weight:900;color:#ffffff;letter-spacing:1px;">DANGO IMPORT</div>
                      <div style="margin-top:4px;font-size:13px;color:rgba(255,255,255,0.9);font-weight:600;">Espace Vendeur — Notification Marketplace</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:32px;">
                      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:20px;margin-bottom:24px;">
                        <h2 style="color:#166534;font-size:18px;margin:0 0 8px;font-weight:800;">Félicitations ${vendorName || 'Vendeur'} ! 🎉</h2>
                        <p style="color:#15803d;font-size:14px;margin:0;line-height:1.6;">
                          Votre produit <strong>${productName}</strong> a été validé et approuvé par notre équipe de modération.
                        </p>
                      </div>
                      <p style="color:#334155;font-size:15px;line-height:1.7;margin-bottom:24px;">
                        Il est désormais publié en ligne et accessible par tous les acheteurs du réseau <strong>Dango Import</strong> au Bénin et au Togo.
                      </p>
                      <div style="text-align:center;margin:32px 0 16px;">
                        <a href="${productUrl || 'https://dangoimport.com'}" style="background:#FF6B00;color:#ffffff;padding:14px 30px;font-weight:800;font-size:14px;border-radius:12px;text-decoration:none;display:inline-block;box-shadow:0 4px 12px rgba(255,107,0,0.25);">
                          Voir mon produit sur Dango Import →
                        </a>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td style="background:#f8fafc;padding:20px;text-align:center;border-top:1px solid #e2e8f0;">
                      <p style="margin:0;font-size:12px;color:#94a3b8;">Dango Import Marketplace — Tous droits réservés.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `;

      await resend.emails.send({
        from: 'Dango Import Marketplace <marketplace@dangoimport.com>',
        to: vendorEmail,
        subject: `Votre produit "${productName}" a été approuvé ! — Dango Import`,
        html,
      });
    } catch (err) {
      console.warn('⚠️ [Resend Email] Approval email skipped or failed:', err.message);
    }
  },

  // 2. Email de rejet de produit
  sendRejectionEmail: async ({ vendorEmail, vendorName, productName, rejectionReason, editUrl }) => {
    try {
      const html = `
        <!DOCTYPE html>
        <html lang="fr">
        <body style="margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:32px 16px;">
            <tr>
              <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 10px 25px rgba(0,0,0,0.05);">
                  <tr>
                    <td style="background:linear-gradient(135deg,#FF6B00 0%,#F68B1E 100%);padding:30px;text-align:center;">
                      <div style="font-size:26px;font-weight:900;color:#ffffff;letter-spacing:1px;">DANGO IMPORT</div>
                      <div style="margin-top:4px;font-size:13px;color:rgba(255,255,255,0.9);font-weight:600;">Espace Vendeur — Notification Marketplace</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:32px;">
                      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:14px;padding:20px;margin-bottom:24px;">
                        <h2 style="color:#991b1b;font-size:18px;margin:0 0 8px;font-weight:800;">Produit non approuvé</h2>
                        <p style="color:#b91c1c;font-size:14px;margin:0;line-height:1.6;">
                          Votre produit <strong>${productName}</strong> n'a pas pu être publié en l'état.
                        </p>
                      </div>
                      <div style="margin-bottom:24px;">
                        <h3 style="color:#334155;font-size:14px;margin:0 0 8px;font-weight:700;">Motif du rejet :</h3>
                        <div style="background:#f8fafc;border:1px dashed #cbd5e1;padding:16px;border-radius:12px;color:#475569;font-size:14px;line-height:1.6;">
                          ${rejectionReason || 'Non-conforme aux exigences de la marketplace Dango Import.'}
                        </div>
                      </div>
                      <div style="text-align:center;margin:32px 0 16px;">
                        <a href="${editUrl || 'https://business.dangoimport.com'}" style="background:#334155;color:#ffffff;padding:14px 30px;font-weight:800;font-size:14px;border-radius:12px;text-decoration:none;display:inline-block;">
                          Accéder à mon espace vendeur →
                        </a>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td style="background:#f8fafc;padding:20px;text-align:center;border-top:1px solid #e2e8f0;">
                      <p style="margin:0;font-size:12px;color:#94a3b8;">Dango Import Marketplace — Tous droits réservés.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `;

      await resend.emails.send({
        from: 'Dango Import Marketplace <marketplace@dangoimport.com>',
        to: vendorEmail,
        subject: `Votre produit "${productName}" n'a pas été approuvé — Dango Import`,
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
        <!DOCTYPE html>
        <html lang="fr">
        <body style="margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:32px 16px;">
            <tr>
              <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 10px 25px rgba(0,0,0,0.05);">
                  <tr>
                    <td style="background:linear-gradient(135deg,#FF6B00 0%,#F68B1E 100%);padding:30px;text-align:center;">
                      <div style="font-size:26px;font-weight:900;color:#ffffff;letter-spacing:1px;">DANGO IMPORT</div>
                      <div style="margin-top:4px;font-size:13px;color:rgba(255,255,255,0.9);font-weight:600;">Espace Vendeur — Notification Marketplace</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:32px;">
                      <div style="background:#fffbeb;border:1px solid #fef08a;border-radius:14px;padding:20px;margin-bottom:24px;">
                        <h2 style="color:#854d0e;font-size:18px;margin:0 0 8px;font-weight:800;">Modifications requises</h2>
                        <p style="color:#a16207;font-size:14px;margin:0;line-height:1.6;">
                          Notre équipe a examiné votre produit <strong>${productName}</strong>. Des ajustements sont nécessaires avant la publication.
                        </p>
                      </div>
                      <div style="margin-bottom:24px;">
                        <h3 style="color:#334155;font-size:14px;margin:0 0 8px;font-weight:700;">Remarques de l'équipe :</h3>
                        <div style="background:#f8fafc;border:1px dashed #fde047;padding:16px;border-radius:12px;color:#475569;font-size:14px;line-height:1.6;">
                          ${comment || 'Veuillez réviser les informations du produit depuis votre tableau de bord.'}
                        </div>
                      </div>
                      <div style="text-align:center;margin:32px 0 16px;">
                        <a href="${editUrl || 'https://business.dangoimport.com'}" style="background:#FF6B00;color:#ffffff;padding:14px 30px;font-weight:800;font-size:14px;border-radius:12px;text-decoration:none;display:inline-block;box-shadow:0 4px 12px rgba(255,107,0,0.25);">
                          Modifier le produit →
                        </a>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td style="background:#f8fafc;padding:20px;text-align:center;border-top:1px solid #e2e8f0;">
                      <p style="margin:0;font-size:12px;color:#94a3b8;">Dango Import Marketplace — Tous droits réservés.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `;

      await resend.emails.send({
        from: 'Dango Import Marketplace <marketplace@dangoimport.com>',
        to: vendorEmail,
        subject: `Des modifications sont nécessaires pour "${productName}" — Dango Import`,
        html,
      });
    } catch (err) {
      console.warn('⚠️ [Resend Email] Changes requested email skipped or failed:', err.message);
    }
  },

  // 4. Email de confirmation de commande
  sendOrderConfirmedEmail: async ({ customerEmail, customerName, orderNumber, total, qrCode, items, qrCodes }) => {
    try {
      const itemList = items || [];
      const qrList = qrCodes || (qrCode ? [{ code: qrCode, vendorName: 'Boutique', metadata: { vendorTotal: total } }] : []);
      const safeName = customerName || 'Client';
      const ordersUrl = 'https://dangoimport.com/mes-commandes';
      const helpUrl = 'https://dangoimport.com/centre-aide';

      const html = `
        <!DOCTYPE html>
        <html lang="fr">
        <body style="margin:0;padding:0;background:#f5f5f5;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#282828;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f5f5;padding:24px 12px;">
            <tr>
              <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #e5e7eb;box-shadow:0 10px 30px rgba(0,0,0,0.06);">
                  <tr>
                    <td style="background:linear-gradient(135deg,#FF6B00 0%,#F68B1E 100%);padding:28px 32px;text-align:center;">
                      <div style="font-size:28px;font-weight:900;color:#ffffff;letter-spacing:1px;">DANGO IMPORT</div>
                      <div style="margin-top:6px;font-size:14px;color:rgba(255,255,255,0.92);">Votre commande est confirmée</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:32px;">
                      <p style="margin:0 0 12px;font-size:16px;line-height:1.6;">Bonjour <strong>${safeName}</strong>,</p>
                      <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#4b5563;">
                        Merci pour votre achat. Votre paiement a été validé et votre commande est maintenant en cours de traitement.
                      </p>

                      <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:16px;padding:20px;margin-bottom:24px;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                          <tr>
                            <td style="font-size:13px;color:#9a3412;padding-bottom:6px;">Numéro de commande</td>
                            <td align="right" style="font-size:13px;color:#9a3412;padding-bottom:6px;">Montant total</td>
                          </tr>
                          <tr>
                            <td style="font-size:20px;font-weight:800;color:#c2410c;">${orderNumber}</td>
                            <td align="right" style="font-size:20px;font-weight:800;color:#c2410c;">${Number(total || 0).toLocaleString('fr-FR')} FCFA</td>
                          </tr>
                        </table>
                      </div>

                      <div style="background:#ECFDF5;border:1px solid #BBF7D0;border-radius:14px;padding:16px 18px;margin-bottom:28px;">
                        <div style="font-size:14px;font-weight:800;color:#166534;margin-bottom:6px;">Codes QR de retrait</div>
                        <div style="font-size:13px;line-height:1.6;color:#15803d;">
                          Conservez cet email. Présentez le QR code correspondant à chaque boutique lors du retrait ou de la livraison de vos articles.
                        </div>
                      </div>

                      ${itemList.length > 0 ? `
                        <h3 style="margin:0 0 14px;font-size:16px;color:#111827;">Récapitulatif des articles</h3>
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:28px;">
                          <thead>
                            <tr>
                              <th align="left" style="padding:10px 0;border-bottom:2px solid #f3f4f6;font-size:12px;color:#6b7280;">Article</th>
                              <th align="center" style="padding:10px 0;border-bottom:2px solid #f3f4f6;font-size:12px;color:#6b7280;">Qté</th>
                              <th align="right" style="padding:10px 0;border-bottom:2px solid #f3f4f6;font-size:12px;color:#6b7280;">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            ${itemList.map((item) => `
                              <tr>
                                <td style="padding:14px 0;border-bottom:1px solid #f3f4f6;">
                                  <div style="font-size:14px;font-weight:700;color:#111827;">${item.productName}</div>
                                  <div style="font-size:12px;color:#6b7280;margin-top:4px;">Vendeur : ${item.vendorName || 'Dango Import'}</div>
                                </td>
                                <td align="center" style="padding:14px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#4b5563;">${item.quantity}</td>
                                <td align="right" style="padding:14px 0;border-bottom:1px solid #f3f4f6;font-size:14px;font-weight:700;color:#111827;">${Number((item.subtotal ?? item.price * item.quantity) || 0).toLocaleString('fr-FR')} FCFA</td>
                              </tr>
                            `).join('')}
                          </tbody>
                        </table>
                      ` : ''}

                      ${qrList.map((qr) => `
                        <div style="border:1px solid #e5e7eb;border-radius:18px;padding:18px;margin-bottom:16px;background:#fafafa;text-align:center;">
                          <div style="font-size:15px;font-weight:800;color:#111827;margin-bottom:4px;">${qr.vendorName || 'Boutique'}</div>
                          ${qr.metadata?.vendorTotal ? `<div style="font-size:12px;color:#FF6B00;font-weight:700;margin-bottom:14px;">Sous-total : ${Number(qr.metadata.vendorTotal).toLocaleString('fr-FR')} FCFA</div>` : ''}
                          <div style="display:inline-block;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;padding:12px;">
                            <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qr.code)}" alt="QR code commande" width="180" height="180" style="display:block;" />
                          </div>
                        </div>
                      `).join('')}

                      <div style="text-align:center;margin:28px 0 10px;">
                        <a href="${ordersUrl}" style="display:inline-block;background:#FF6B00;color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;padding:14px 28px;border-radius:999px;">
                          Voir mes commandes
                        </a>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td style="background:#f9fafb;padding:20px 32px;text-align:center;border-top:1px solid #e5e7eb;">
                      <p style="margin:0 0 8px;font-size:12px;color:#6b7280;">Besoin d'aide ? Consultez notre <a href="${helpUrl}" style="color:#FF6B00;text-decoration:none;font-weight:700;">centre d'aide</a>.</p>
                      <p style="margin:0;font-size:11px;color:#9ca3af;">© ${new Date().getFullYear()} Dango Import. Tous droits réservés.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `;

      await resend.emails.send({
        from: 'Dango Import Marketplace <marketplace@dangoimport.com>',
        to: customerEmail,
        subject: `Commande confirmée — ${orderNumber} — Dango Import`,
        html,
      });
    } catch (err) {
      console.warn('⚠️ [Resend Email] Order confirmed email skipped or failed:', err.message);
    }
  },

  // 5. Email de commande livrée
  sendOrderDeliveredEmail: async ({ customerEmail, customerName, orderNumber, vendorName, amount }) => {
    try {
      const html = `
        <!DOCTYPE html>
        <html lang="fr">
        <body style="margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:32px 16px;">
            <tr>
              <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 10px 25px rgba(0,0,0,0.05);">
                  <tr>
                    <td style="background:linear-gradient(135deg,#FF6B00 0%,#F68B1E 100%);padding:30px;text-align:center;">
                      <div style="font-size:26px;font-weight:900;color:#ffffff;letter-spacing:1px;">DANGO IMPORT</div>
                      <div style="margin-top:4px;font-size:13px;color:rgba(255,255,255,0.9);font-weight:600;">Confirmation de Livraison</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:32px;">
                      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:20px;margin-bottom:24px;">
                        <h2 style="color:#166534;font-size:18px;margin:0 0 8px;font-weight:800;">Commande livrée avec succès !</h2>
                        <p style="color:#15803d;font-size:14px;margin:0;line-height:1.6;">
                          Bonjour <strong>${customerName || 'Client'}</strong>, votre commande <strong>${orderNumber}</strong> a été livrée.
                        </p>
                      </div>
                      <p style="color:#334155;font-size:14px;line-height:1.6;">
                        Vendeur : <strong>${vendorName || 'Boutique Dango Import'}</strong><br />
                        Montant récapitulatif : <strong>${Number(amount || 0).toLocaleString('fr-FR')} FCFA</strong>
                      </p>
                      <div style="text-align:center;margin:32px 0 16px;">
                        <a href="https://dangoimport.com/mes-commandes" style="background:#FF6B00;color:#ffffff;padding:14px 30px;font-weight:800;font-size:14px;border-radius:12px;text-decoration:none;display:inline-block;">
                          Voir mon historique de commande →
                        </a>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td style="background:#f8fafc;padding:20px;text-align:center;border-top:1px solid #e2e8f0;">
                      <p style="margin:0;font-size:12px;color:#94a3b8;">Dango Import Marketplace — Tous droits réservés.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `;

      await resend.emails.send({
        from: 'Dango Import Marketplace <marketplace@dangoimport.com>',
        to: customerEmail,
        subject: `Commande livrée — ${orderNumber} — Dango Import`,
        html,
      });
    } catch (err) {
      console.warn('⚠️ [Resend Email] Order delivered email skipped or failed:', err.message);
    }
  },

  // 6. Email de vérification d'adresse email
  sendVerificationEmail: async ({ to, verifyUrl, firstName }) => {
    try {
      const html = `
        <!DOCTYPE html>
        <html lang="fr">
        <body style="margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:32px 16px;">
            <tr>
              <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 10px 25px rgba(0,0,0,0.05);">
                  <tr>
                    <td style="background:linear-gradient(135deg,#FF6B00 0%,#F68B1E 100%);padding:30px;text-align:center;">
                      <div style="font-size:26px;font-weight:900;color:#ffffff;letter-spacing:1px;">DANGO IMPORT</div>
                      <div style="margin-top:4px;font-size:13px;color:rgba(255,255,255,0.9);font-weight:600;">Sécurité & Vérification du compte</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:32px;">
                      <h2 style="font-size:18px;font-weight:800;color:#0f172a;margin:0 0 12px;">Vérification de votre adresse email</h2>
                      <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 24px;">
                        Bonjour <strong>${firstName || ''}</strong>, merci de confirmer votre adresse email afin de valider et sécuriser votre compte Dango Import.
                      </p>
                      <div style="text-align:center;margin:32px 0 24px;">
                        <a href="${verifyUrl}" style="background:#FF6B00;color:#ffffff;padding:14px 32px;font-weight:800;font-size:14px;border-radius:12px;text-decoration:none;display:inline-block;box-shadow:0 4px 12px rgba(255,107,0,0.25);">
                          Vérifier mon adresse email →
                        </a>
                      </div>
                      <p style="color:#94a3b8;font-size:12px;margin:0;">
                        Si vous n'avez pas créé de compte sur Dango Import, vous pouvez ignorer cet email en toute sécurité.
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="background:#f8fafc;padding:20px;text-align:center;border-top:1px solid #e2e8f0;">
                      <p style="margin:0;font-size:12px;color:#94a3b8;">Dango Import — Tous droits réservés.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `;

      await resend.emails.send({
        from: 'Dango Import <no-reply@dangoimport.com>',
        to,
        subject: 'Vérifiez votre adresse email — Dango Import',
        html,
      });
    } catch (err) {
      console.warn('⚠️ [Resend Email] Verification email skipped or failed:', err?.message || err);
    }
  },
};

module.exports = emailService;
