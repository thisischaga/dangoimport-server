const { Resend } = require('resend');
const Admin = require('../Models/Admin');

// Initialisation de Resend avec la clé API du .env
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Notifie tous les administrateurs par email d'un nouvel événement
 */
const notifyAdmins = async ({ subject, html }) => {
  console.log(`[Notification] Tentative d'envoi: "${subject}"`);
  
  try {
    if (!process.env.RESEND_API_KEY) {
      console.error('❌ RESEND_API_KEY manquante dans le .env');
      return;
    }

    // 1. Récupérer tous les admins avec un email valide
    const admins = await Admin.find({}, 'adminName');
    console.log(`[Notification] Admins trouvés en DB: ${admins.length}`);
    
    // Regex pour valider un format email standard
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    const adminEmails = admins
      .map(a => a.adminName)
      .filter(email => email && emailRegex.test(email));

    if (adminEmails.length === 0) {
      console.warn('⚠️ Aucun email d\'administrateur valide trouvé.');
      return;
    }

    console.log(`[Notification] Envoi à: ${adminEmails.join(', ')}`);

    // 2. Envoyer l'email
    // On utilise l'email du .env comme expediteur si possible, sinon un défaut
    const sender = process.env.EMAIL || 'onboarding@resend.dev';
    
    const { data, error } = await resend.emails.send({
      from: `Dango Import <${sender}>`,
      to: adminEmails,
      subject: subject,
      html: html,
    });

    if (error) {
      console.error('❌ Erreur Resend API:', error);
      
      // Tentative de secours avec l'email de test Resend si l'expediteur personnalisé échoue
      if (sender !== 'onboarding@resend.dev') {
        console.log('[Notification] Tentative de secours avec onboarding@resend.dev...');
        await resend.emails.send({
          from: 'Dango Import <onboarding@resend.dev>',
          to: adminEmails,
          subject: subject,
          html: html,
        });
      }
    } else {
      console.log('✅ Notification envoyée avec succès. ID:', data.id);
    }
  } catch (err) {
    console.error('❌ Erreur critique lors de la notification admins:', err);
  }
};

module.exports = { notifyAdmins };
