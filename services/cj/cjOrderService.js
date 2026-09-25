/**
 * Stub pour la future chaîne commande Dango → CJdropshipping.
 * Ne modifie pas le checkout existant.
 */

async function createCJOrderFromShopOrder() {
  throw new Error('Création de commande CJ non implémentée.');
}

async function getCJOrderTracking() {
  throw new Error('Suivi commande CJ non implémenté.');
}

module.exports = {
  createCJOrderFromShopOrder,
  getCJOrderTracking,
};
