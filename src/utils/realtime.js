const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

let io;

const initRealtime = (server) => {
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  io.use(async (socket, next) => {
    console.log('[Socket] Connection attempt from:', socket.id);
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        console.error('[Socket] Authentication token missing');
        return next(new Error('Authentication token missing'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findOne({ _id: decoded.id, isActive: true });
      if (!user) {
        console.error('[Socket] Authentication failed: User not found or inactive');
        return next(new Error('Authentication failed'));
      }

      socket.user = user;
      next();
    } catch (error) {
      console.error('[Socket] Authentication error:', error.message);
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    console.log(`[Socket] User connected: ${user.name} (${user._id})`);
    
    socket.join(`user:${String(user._id)}`);

    if (user.role === 'admin') {
      socket.join('admins');
      console.log(`[Socket] User joined admins room`);
    } else {
      socket.join('employees');
      console.log(`[Socket] User joined employees room`);
    }
    
    socket.on('disconnect', (reason) => {
      console.log(`[Socket] User disconnected: ${user.name} (${user._id}), reason: ${reason}`);
    });
  });

  return io;
};

const getIO = () => io;

const emitToUser = (userId, event, payload) => {
  if (!io || !userId) return;
  io.to(`user:${String(userId)}`).emit(event, payload);
};

const emitToAdmins = (event, payload) => {
  if (!io) return;
  io.to('admins').emit(event, payload);
};

const emitToEmployees = (event, payload) => {
  if (!io) return;
  io.to('employees').emit(event, payload);
};

module.exports = {
  initRealtime,
  getIO,
  emitToUser,
  emitToAdmins,
  emitToEmployees,
};
