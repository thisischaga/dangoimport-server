const mongoose = require('mongoose');

const supplierSyncJobSchema = new mongoose.Schema({
  supplier: {
    type: String,
    default: 'cj',
    index: true,
  },
  type: {
    type: String,
    enum: ['import', 'sync', 'selective_import'],
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'running', 'success', 'failed'],
    default: 'pending',
    index: true,
  },
  params: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  progress: {
    currentPage: { type: Number, default: 0 },
    totalPages: { type: Number, default: 0 },
    received: { type: Number, default: 0 },
    imported: { type: Number, default: 0 },
    updated: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
  },
  logs: [
    {
      at: { type: Date, default: Date.now },
      level: { type: String, default: 'info' },
      message: String,
    },
  ],
  error: { type: String, default: '' },
  startedAt: Date,
  finishedAt: Date,
  createdBy: String,
}, { timestamps: true });

supplierSyncJobSchema.index({ supplier: 1, createdAt: -1 });

module.exports = mongoose.model('SupplierSyncJob', supplierSyncJobSchema);
