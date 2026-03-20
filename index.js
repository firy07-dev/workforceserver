require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const http = require('http');

const authRoutes = require('./src/routes/auth');
const attendanceRoutes = require('./src/routes/attendance');
const leaveRoutes = require('./src/routes/leave');
const adminRoutes = require('./src/routes/admin');
const notificationRoutes = require('./src/routes/notifications');
const { initRealtime } = require('./src/utils/realtime');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5001;
const MONGODB_URL = process.env.MONGODB_URL;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/leave', leaveRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);

async function startServer() {
  if (!MONGODB_URL) {
    console.error('Startup error: MONGODB_URL is missing in backend/.env');
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGODB_URL, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });

    console.log('Connected to MongoDB');
    initRealtime(server);

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
}

startServer();
