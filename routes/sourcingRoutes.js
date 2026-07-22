const express = require('express');
const SourcingRequest = require('../Models/SourcingRequest');
const Notification = require('../Models/Notification');
const { notifyAdmins } = require('../utils/notifications');

const router = express.Router();

async function notifyTeamWhatsApp(request) {
  const phone = process.env.TEAM_WHATSAPP_NUMBER;
  const webhook = process.env.WHATSAPP_NOTIFY_URL;

  const message = [
    '🆕 Nouvelle demande Sourcing DangoImport',
    `Nom: ${request.fullName}`,
    `Tél: ${request.phone}`,
    `Email: ${request.email}`,
    `Pays: ${request.country}`,
    `Produit: ${request.productDescription}`,
    `Qté: ${request.quantity}`,
    `Budget: ${request.budget} FCFA`,
    request.exampleLink ? `Lien: ${request.exampleLink}` : null,
    request.imageUrl ? `Image: ${request.imageUrl}` : null,
    `Statut: ${request.status}`,
  ]
    .filter(Boolean)
    .join('\n');

  if (webhook) {
    try {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, message, type: 'sourcing', requestId: String(request._id) }),
      });
      return;
    } catch (err) {
      console.error('Erreur WHATSAPP_NOTIFY_URL:', err.message);
    }
  }

  if (phone) {
    console.log(`[WhatsApp équipe] Préparer envoi à ${phone}:\n${message}`);
  }
}

router.post('/request', async (req, res) => {
  try {
    const {
      fullName,
      email,
      phone,
      country,
      productDescription,
      quantity,
      budget,
      exampleLink,
      imageUrl,
      imageBase64,
      studyFee,
      markPaid,
      paymentTransactionId,
    } = req.body;

    if (!fullName || !email || !phone || !country || !productDescription || !quantity || budget === undefined) {
      return res.status(400).json({
        message: 'Champs requis manquants (nom, email, téléphone, pays, description, quantité, budget).',
      });
    }

    if (!exampleLink || !String(exampleLink).trim()) {
      return res.status(400).json({ message: 'Le lien exemple du produit est obligatoire.' });
    }

    if (!imageUrl && !imageBase64) {
      return res.status(400).json({ message: 'La photo du produit est obligatoire.' });
    }

    const { persistImageUrl } = require('../utils/imageStorage');
    let finalImageUrl = imageUrl ? String(imageUrl).trim() : '';
    if (imageBase64) {
      try {
        finalImageUrl = await persistImageUrl(String(imageBase64));
      } catch (imgErr) {
        console.error('Erreur persist image sourcing:', imgErr.message);
        return res.status(400).json({ message: "Impossible d'enregistrer la photo du produit." });
      }
    }

    if (!finalImageUrl) {
      return res.status(400).json({ message: 'La photo du produit est obligatoire.' });
    }

    const normalizedCountry = String(country).trim() === 'Benin' ? 'Bénin' : String(country).trim();

    const doc = await SourcingRequest.create({
      fullName: String(fullName).trim(),
      email: String(email).trim().toLowerCase(),
      phone: String(phone).trim(),
      country: normalizedCountry,
      productDescription: String(productDescription).trim(),
      quantity: String(quantity).trim(),
      budget: Number(budget),
      exampleLink: String(exampleLink).trim(),
      imageUrl: finalImageUrl,
      studyFee: Number(studyFee) || 5000,
      status: markPaid ? 'paid' : 'pending_payment',
      paymentTransactionId: paymentTransactionId || undefined,
    });

    try {
      await Notification.create({
        recipient: 'admin',
        sender: doc.fullName,
        type: 'sourcing',
        title: 'Nouvelle demande de sourcing',
        message: `${doc.fullName} — ${doc.productDescription.slice(0, 120)}`,
        link: `/sourcing/${doc._id}`,
      });
    } catch (notifErr) {
      console.error('Notification admin sourcing:', notifErr.message);
    }

    await notifyAdmins({
      subject: `Nouvelle demande sourcing — ${doc.fullName}`,
      html: `
        <h2>Demande d'étude de sourcing (5000F)</h2>
        <p><strong>Nom:</strong> ${doc.fullName}</p>
        <p><strong>Email:</strong> ${doc.email}</p>
        <p><strong>Téléphone:</strong> ${doc.phone}</p>
        <p><strong>Pays:</strong> ${doc.country}</p>
        <p><strong>Produit:</strong> ${doc.productDescription}</p>
        <p><strong>Quantité:</strong> ${doc.quantity}</p>
        <p><strong>Budget:</strong> ${doc.budget} FCFA</p>
        ${doc.exampleLink ? `<p><strong>Lien:</strong> <a href="${doc.exampleLink}">${doc.exampleLink}</a></p>` : ''}
        ${doc.imageUrl ? `<p><strong>Image:</strong> <a href="${doc.imageUrl}">Voir</a></p>` : ''}
        <p><strong>Statut:</strong> ${doc.status}</p>
      `,
    });

    await notifyTeamWhatsApp(doc);

    return res.status(201).json({
      success: true,
      message: 'Demande de sourcing enregistrée.',
      requestId: doc._id,
      data: doc,
    });
  } catch (error) {
    console.error('Erreur POST /api/sourcing/request:', error);
    return res.status(500).json({
      message: error.message || 'Erreur lors de l’enregistrement de la demande.',
    });
  }
});

router.patch('/request/:id/paid', async (req, res) => {
  try {
    const updated = await SourcingRequest.findByIdAndUpdate(
      req.params.id,
      {
        status: 'paid',
        paymentTransactionId: req.body.paymentTransactionId || undefined,
      },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ message: 'Demande introuvable.' });
    }
    await notifyTeamWhatsApp(updated);
    return res.json({ success: true, data: updated });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Erreur serveur.' });
  }
});

module.exports = router;
