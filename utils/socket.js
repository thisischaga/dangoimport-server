const { Server } = require('socket.io');
const Notification = require('../Models/Notification');

let io;

const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:5173',
        'https://www.dangoimport.com',
        'https://dangoimport.com',
        'https://dangoimport-admin.vercel.app',
      ],
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['polling', 'websocket'],
    allowEIO3: true,
    pingTimeout: 20000,
    pingInterval: 25000,
  });

  io.on('connection', (socket) => {
    // console.log(`[Socket] Nouveau client connecté: ${socket.id}`);

    // Rejoindre une salle spécifique
    socket.on('join', (room) => {
      socket.join(room);
      // console.log(`[Socket] Client ${socket.id} a rejoint la salle: ${room}`);
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
