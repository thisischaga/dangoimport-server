const Promotion = require('../Models/Promotion');
const PromoUsage = require('../Models/PromoUsage');

const validatePromotion = async (promoCode, subtotal, userId, cartItems = []) => {
  if (!promoCode) {
    return { discount: 0 };
  }

  const code = String(promoCode).trim().toUpperCase();
  const promotion = await Promotion.findOne({ code });
  if (!promotion) {
    return { error: 'Code promo invalide.' };
  }

  const now = new Date();
  if (promotion.status !== 'active') {
    return { error: 'Ce code promo n’est pas actif.' };
  }
  if (promotion.startDate && promotion.startDate > now) {
    return { error: 'Ce code promo n’est pas encore actif.' };
  }
  if (promotion.endDate && promotion.endDate < now) {
    return { error: 'Ce code promo est expiré.' };
  }
  if (promotion.minOrderAmount && subtotal < promotion.minOrderAmount) {
    return { error: `Montant minimum de commande ${promotion.minOrderAmount} FCFA requis.` };
  }
  if (promotion.maxUses !== null && promotion.maxUses !== undefined && promotion.usedCount >= promotion.maxUses) {
    return { error: 'Ce code promo a atteint sa limite d’utilisation.' };
  }
  if (promotion.maxUsesPerUser && userId) {
    const userUses = await PromoUsage.countDocuments({ promotionId: promotion._id, userId });
    if (userUses >= promotion.maxUsesPerUser) {
      return { error: 'Vous avez déjà utilisé ce code promo le nombre maximum de fois.' };
    }
  }

  const eligibleProducts = promotion.applicableProducts?.map(String) || [];
  const excludedProducts = promotion.excludedProducts?.map(String) || [];
  const eligibleCategories = promotion.applicableCategories || [];
  const excludedCategories = promotion.excludedCategories || [];

  let eligibleSubtotal = 0;
  for (const item of cartItems) {
    const productId = String(item.productId || item._id || item.id);
    const category = item.category || item.productCategory || '';
    const unitPrice = Number(item.price || item.salePrice || item.promoPrice || 0);
    const itemSubtotal = unitPrice * Number(item.quantity || 1);

    const isExcludedProduct = excludedProducts.length > 0 && excludedProducts.includes(productId);
    const isExcludedCategory = excludedCategories.length > 0 && excludedCategories.includes(category);
    const isSaleProduct = promotion.excludeOnSale && Number(item.salePrice || item.promoPrice || 0) > 0 && Number(item.salePrice || item.promoPrice || 0) < Number(item.price || 0);

    if (isExcludedProduct || isExcludedCategory || isSaleProduct) {
      continue;
    }

    if (eligibleProducts.length > 0 && !eligibleProducts.includes(productId)) {
      continue;
    }

    if (eligibleCategories.length > 0 && !eligibleCategories.includes(category)) {
      continue;
    }

    eligibleSubtotal += itemSubtotal;
  }

  if (eligibleSubtotal <= 0) {
    return { error: 'Aucun article éligible pour ce code promo.' };
  }

  let discount = 0;
  if (promotion.discountType === 'percentage') {
    const raw = eligibleSubtotal * (promotion.discountValue / 100);
    discount = promotion.maxDiscount ? Math.min(raw, promotion.maxDiscount) : raw;
  } else {
    discount = Math.min(Number(promotion.discountValue || 0), eligibleSubtotal);
  }

  return { promotion, discount, eligibleSubtotal };
};

module.exports = { validatePromotion };
