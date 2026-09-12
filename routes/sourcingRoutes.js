const express = require('express');
const SourcingRequest = require('../Models/SourcingRequest');
const Notification = require('../Models/Notification');
const { notifyAdmins } = require('../utils/notifications');
const { verifyAdmin } = require('../Middlewares/verifyTokens');
const { adminActionLogger } = require('../utils/securityAlerts');

const router = express.Router();

const SERVICE_DISABLED_MESSAGE = 'Le service sourcing est désactivé sur la marketplace.';

async function notifyTeamWhatsApp(request) {
  const phone = process.env.TEAM_WHATSAPP_NUMBER;
  const webhook = process.env.WHATSAPP_NOTIFY_URL;

  const message = [
    '🆕 Demande sourcing (admin)',
    `Nom: ${request.fullName}`,
    `Tél: ${request.phone}`,
    `Email: ${request.email}`,
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
    } catch (err) {
      console.error('Erreur WHATSAPP_NOTIFY_URL:', err.message);
    }
  }
}

router.post('/request', (_req, res) => {
  return res.status(410).json({ message: SERVICE_DISABLED_MESSAGE });
});

router.patch('/request/:id/paid', verifyAdmin, adminActionLogger('Sourcing marqué payé', (req) => ({
  targetResource: 'sourcing-request',
  targetId: req.params.id,
})), async (req, res) => {
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
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
});

module.exports = router;
