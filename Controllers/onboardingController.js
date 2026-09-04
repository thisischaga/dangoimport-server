const slugify = require('slugify');
const Store = require('../Models/Store');
const User = require('../Models/User');

const sanitizeCoords = (coords) => {
  if (!coords) return null;
  // accept { lat, lng } or [lng, lat]
  if (Array.isArray(coords) && coords.length >= 2) return [Number(coords[0]), Number(coords[1])];
  if (typeof coords === 'object' && coords.lat !== undefined && coords.lng !== undefined) return [Number(coords.lng), Number(coords.lat)];
  return null;
};

async function getOnboardingStatus(req, res) {
  try {
    const userId = req.user?.userId || req.userId || req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Utilisateur non authentifié.' });

    const store = await Store.findOne({ userId }).lean();
    const user = await User.findById(userId).lean();

    return res.status(200).json({ success: true, data: { store, user } });
  } catch (error) {
    console.error('[onboardingController] getOnboardingStatus error:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur lors de la récupération du statut onboarding.' });
  }
}

async function saveProfile(req, res) {
  try {
    const userId = req.user?.userId || req.userId || req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Utilisateur non authentifié.' });

    const { vendorName, vendorPhone } = req.body;
    if (!vendorName) return res.status(400).json({ success: false, message: 'vendorName requis.' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });

    user.vendorName = vendorName;
    if (vendorPhone) user.userPhone = vendorPhone;
    user.isVendor = true;
    user.role = user.role || 'vendor';
    await user.save();

    // ensure a store doc exists (minimal)
    let store = await Store.findOne({ userId });
    if (!store) {
      const slugBase = slugify(vendorName || `store-${userId}`, { lower: true, strict: true });
      const slug = `${slugBase}-${String(userId).slice(-6)}`;
      store = new Store({ userId, slug, name: vendorName });
      await store.save();
    } else {
      store.name = store.name || vendorName;
      await store.save();
    }

    // mark onboarding profile step completed
    store.onboarding = store.onboarding || {};
    store.onboarding.profileCompleted = true;
    await store.save();

    return res.status(200).json({ success: true, message: 'Profil vendeur sauvegardé.', data: { user, store } });
  } catch (error) {
    console.error('[onboardingController] saveProfile error:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur lors de la sauvegarde du profil.' });
  }
}

async function saveStore(req, res) {
  try {
    const userId = req.user?.userId || req.userId || req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Utilisateur non authentifié.' });

    const { name, description, country, city, address, location } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'name requis.' });

    let store = await Store.findOne({ userId });
    const slugBase = slugify(name, { lower: true, strict: true });
    const slug = `${slugBase}-${String(userId).slice(-6)}`;

    const geo = sanitizeCoords(location);

    if (!store) {
      store = new Store({ userId, slug, name, description, country, city, address });
    } else {
      store.name = name;
      store.description = description || store.description;
      store.country = country || store.country;
      store.city = city || store.city;
      store.address = address || store.address;
    }

    if (geo) {
      store.location = { type: 'Point', coordinates: geo };
    }

    store.onboarding = store.onboarding || {};
    store.onboarding.storeCompleted = true;

    await store.save();

    return res.status(200).json({ success: true, message: 'Informations boutique sauvegardées.', data: store });
  } catch (error) {
    console.error('[onboardingController] saveStore error:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur lors de la sauvegarde de la boutique.' });
  }
}

async function saveDeliveryConfig(req, res) {
  try {
    const userId = req.user?.userId || req.userId || req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Utilisateur non authentifié.' });

    const { mode, sellerDelivery } = req.body;

    if (mode && !['DANGOIMPORT', 'SELLER', 'HYBRID'].includes(mode)) {
      return res.status(400).json({ success: false, message: 'mode invalide.' });
    }

    const store = await Store.findOne({ userId });
    if (!store) return res.status(404).json({ success: false, message: 'Boutique introuvable.' });

    if (mode) store.delivery.mode = mode;
    if (sellerDelivery) {
      store.delivery.sellerDelivery = store.delivery.sellerDelivery || {};
      store.delivery.sellerDelivery.enabled = !!sellerDelivery.enabled;
      store.delivery.sellerDelivery.radiusKm = Number(sellerDelivery.radiusKm) || 0;
      const geo = sanitizeCoords(sellerDelivery.location || sellerDelivery.coords || sellerDelivery.coordinates);
      if (geo) store.delivery.sellerDelivery.location = { type: 'Point', coordinates: geo };
    }

    store.onboarding = store.onboarding || {};
    store.onboarding.deliveryCompleted = true;

    await store.save();

    return res.status(200).json({ success: true, message: 'Configuration de livraison sauvegardée.', data: store });
  } catch (error) {
    console.error('[onboardingController] saveDeliveryConfig error:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur lors de la sauvegarde de la configuration livraison.' });
  }
}

module.exports = {
  getOnboardingStatus,
  saveProfile,
  saveStore,
  saveDeliveryConfig
};
