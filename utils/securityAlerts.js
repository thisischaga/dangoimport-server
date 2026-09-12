const { Resend } = require('resend');
const AuditLog = require('../Models/AuditLog');

const resend = new Resend(process.env.RESEND_API_KEY);
const ALERT_EMAIL = process.env.SECURITY_ALERT_EMAIL || 'credoagotcha@gmail.com';
const ALERT_ENABLED = String(process.env.SECURITY_ALERT_ENABLED ?? 'true') !== 'false';
const DEDUP_MS = Number(process.env.SECURITY_ALERT_DEDUP_MS || 10 * 60 * 1000);

const recentAlerts = new Map();

const SEVERITY_STYLES = {
  critical: { color: '#991b1b', bg: '#fef2f2', label: 'CRITIQUE' },
  warning: { color: '#92400e', bg: '#fffbeb', label: 'ALERTE' },
  info: { color: '#1d4ed8', bg: '#eff6ff', label: 'INFO' },
};

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

function shouldSendAlert(dedupKey) {
  const now = Date.now();
  const last = recentAlerts.get(dedupKey);
  if (last && now - last < DEDUP_MS) return false;
  recentAlerts.set(dedupKey, now);
  if (recentAlerts.size > 500) {
    for (const [key, ts] of recentAlerts) {
      if (now - ts > DEDUP_MS) recentAlerts.delete(key);
    }
  }
  return true;
}

function buildEmailHtml({ severity, title, lines }) {
  const style = SEVERITY_STYLES[severity] || SEVERITY_STYLES.warning;
  const rows = lines
    .filter(Boolean)
    .map(
      (line) => `<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#475569;font-size:14px;">${line}</td></tr>`
    )
    .join('');

  return `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px;">
      <div style="background:${style.bg};border:1px solid ${style.color};border-radius:12px;padding:16px 18px;margin-bottom:18px;">
        <div style="font-size:12px;font-weight:800;color:${style.color};letter-spacing:1px;">${style.label}</div>
        <h2 style="margin:8px 0 0;color:#111827;font-size:20px;">${title}</h2>
      </div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table>
      <p style="margin-top:18px;font-size:12px;color:#94a3b8;">Dango import — alerte sécurité serveur</p>
    </div>
  `;
}

async function sendSecurityAlert({
  category = 'security',
  severity = 'warning',
  title,
  lines = [],
  req,
  meta = {},
  dedupKey,
}) {
  if (!ALERT_ENABLED || !process.env.RESEND_API_KEY) {
    if (!process.env.RESEND_API_KEY) {
      console.warn('[securityAlerts] RESEND_API_KEY manquante — alerte non envoyée:', title);
    }
    return;
  }

  const key = dedupKey || `${category}:${severity}:${title}:${getClientIp(req)}`;
  if (!shouldSendAlert(key)) return;

  const timestamp = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Porto-Novo' });
  const ip = req ? getClientIp(req) : meta.ip || 'unknown';
  const path = req ? `${req.method} ${req.originalUrl || req.url}` : meta.path || '—';
  const userAgent = req?.headers?.['user-agent'] || meta.userAgent || '—';

  const emailLines = [
    `<strong>Date :</strong> ${timestamp}`,
    `<strong>Catégorie :</strong> ${category}`,
    ...lines,
    `<strong>IP :</strong> ${ip}`,
    `<strong>Route :</strong> ${path}`,
    `<strong>User-Agent :</strong> ${userAgent}`,
  ];

  if (meta && Object.keys(meta).length) {
    emailLines.push(`<strong>Détails :</strong> ${JSON.stringify(meta)}`);
  }

  const from = process.env.SECURITY_ALERT_FROM
    || (process.env.EMAIL ? `Dango import Sécurité <${process.env.EMAIL}>` : 'Dango import Sécurité <onboarding@resend.dev>');

  try {
    await resend.emails.send({
      from,
      to: ALERT_EMAIL,
      subject: `[${SEVERITY_STYLES[severity]?.label || 'ALERTE'}] ${title}`,
      html: buildEmailHtml({ severity, title, lines: emailLines }),
    });
  } catch (error) {
    console.error('[securityAlerts] envoi email échoué:', error.message);
  }
}

async function alertIntrusion(req, reason, meta = {}) {
  return sendSecurityAlert({
    category: 'intrusion',
    severity: 'critical',
    title: 'Tentative d’intrusion ou accès non autorisé',
    lines: [`<strong>Motif :</strong> ${reason}`],
    req,
    meta,
    dedupKey: `intrusion:${reason}:${getClientIp(req)}:${req?.originalUrl}`,
  });
}

async function alertRateLimit(req, limiterName, meta = {}) {
  return sendSecurityAlert({
    category: 'intrusion',
    severity: 'warning',
    title: 'Limite de requêtes dépassée',
    lines: [
      `<strong>Protection :</strong> ${limiterName}`,
      `<strong>Motif :</strong> Trop de requêtes depuis cette IP`,
    ],
    req,
    meta,
    dedupKey: `ratelimit:${limiterName}:${getClientIp(req)}`,
  });
}

async function alertFailedAdminLogin(req, adminName) {
  return sendSecurityAlert({
    category: 'intrusion',
    severity: 'warning',
    title: 'Échec de connexion administrateur',
    lines: [`<strong>Identifiant tenté :</strong> ${adminName || 'inconnu'}`],
    req,
    dedupKey: `admin-login-fail:${adminName}:${getClientIp(req)}`,
  });
}

async function alertAdminActivity(req, action, details = {}, options = {}) {
  const admin = req?.admin || req?.user || {};
  const adminName = admin.adminName || admin.userEmail || admin.email || 'Admin';
  const adminRole = admin.role || 'admin';

  if (!options.skipAuditLog) {
    try {
      await AuditLog.create({
        userId: admin._id || admin.userId || admin.id,
        userName: `${admin.adminFirstname || admin.firstname || ''} ${admin.adminSurname || admin.surname || adminName}`.trim() || adminName,
        role: adminRole,
        action,
        targetResource: details.targetResource || 'server',
        targetId: details.targetId ? String(details.targetId) : undefined,
        details,
        ipAddress: getClientIp(req),
      });
    } catch (error) {
      console.error('[securityAlerts] AuditLog error:', error.message);
    }
  }

  return sendSecurityAlert({
    category: 'admin',
    severity: 'info',
    title: `Activité administration : ${action}`,
    lines: [
      `<strong>Admin :</strong> ${adminName}`,
      `<strong>Rôle :</strong> ${adminRole}`,
      details.summary ? `<strong>Résumé :</strong> ${details.summary}` : null,
      details.targetResource ? `<strong>Ressource :</strong> ${details.targetResource}` : null,
      details.targetId ? `<strong>ID :</strong> ${details.targetId}` : null,
    ].filter(Boolean),
    req,
    meta: details,
    dedupKey: `admin:${action}:${adminName}:${details.targetId || ''}`,
  });
}

function adminActionLogger(action, detailsResolver) {
  return (req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const details = typeof detailsResolver === 'function' ? detailsResolver(req) : (detailsResolver || {});
        alertAdminActivity(req, action, details).catch(() => {});
      }
    });
    next();
  };
}

module.exports = {
  getClientIp,
  sendSecurityAlert,
  alertIntrusion,
  alertRateLimit,
  alertFailedAdminLogin,
  alertAdminActivity,
  adminActionLogger,
};
