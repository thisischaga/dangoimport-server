const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in km
  return d;
};

/**
 * Determines the delivery provider for an order based on seller configuration and customer location.
 * @param {Object} store - The vendor store object.
 * @param {Array} customerCoordinates - [longitude, latitude] of the customer.
 * @returns {String} - 'DANGOIMPORT' or 'SELLER'
 */
const determineDeliveryProvider = (store, customerCoordinates) => {
  if (!store || !store.delivery) {
    return 'DANGOIMPORT'; // Fallback par défaut
  }

  const { mode, sellerDelivery, dangoImportFallback } = store.delivery;

  if (mode === 'DANGOIMPORT') {
    return 'DANGOIMPORT';
  }

  if (mode === 'SELLER') {
    if (!sellerDelivery || !sellerDelivery.enabled || !customerCoordinates || customerCoordinates.length !== 2) {
      return dangoImportFallback ? 'DANGOIMPORT' : 'SELLER';
    }

    const sellerCoords = sellerDelivery.location?.coordinates;
    if (!sellerCoords || sellerCoords.length !== 2) {
      return dangoImportFallback ? 'DANGOIMPORT' : 'SELLER';
    }

    const distance = getDistanceFromLatLonInKm(
      sellerCoords[1], sellerCoords[0], // lat1, lon1
      customerCoordinates[1], customerCoordinates[0] // lat2, lon2
    );

    if (distance <= sellerDelivery.radiusKm) {
      return 'SELLER';
    } else {
      return dangoImportFallback ? 'DANGOIMPORT' : 'SELLER';
    }
  }

  if (mode === 'HYBRID') {
    if (!sellerDelivery || !sellerDelivery.enabled || !customerCoordinates || customerCoordinates.length !== 2) {
      return 'DANGOIMPORT';
    }

    const sellerCoords = sellerDelivery.location?.coordinates;
    if (!sellerCoords || sellerCoords.length !== 2) {
      return 'DANGOIMPORT';
    }

    const distance = getDistanceFromLatLonInKm(
      sellerCoords[1], sellerCoords[0],
      customerCoordinates[1], customerCoordinates[0]
    );

    if (distance <= sellerDelivery.radiusKm) {
      return 'SELLER';
    } else {
      return 'DANGOIMPORT';
    }
  }

  return 'DANGOIMPORT';
};

module.exports = {
  getDistanceFromLatLonInKm,
  determineDeliveryProvider
};
