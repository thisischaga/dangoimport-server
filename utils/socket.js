const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const Admin = require('../Models/Admin');
const User = require('../Models/User');
const Notification = require('../Models/Notification');

let io;

const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const allowed = [
          'http://localhost:3000',
          'http://localhost:3001',
          'http://localhost:5173',
          'http://localhost:5174',
          'http://127.0.0.1:5173',
          'http://127.0.0.1:5174',
          'https://www.dangoimport.com',
          'https://dangoimport.com',
          'https://marketplace.dangoimport.com',
          'https://business.dangoimport.com',
          'https://dangoimport-admin.vercel.app',
          'https://dangoimport-admin-eiim.vercel.app',
        ];
        if (allowed.includes(origin) || origin.endsWith('.dangoimport.com')) {
          return callback(null, true);
        }
        return callback(null, true); // Fallback allow to prevent CORS block on socket polling
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
    // console.log(`[Socket] Nouveau client connecté: ${socket.id}`);

    // Si le client fournit un token via handshake.auth.token, vérifier et auto-join
    try {
      const token = socket.handshake?.auth?.token;
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.userId || decoded.id;

        // Chercher dans Admin si rôle admin-like
        if (['admin', 'dev-admin', 'superadmin', 'manager'].includes(decoded.role)) {
          Admin.findById(userId).select('-adminPassword').then((admin) => {
            if (admin) {
              socket.user = { ...decoded, id: admin._id, role: admin.role || decoded.role };
              socket.join(`user_${admin._id}`);
              socket.join('admin');
            }
          }).catch(() => {});
        } else {
          // Chercher dans User
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
      // Si token invalide, on n'empêche pas la connexion mais on logue
      // console.warn('[Socket] Token socket invalide ou expiré:', err?.message || err);
    }

    // Endpoint d'authentification post-connexion (fallback si token non fourni en handshake)
    socket.on('authenticate', async (payload) => {
      const token = (payload && payload.token) || null;
      if (!token) {
        socket.emit('unauthorized', { message: 'Aucun token fourni' });
        if (process.env.SOCKET_STRICT_AUTH === 'true') return socket.disconnect(true);
        return;
      }

      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
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
        if (process.env.SOCKET_STRICT_AUTH === 'true') socket.disconnect(true);
      } catch (error) {
        socket.emit('unauthorized', { message: error?.message || 'Token invalide' });
        if (process.env.SOCKET_STRICT_AUTH === 'true') socket.disconnect(true);
      }
    });

    // Rejoindre une salle spécifique
    socket.on('join', (room) => {
      socket.join(room);
      // console.log(`[Socket] Client ${socket.id} a rejoint la salle: ${room}`);
    });

    socket.on('join_user', (userId) => {
      if (!userId) return;
      socket.join(`user_${userId}`);
    });

    // Join driver-specific room
    socket.on('join_driver', (driverId) => {
      if (!driverId) return;
      socket.join(`driver_${driverId}`);
    });

    // Join order-specific room
    socket.on('join_order', (orderId) => {
      if (!orderId) return;
      socket.join(`order_${orderId}`);
    });

    socket.on('disconnect', () => {
      // console.log(`[Socket] Client déconnecté: ${socket.id}`);
    });
  });

  return io;
};

const sendNotification = async ({ recipient, type, title, message, link, sender = 'System' }) => {
  try {
    // 1. Persister en base de données
    const newNotif = new Notification({
      recipient,
      type,
      title,
      message,
      link,
      sender
    });
    await newNotif.save();

    // 2. Émettre via Socket.io
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
