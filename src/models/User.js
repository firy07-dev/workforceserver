const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const LeaveBalanceSchema = new mongoose.Schema({
  total: { type: Number, default: 0 },
  used: { type: Number, default: 0 },
}, { _id: false });

const PrimaryDeviceSchema = new mongoose.Schema({
  deviceId: { type: String, default: '' },
  deviceName: { type: String, default: '' },
  assignedAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
}, { _id: false });

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'employee'], default: 'employee' },
  employeeId: { type: String, unique: true, required: true },
  department: String,
  designation: String,
  joinDate: { type: Date, default: Date.now },
  profilePhoto: String,
  leaveBalances: {
    vacation: { type: LeaveBalanceSchema, default: () => ({ total: 0, used: 0 }) },
    sick: { type: LeaveBalanceSchema, default: () => ({ total: 0, used: 0 }) },
    compOff: { type: LeaveBalanceSchema, default: () => ({ total: 0, used: 0 }) },
  },
  primaryDevice: { type: PrimaryDeviceSchema, default: null },
  pushTokens: [{
    token: { type: String, required: true },
    platform: { type: String, enum: ['ios', 'android', 'web'], default: 'android' },
    deviceName: String,
    projectId: String,
    updatedAt: { type: Date, default: Date.now },
  }],
  isActive: { type: Boolean, default: true },
  mustChangePassword: { type: Boolean, default: false }
}, { timestamps: true });

UserSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
});

UserSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);
