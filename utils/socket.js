const { Server } = require('socket.io');
const Admin = require('../Models/Admin');
const User = require('../Models/User');
const Notification = require('../Models/Notification');
const { isOriginAllowed } = require('./corsConfig');
const { verifyAccessToken } = require('./jwtConfig');

let io;

const isStrictSocketAuth = () => (
  process.env.SOCKET_STRICT_AUTH === 'true'
  || process.env.NODE_ENV === 'production'
);

const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (isOriginAllowed(origin)) return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
      },
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      credentials: true,
    },
    transports: ['polling', 'websocket'],
    allowEIO3: true,
    pingTimeout: 20000,
    pingInterval: 25000,
  });

  io.on('connection', (socket) => {
    console.log(`[Socket] Nouveau client connecté: ${socket.id}`);

    try {
      const token = socket.handshake?.auth?.token;
      if (token) {
        const decoded = verifyAccessToken(token);
        const userId = decoded.userId || decoded.id;

        if (['admin', 'dev-admin', 'superadmin', 'manager'].includes(decoded.role)) {
          Admin.findById(userId).select('-adminPassword').then((admin) => {
            if (admin) {
              socket.user = { ...decoded, id: admin._id, role: admin.role || decoded.role };
              socket.join(`user_${admin._id}`);
              socket.join('admin');
            }
          }).catch(() => {});
        } else {
          User.findById(userId).select('userFirstname userSurname userEmail userPhone role').then((user) => {
            if (user) {
              socket.user = { ...decoded, id: user._id, role: user.role || decoded.role || 'user' };
              socket.join(`user_${user._id}`);
              if (user.role === 'driver') {
                socket.join(`driver_${user._id}`);
              }
            }
          }).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('[Socket] Token socket invalide ou expiré:', err?.message || err);
      if (isStrictSocketAuth()) {
        socket.disconnect(true);
        return;
      }
    }

    socket.on('authenticate', async (payload) => {
      const token = (payload && payload.token) || null;
      if (!token) {
        socket.emit('unauthorized', { message: 'Aucun token fourni' });
        if (isStrictSocketAuth()) return socket.disconnect(true);
        return;
      }

      try {
        const decoded = verifyAccessToken(token);
        const userId = decoded.userId || decoded.id;

        if (['admin', 'dev-admin', 'superadmin', 'manager'].includes(decoded.role)) {
          const admin = await Admin.findById(userId).select('-adminPassword');
          if (admin) {
            socket.user = { ...decoded, id: admin._id, role: admin.role || decoded.role };
            socket.join(`user_${admin._id}`);
            socket.join('admin');
            socket.emit('authenticated', { id: admin._id, role: socket.user.role });
            return;
          }
        }

        const user = await User.findById(userId).select('userFirstname userSurname userEmail userPhone role');
        if (user) {
          socket.user = { ...decoded, id: user._id, role: user.role || decoded.role || 'user' };
          socket.join(`user_${user._id}`);
          if (user.role === 'driver') socket.join(`driver_${user._id}`);
          socket.emit('authenticated', { id: user._id, role: socket.user.role });
          return;
        }

        socket.emit('unauthorized', { message: 'Utilisateur introuvable' });
        if (isStrictSocketAuth()) socket.disconnect(true);
      } catch (error) {
        socket.emit('unauthorized', { message: 'Token invalide' });
        if (isStrictSocketAuth()) socket.disconnect(true);
      }
    });

    socket.on('join', (room) => {
      socket.join(room);
    });

    socket.on('join_user', (userId) => {
      if (!userId) return;
      socket.join(`user_${userId}`);
    });

    socket.on('join_driver', (driverId) => {
      if (!driverId) return;
      socket.join(`driver_${driverId}`);
    });

    socket.on('join_order', (orderId) => {
      if (!orderId) return;
      socket.join(`order_${orderId}`);
    });

    socket.on('calculate_delivery_for_user', async (payload) => {
      try {
        const { lat, lng, items } = payload || {};
        const clientLocation = (lat !== undefined && lng !== undefined)
          ? { lat: Number(lat), lng: Number(lng) }
          : null;

        const { calculateDeliveryForItems } = require('../services/deliveryService');
        const result = await calculateDeliveryForItems({ items: items || [], clientLocation });

        socket.emit('delivery_price_update', { data: result });

        if (socket.user && socket.user.id && io) {
          io.to(`user_${socket.user.id}`).emit('delivery_price_update', { data: result });
        }
      } catch (err) {
        console.error(`[Socket:${socket.id}] error calculating delivery:`, err);
        socket.emit('delivery_price_update_error', { message: 'Erreur calcul livraison' });
      }
    });

    socket.on('disconnect', () => {});
  });

  return io;
};

const sendNotification = async ({ recipient, type, title, message, link, sender = 'System' }) => {
  try {
    const newNotif = new Notification({
      recipient,
      type,
      title,
      message,
      link,
      sender,
    });
    await newNotif.save();

    if (io) {
      if (recipient === 'admin') {
        io.to('admin').emit('new_notification', newNotif);
      } else {
        io.to(`user_${recipient}`).emit('new_notification', newNotif);
      }
    }

    return newNotif;
  } catch (error) {
    console.error('❌ Erreur lors de l\'envoi de la notification socket:', error);
  }
};

const getIO = () => {
  if (!io) {
    throw new Error("Socket.io n'est pas initialisé !");
  }
  return io;
};

module.exports = { initSocket, sendNotification, getIO };
