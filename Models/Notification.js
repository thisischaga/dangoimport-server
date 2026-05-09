const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipient: {
    type: String, // 'admin' ou userId (pour les clients)
    required: true,
    index: true
  },
  sender: {
    type: String,
    default: 'System'
  },
  type: {
    type: String, // 'order', 'devis', 'status_update', 'info'
    required: true
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  link: {
    type: String
  },
  isRead: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Notification', notificationSchema);
