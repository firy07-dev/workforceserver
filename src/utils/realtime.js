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
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        return next(new Error('Authentication token missing'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findOne({ _id: decoded.id, isActive: true });
      if (!user) {
        return next(new Error('Authentication failed'));
      }

      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    socket.join(`user:${String(user._id)}`);

    if (user.role === 'admin') {
      socket.join('admins');
    } else {
      socket.join('employees');
    }
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
