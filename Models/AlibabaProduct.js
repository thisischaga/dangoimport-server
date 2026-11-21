
const mongoose = require('mongoose');

const { Schema } = mongoose;

// ─────────────────────────────────────────────
// Sous-modèles
// ─────────────────────────────────────────────

const ImportIssueSchema = new Schema(
  {
    code: { type: String, trim: true },
    message: { type: String, trim: true },
    field: { type: String, trim: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const PriceTierSchema = new Schema(
  {
    minQuantity: { type: Number, min: 0 },
    maxQuantity: { type: Number, default: null },
    price: { type: Number, min: 0 },
    currency: { type: String, default: 'USD', trim: true },
  },
  { _id: false }
);

const VariantAttributeSchema = new Schema(
  {
    name: { type: String, trim: true },
    value: { type: String, trim: true },
    nameId: Schema.Types.Mixed,
    valueId: Schema.Types.Mixed,
    image: { type: String, trim: true },
  },
  { _id: false }
);

const AlibabaVariantSchema = new Schema(
  {
    skuId: {
      type: String,
      required: true,
      trim: true,
    },
    sellerSkuId: { type: String, trim: true },
    productId: { type: String, trim: true },
    name: { type: String, trim: true },
    sku: { type: String, trim: true },
    price: { type: Number, min: 0, default: null },
    sourcePrice: { type: Number, min: 0, default: null },
    sourcePriceRaw: { type: Number, min: 0, default: null },
    sourceCurrency: { type: String, trim: true },
    supplierPriceUsd: { type: Number, min: 0, default: null },
    supplierPriceCny: { type: Number, min: 0, default: null },
    stock: { type: Number, min: 0, default: 0 },
    sourceStock: { type: Number, default: null },
    stockKnown: { type: Boolean, default: false },
    sourceStockVerified: { type: Boolean, default: false },
    availability: {
      type: String,
      enum: ['UNKNOWN', 'AVAILABLE', 'UNAVAILABLE', 'CHECK_REQUIRED'],
      default: 'UNKNOWN',
    },
    status: { type: String, trim: true },
    pricingCalculation: { type: Schema.Types.Mixed, default: {} },
    isDefault: { type: Boolean, default: false },

    attributes: {
      type: [VariantAttributeSchema],
      default: [],
    },

    image: { type: String, trim: true },

    unit: { type: String, trim: true },

    status: { type: String, trim: true },

    pricing: {
      type: [PriceTierSchema],
      default: [],
    },

    inventory: {
      quantityRaw: { type: Number, default: null },
      unit: { type: String, trim: true },
      shippingFrom: { type: String, trim: true },

      // Ne pas confondre la valeur brute avec
      // un stock physique confirmé.
      quantityVerified: { type: Boolean, default: false },
      availability: {
        type: String,
        enum: [
          'UNKNOWN',
          'AVAILABLE',
          'UNAVAILABLE',
          'CHECK_REQUIRED',
        ],
        default: 'UNKNOWN',
      },
    },

    raw: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const AlibabaImageSchema = new Schema(
  {
    url: { type: String, trim: true },
    source: {
      type: String,
      enum: ['MAIN', 'GALLERY', 'DESCRIPTION', 'SKU', 'OTHER'],
      default: 'OTHER',
    },
    position: { type: Number, min: 0 },
    isMain: { type: Boolean, default: false },
  },
  { _id: false }
);

// ─────────────────────────────────────────────
// Modèle principal
// ─────────────────────────────────────────────

const AlibabaProductSchema = new Schema(
  {
    source: {
      type: String,
      default: 'ALIBABA',
      required: true,
      index: true,
    },

    // Identifiant stable du produit chez Alibaba.
    sourceProductId: {
      type: String,
      required: true,
      trim: true,
    },

    externalProductId: {
      type: String,
      trim: true,
    },

    sourceUrl: {
      type: String,
      trim: true,
    },

    sourceEndpoint: {
      type: String,
      trim: true,
    },

    sourceCountry: {
      type: String,
      trim: true,
    },

    // ─────────────────────────────────────────
    // Données normalisées du produit
    // ─────────────────────────────────────────

    name: {
      type: String,
      trim: true,
    },

    title: {
      type: String,
      trim: true,
    },

    description: {
      type: String,
    },

    category: {
      type: String,
      trim: true,
    },

    categoryId: {
      type: String,
      trim: true,
    },

    brand: {
      type: String,
      trim: true,
    },

    modelNumber: {
      type: String,
      trim: true,
    },

    supplier: {
      name: { type: String, trim: true },
      companyId: { type: String, trim: true },
      country: { type: String, trim: true },
      address: { type: String, trim: true },
      raw: { type: Schema.Types.Mixed, default: {} },
    },

    attributes: {
      type: [Schema.Types.Mixed],
      default: [],
    },

    // ─────────────────────────────────────────
    // Images
    // ─────────────────────────────────────────

    mainImage: {
      type: String,
      trim: true,
    },

    images: {
      type: [AlibabaImageSchema],
      default: [],
    },

    // ─────────────────────────────────────────
    // Tarification fournisseur
    // ─────────────────────────────────────────

    pricing: {
      currency: { type: String, default: 'USD' },
      unit: { type: String, trim: true },
      minOrderQuantity: { type: Number, min: 0 },
      tiers: {
        type: [PriceTierSchema],
        default: [],
      },
      sourcePrice: { type: Number, min: 0, default: null },
      marginPercentOverride: { type: Number, min: 0, max: 500, default: null },
      manualSalePrice: { type: Number, min: 1, default: null },
      calculation: {
        exchangeRate: { type: Number, min: 0, default: null },
        convertedSupplierPrice: { type: Number, min: 0, default: null },
        marginPercent: { type: Number, min: 0, default: null },
        marginSource: { type: String, trim: true },
        additionalFeesXof: { type: Number, min: 0, default: 0 },
        salePrice: { type: Number, min: 0, default: null },
        saleCurrency: { type: String, trim: true },
        calculatedAt: { type: Date, default: null },
      },
      raw: { type: Schema.Types.Mixed, default: {} },
    },

    // ─────────────────────────────────────────
    // Inventaire
    // ─────────────────────────────────────────

    inventory: {
      unit: { type: String, trim: true },

      quantityRaw: {
        type: Number,
        default: null,
      },

      quantityVerified: {
        type: Boolean,
        default: false,
      },

      availability: {
        type: String,
        enum: [
          'UNKNOWN',
          'AVAILABLE',
          'UNAVAILABLE',
          'CHECK_REQUIRED',
        ],
        default: 'UNKNOWN',
        index: true,
      },

      shippingFrom: {
        type: String,
        trim: true,
      },

      shippingFromList: {
        type: [String],
        default: [],
      },

      lastCheckedAt: {
        type: Date,
        default: null,
      },

      raw: {
        type: Schema.Types.Mixed,
        default: {},
      },
    },

    // ─────────────────────────────────────────
    // Conditionnement et livraison fournisseur
    // ─────────────────────────────────────────

    logistics: {
      weight: { type: Number, default: null },
      weightUnit: { type: String, trim: true },
      packageLength: { type: Number, default: null },
      packageWidth: { type: Number, default: null },
      packageHeight: { type: Number, default: null },
      dimensionUnit: { type: String, trim: true },
      netWeight: { type: Number, min: 0, default: null },
      grossWeight: { type: Number, min: 0, default: null },
      volumeCm3: { type: Number, min: 0, default: null },
      airCategory: { type: String, trim: true, default: '' },
      seaCategory: { type: String, trim: true, default: '' },
      localDeliveryProfile: { type: String, trim: true, default: '' },
      localAdditionalParcelCount: { type: Number, min: 0, default: null },
      fragile: { type: Boolean, default: false },
      hollowOrBulky: { type: Boolean, default: false },
      volumetricEnabled: { type: Boolean, default: null },
      allowedTransportModes: {
        type: [{ type: String, enum: ['air', 'sea'] }],
        default: [],
      },
      shippingTemplateId: { type: String, trim: true },
      processingDays: { type: Number, default: null },
      raw: { type: Schema.Types.Mixed, default: {} },
    },

    adminHistory: {
      type: [{
        changedAt: { type: Date, default: Date.now },
        changedBy: { type: String, default: 'admin' },
        changedFields: { type: [String], default: [] },
        action: { type: String, default: 'update' },
      }],
      default: [],
    },

    // ─────────────────────────────────────────
    // Variantes et SKU Alibaba
    // ─────────────────────────────────────────

    variants: {
      type: [AlibabaVariantSchema],
      default: [],
    },

    // ─────────────────────────────────────────
    // Réponses originales de l'API
    // ─────────────────────────────────────────

    rawPayload: {
      type: Schema.Types.Mixed,
      required: true,
    },

    normalized: {
      type: Schema.Types.Mixed,
      default: {},
    },

    // Copies exactes des différentes sections
    // de la réponse brute, pour faciliter le diagnostic.
    rawSections: {
      product: { type: Schema.Types.Mixed, default: {} },
      inventory: { type: Schema.Types.Mixed, default: {} },
      keyAttributes: { type: Schema.Types.Mixed, default: {} },
    },

    // ─────────────────────────────────────────
    // État de l'importation
    // ─────────────────────────────────────────

    importWarnings: {
      type: [ImportIssueSchema],
      default: [],
    },

    importErrors: {
      type: [ImportIssueSchema],
      default: [],
    },

    price: {
      type: Number,
      default: null,
      index: true,
    },

    salePrice: {
      type: Number,
      default: null,
    },

    publicationStatus: {
      type: String,
      default: 'draft',
      index: true,
    },

    validationStatus: {
      type: String,
      default: 'pending',
      index: true,
    },

    sourceType: {
      type: String,
      default: 'DROPSHIPPING',
      index: true,
    },

    isAlibaba: {
      type: Boolean,
      default: true,
      index: true,
    },

    vendorName: {
      type: String,
      trim: true,
    },

    vendorId: {
      type: Schema.Types.Mixed,
      default: null,
    },

    status: {
      type: String,
      enum: ['RAW', 'IMPORTED', 'SYNCED', 'ERROR', 'PUBLISHED', 'PRODUCT_ONLINE', 'SYNC_ERROR', 'TO_VERIFY', 'READY_TO_PUBLISH'],
      default: 'RAW',
      index: true,
    },

    isPublished: {
      type: Boolean,
      default: false,
      index: true,
    },

    publishedProductId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
      index: true,
    },

    lastSyncedAt: {
      type: Date,
      default: null,
    },

    sourceFetchedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    minimize: false,
    strict: false,
  }
);

// Empêche les doublons d'un même produit fournisseur.
AlibabaProductSchema.index(
  { source: 1, sourceProductId: 1 },
  { unique: true }
);

// Recherche et filtres du panel admin.
AlibabaProductSchema.index({ status: 1, updatedAt: -1 });
AlibabaProductSchema.index({ isPublished: 1, updatedAt: -1 });
AlibabaProductSchema.index({ brand: 1, category: 1 });

module.exports = mongoose.model(
  'AlibabaProduct',
  AlibabaProductSchema
);
