function computeOnboardingComplete(store, user) {
  if (!store) return false;

  const onboarding = store.onboarding || {};
  if (
    onboarding.profileCompleted &&
    onboarding.storeCompleted &&
    onboarding.deliveryCompleted
  ) {
    return true;
  }

  const isVendor = Boolean(user?.isVendor || user?.role === 'vendor');
  if (!isVendor || !store.name) return false;

  // Boutique déjà configurée (vendeur actif, ancien flux ou création admin)
  const hasLegacyStoreData = Boolean(
    store.city ||
    store.country ||
    store.address ||
    store.description ||
    store.whatsapp
  );

  return hasLegacyStoreData;
}

module.exports = {
  computeOnboardingComplete,
};
