const express = require('express');
const crypto = require('crypto');
const verifyToken = require('../Middlewares/verifyTokens');
const User = require('../Models/User');
const WithdrawalAttempt = require('../Models/WithdrawalAttempt');
const VendorWithdrawal = require('../Models/VendorWithdrawal');
const { Resend } = require('resend');

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);

// Helper to hash OTP
function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp)).digest('hex');
}

// Basic phone validation (accepts + and digits, minimal length)
function validatePhone(phone) {
  if (!phone) return false;
  const cleaned = String(phone).replace(/\s+/g, '');
  return /^\+?[0-9]{8,15}$/.test(cleaned);
}

// POST /api/vendor/withdrawals/prepare
router.post('/prepare', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { amount, destinationPhone } = req.body;

    if (!amount || Number(amount) <= 0) return res.status(400).json({ message: 'Montant invalide.' });
    if (!validatePhone(destinationPhone)) return res.status(400).json({ message: 'Numéro Mobile Money invalide.' });

    // Reload user to get current balance
    const user = await User.findById(userId).select('balance reservedBalance userEmail userPhone');
    if (!user) return res.status(404).json({ message: 'Vendeur introuvable.' });

    const amt = Number(amount);
    const available = (user.balance || 0) - (user.reservedBalance || 0);
    if (amt > available) return res.status(400).json({ message: 'Solde insuffisant.' });

    // Invalidate previous attempts for this user (simple safety)
    await WithdrawalAttempt.updateMany({ userId, status: 'otp_sent' }, { status: 'cancelled' });

    // Generate secure OTP
    const otp = String(100000 + crypto.randomInt(0, 900000));
    const otpHash = hashOtp(otp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const attempt = await WithdrawalAttempt.create({
      userId,
      amount: amt,
      destinationPhone: destinationPhone.trim(),
      otpHash,
      otpExpiresAt: expiresAt,
      otpAttempts: 0,
    });

    // Send OTP via email (use existing Resend/email mechanism)
    try {
      const to = user.userEmail;
      const fromEmail = process.env.EMAIL ? `Dango Import <${process.env.EMAIL}>` : 'no-reply@dangoimport.com';
      await resend.emails.send({
        from: fromEmail,
        to: [to],
        subject: 'Code de confirmation retrait DangoImport',
        html: `<div style="font-family: sans-serif; color:#0f172a"><h3>Code de confirmation</h3><p>Votre code de confirmation pour le retrait de ${amt} FCFA est :</p><div style="font-weight:bold; font-size:20px; letter-spacing:4px;">${otp}</div><p>Il expire dans 10 minutes.</p></div>`
      });
    } catch (e) {
      console.error('[withdrawals.prepare] OTP email send failed:', e.message);
      // Do not leak OTP, but proceed — developer/admin should ensure email service is configured
    }

    return res.status(200).json({ success: true, attemptId: attempt._id, message: 'OTP envoyé.' });
  } catch (error) {
    console.error('[withdrawals.prepare] error:', error);
    return res.status(500).json({ message: 'Erreur serveur lors de la préparation du retrait.' });
  }
});

// POST /api/vendor/withdrawals/resend-otp
router.post('/resend-otp', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { attemptId } = req.body;
    if (!attemptId) return res.status(400).json({ message: 'attemptId requis.' });

    const attempt = await WithdrawalAttempt.findById(attemptId);
    if (!attempt || String(attempt.userId) !== String(userId)) return res.status(404).json({ message: 'Tentative introuvable.' });
    if (attempt.status !== 'otp_sent') return res.status(400).json({ message: 'Tentative non valide pour renvoi.' });

    // Rate limit: allow resend every 60s (simple)
    const since = Date.now() - (60 * 1000);
    if (attempt.createdAt && attempt.createdAt.getTime() > since) {
      return res.status(429).json({ message: 'Veuillez attendre avant de renvoyer le code.' });
    }

    // Create a new OTP
    const otp = String(100000 + crypto.randomInt(0, 900000));
    const otpHash = hashOtp(otp);
    attempt.otpHash = otpHash;
    attempt.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    attempt.otpAttempts = 0;
    attempt.createdAt = new Date();
    await attempt.save();

    // Send via email
    const user = await User.findById(userId).select('userEmail');
    try {
      const to = user.userEmail;
      const fromEmail = process.env.EMAIL ? `Dango Import <${process.env.EMAIL}>` : 'no-reply@dangoimport.com';
      await resend.emails.send({
        from: fromEmail,
        to: [to],
        subject: 'Renvoyé : Code de confirmation retrait DangoImport',
        html: `<div style="font-family: sans-serif; color:#0f172a"><h3>Code de confirmation</h3><p>Votre nouveau code de confirmation pour le retrait est :</p><div style="font-weight:bold; font-size:20px; letter-spacing:4px;">${otp}</div><p>Il expire dans 10 minutes.</p></div>`
      });
    } catch (e) {
      console.error('[withdrawals.resend-otp] send failed:', e.message);
    }

    return res.status(200).json({ success: true, message: 'OTP renvoyé.' });
  } catch (error) {
    console.error('[withdrawals.resend-otp] error:', error);
    return res.status(500).json({ message: 'Erreur serveur lors du renvoi de l’OTP.' });
  }
});

// POST /api/vendor/withdrawals/verify-otp
router.post('/verify-otp', verifyToken, async (req, res) => {
  const session = await WithdrawalAttempt.startSession();
  session.startTransaction();
  try {
    const userId = req.user.userId || req.user.id;
    const { attemptId, otp } = req.body;
    if (!attemptId || !otp) return res.status(400).json({ message: 'attemptId et otp requis.' });

    const attempt = await WithdrawalAttempt.findById(attemptId).session(session);
    if (!attempt || String(attempt.userId) !== String(userId)) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Tentative introuvable.' });
    }

    if (attempt.status !== 'otp_sent') {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Tentative non valide.' });
    }

    if (attempt.otpExpiresAt && attempt.otpExpiresAt.getTime() < Date.now()) {
      attempt.status = 'expired';
      await attempt.save({ session });
      await session.commitTransaction();
      return res.status(400).json({ message: 'Code expiré.' });
    }

    // Brute force protection
    if (attempt.otpAttempts >= 5) {
      attempt.status = 'cancelled';
      await attempt.save({ session });
      await session.commitTransaction();
      return res.status(429).json({ message: 'Trop de tentatives. Veuillez relancer la demande.' });
    }

    const candidateHash = hashOtp(otp);
    if (candidateHash !== attempt.otpHash) {
      attempt.otpAttempts = (attempt.otpAttempts || 0) + 1;
      await attempt.save({ session });
      await session.commitTransaction();
      return res.status(400).json({ message: 'Code incorrect.' });
    }

    // OTP is correct. Create the finalized withdrawal and reserve amount atomically on user.
    const user = await User.findById(userId).session(session).select('balance reservedBalance userEmail');
    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Vendeur introuvable.' });
    }

    const available = (user.balance || 0) - (user.reservedBalance || 0);
    if (attempt.amount > available) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Solde insuffisant.' });
    }

    // reserve amount by incrementing reservedBalance
    user.reservedBalance = (user.reservedBalance || 0) + attempt.amount;
    await user.save({ session });

    // create withdrawal record
    const withdrawal = await VendorWithdrawal.create([
      {
        userId: user._id,
        amount: attempt.amount,
        destinationPhone: attempt.destinationPhone,
        status: 'pending',
        otpVerified: true,
        reservedAt: new Date(),
      }
    ], { session });

    // mark attempt verified
    attempt.status = 'verified';
    attempt.otpVerifiedAt = new Date();
    await attempt.save({ session });

    await session.commitTransaction();

    return res.status(200).json({ success: true, withdrawal: withdrawal[0] });
  } catch (error) {
    await session.abortTransaction();
    console.error('[withdrawals.verify-otp] error:', error);
    return res.status(500).json({ message: 'Erreur serveur lors de la vérification du code.' });
  } finally {
    session.endSession();
  }
});

// GET /api/vendor/withdrawals - list withdrawals for vendor
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const rows = await VendorWithdrawal.find({ userId }).sort({ createdAt: -1 }).limit(200).lean();
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('[withdrawals.list] error:', error);
    return res.status(500).json({ message: 'Erreur serveur lors du chargement des retraits.' });
  }
});

// GET /api/vendor/withdrawals/payouts - list completed payouts for vendor
router.get('/payouts', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    // Only return payouts that have been completed (funds effectively paid out)
    const rows = await VendorWithdrawal.find({ userId, status: 'completed' }).sort({ createdAt: -1 }).limit(500).lean();
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('[withdrawals.payouts] error:', error);
    return res.status(500).json({ message: 'Erreur serveur lors du chargement des paiements versés.' });
  }
});

// GET /api/vendor/withdrawals/:id
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const id = req.params.id;
    const w = await VendorWithdrawal.findById(id).lean();
    if (!w || String(w.userId) !== String(userId)) return res.status(404).json({ message: 'Retrait introuvable.' });
    return res.status(200).json({ success: true, data: w });
  } catch (error) {
    console.error('[withdrawals.detail] error:', error);
    return res.status(500).json({ message: 'Erreur serveur lors du chargement du retrait.' });
  }
});

module.exports = router;
