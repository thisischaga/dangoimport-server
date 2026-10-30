
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
      shippingTemplateId: { type: String, trim: true },
      processingDays: { type: Number, default: null },
      raw: { type: Schema.Types.Mixed, default: {} },
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

    status: {
      type: String,
      enum: ['RAW', 'IMPORTED', 'SYNCED', 'ERROR'],
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
