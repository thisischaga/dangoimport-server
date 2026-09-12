const bcrypt = require('bcryptjs');

async function verifyUserPassword(user, rawPassword) {
  if (!user?.userPassword) {
    if (user?.googleId || user?.authProviders?.includes?.('google')) {
      return { ok: false, reason: 'google' };
    }
    return { ok: false, reason: 'missing' };
  }

  const password = String(rawPassword ?? '').trim();
  if (!password) {
    return { ok: false, reason: 'empty' };
  }

  try {
    const ok = await bcrypt.compare(password, user.userPassword);
    return { ok, reason: ok ? null : 'mismatch' };
  } catch {
    return { ok: false, reason: 'mismatch' };
  }
}

function getPasswordLoginErrorMessage(reason) {
  if (reason === 'google') {
    return 'Ce compte utilise Google. Connectez-vous avec le bouton « Continuer avec Google ».';
  }
  if (reason === 'missing') {
    return 'Aucun mot de passe enregistré pour ce compte. Utilisez Google ou réinitialisez votre mot de passe.';
  }
  return 'Email ou mot de passe incorrect.';
}

module.exports = {
  verifyUserPassword,
  getPasswordLoginErrorMessage,
};
