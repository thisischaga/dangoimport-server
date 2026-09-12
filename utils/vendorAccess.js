const Store = require('../Models/Store');

/**
 * Un même compte peut être client, vendeur et livreur.
 * L'accès vendeur ne doit pas dépendre uniquement de user.role === 'vendor'.
 */
async function userHasVendorAccess(user, options = {}) {
  if (!user) return false;
  if (user.isVendor === true) return true;
  if (user.role === 'vendor') return true;
  if (options.store !== undefined) return Boolean(options.store);

  const store = await Store.findOne({ userId: user._id }).select('_id').lean();
  return Boolean(store);
}

function getVendorLoginDeniedMessage(user) {
  if (!user) {
    return 'Compte introuvable.';
  }

  if (user.role === 'driver' && !user.isVendor) {
    return 'Ce compte est enregistré comme livreur. Utilisez l’application Dango Delivery pour vous connecter.';
  }

  if (user.role === 'customer' && !user.isVendor) {
    return 'Ce compte client n’a pas encore d’espace vendeur. Créez une boutique pour continuer.';
  }

  return 'Accès réservé aux vendeurs.';
}

module.exports = {
  userHasVendorAccess,
  getVendorLoginDeniedMessage,
};
