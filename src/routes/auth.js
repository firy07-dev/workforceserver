const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

const uploadRoot = process.env.UPLOAD_ROOT || path.join(__dirname, '../../uploads');
const profilePhotoDir = path.join(uploadRoot, 'profile-photos');
fs.mkdirSync(profilePhotoDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, profilePhotoDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    cb(null, `${req.user._id}-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

const toSafeUser = (user) => {
  if (!user) return null;
  const safeUser = user.toObject ? user.toObject() : { ...user };
  delete safeUser.password;
  return safeUser;
};

const getSeedAdminConfig = () => ({
  name: process.env.ADMIN_SEED_NAME || 'System Admin',
  email: process.env.ADMIN_SEED_EMAIL,
  password: process.env.ADMIN_SEED_PASSWORD,
  employeeId: process.env.ADMIN_SEED_EMPLOYEE_ID || 'ADM001',
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, employeeId, identifier, password } = req.body;
    const rawIdentifier = identifier || email || employeeId;
    if (!rawIdentifier || !password) {
      return res.status(400).send({ error: 'Identifier and password are required' });
    }

    const normalizedIdentifier = rawIdentifier.trim();
    const query = normalizedIdentifier.includes('@')
      ? { email: normalizedIdentifier.toLowerCase() }
      : { employeeId: normalizedIdentifier };

    const user = await User.findOne(query);
    if (user && user.isActive === false) {
      return res.status(403).send({ error: 'This account has been deactivated' });
    }
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).send({ error: 'Invalid login credentials' });
    }
    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET);
    res.send({ user: toSafeUser(user), token });
  } catch (error) {
    res.status(400).send(error);
  }
});

router.get('/me', auth, async (req, res) => {
  res.send({ user: toSafeUser(req.user) });
});

router.patch('/profile', auth, async (req, res) => {
  try {
    const allowed = ['name', 'department', 'designation', 'profilePhoto'];
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) {
        req.user[field] = req.body[field];
      }
    });

    await req.user.save();
    res.send({ user: toSafeUser(req.user) });
  } catch (error) {
    res.status(400).send({ error: error.message || 'Failed to update profile' });
  }
});

router.post('/profile/photo', auth, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send({ error: 'Profile photo file is required' });
    }

    if (req.user.profilePhoto && req.user.profilePhoto.startsWith('/uploads/')) {
      const oldPath = path.join(uploadRoot, req.user.profilePhoto.replace(/^\/uploads\/?/, ''));
      fs.rm(oldPath, { force: true }, () => {});
    }

    req.user.profilePhoto = `/uploads/profile-photos/${req.file.filename}`;
    await req.user.save();

    res.send({ user: toSafeUser(req.user) });
  } catch (error) {
    res.status(400).send({ error: error.message || 'Failed to upload profile image' });
  }
});

router.post('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || String(newPassword).trim().length < 6) {
      return res.status(400).send({ error: 'New password must be at least 6 characters' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).send({ error: 'User not found' });
    }

    if (!user.mustChangePassword) {
      if (!currentPassword || !(await user.comparePassword(currentPassword))) {
        return res.status(400).send({ error: 'Current password is incorrect' });
      }
    }

    user.password = String(newPassword).trim();
    user.mustChangePassword = false;
    await user.save();

    res.send({ user: toSafeUser(user) });
  } catch (error) {
    res.status(400).send({ error: error.message || 'Failed to change password' });
  }
});

// Seed admin (Only if no users exist)
router.post('/seed-admin', async (req, res) => {
  try {
    const userCount = await User.countDocuments();
    if (userCount > 0) return res.status(400).send({ error: 'System already initialized' });

    const seedAdmin = getSeedAdminConfig();
    if (!seedAdmin.email || !seedAdmin.password) {
      return res.status(400).send({
        error: 'Admin seed is not configured. Set ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD in backend env.',
      });
    }

    const admin = new User({
      name: seedAdmin.name,
      email: seedAdmin.email.toLowerCase(),
      password: seedAdmin.password,
      role: 'admin',
      employeeId: seedAdmin.employeeId,
    });
    await admin.save();
    res.status(201).send({
      message: 'Admin created successfully',
      email: seedAdmin.email.toLowerCase(),
      employeeId: seedAdmin.employeeId,
    });
  } catch (error) {
    res.status(500).send(error);
  }
});

module.exports = router;
