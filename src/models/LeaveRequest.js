const mongoose = require('mongoose');

const LeaveRequestSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['vacation', 'sick', 'emergency', 'other'], required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  reason: { type: String, required: true },
  isEmergency: { type: Boolean, default: false },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  adminComment: String,
  totalDays: Number
}, { timestamps: true });

module.exports = mongoose.model('LeaveRequest', LeaveRequestSchema);
