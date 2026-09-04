const mongoose = require('mongoose');

const deliveryEventSchema = new mongoose.Schema({
  deliveryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Delivery', required: true, index: true },
  event: { type: String, required: true, index: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, refPath: 'actorModel' },
  actorModel: { type: String, enum: ['User','Admin','Vendor','System'], default: 'User' },
  actorRole: String,
  timestamp: { type: Date, default: Date.now, index: true },
  location: {
    latitude: Number,
    longitude: Number,
    accuracy: Number,
  },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
});

module.exports = mongoose.model('DeliveryEvent', deliveryEventSchema);
