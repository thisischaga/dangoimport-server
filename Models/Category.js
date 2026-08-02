const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
  description: { type: String, default: '' },
  image: { type: String, default: '' },
  banner: { type: String, default: '' },
  seoTitle: String,
  seoDescription: String,
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Category', categorySchema);
