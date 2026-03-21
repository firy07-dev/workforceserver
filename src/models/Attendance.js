const mongoose = require('mongoose');

const AttendanceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: String, required: true }, // Format: YYYY-MM-DD
  clockIn: {
    time: Date,
    location: {
      latitude: Number,
      longitude: Number,
      address: String
    },
    photo: String // Cloudinary URL or local path
  },
  clockOut: {
    time: Date,
    location: {
      latitude: Number,
      longitude: Number,
      address: String
    }
  },
  photoCaptured: { type: Boolean, default: false },
  locationVerified: { type: Boolean, default: false },
  verificationMethod: { type: String, enum: ['selfie', 'qr'], default: 'selfie' },
  qrVerified: { type: Boolean, default: false },
  deviceId: { type: String, default: '' },
  deviceName: { type: String, default: '' },
  deviceMismatch: { type: Boolean, default: false },
  verificationStatus: { type: String, enum: ['pending', 'verified', 'failed'], default: 'pending' },
  breaks: [{
    start: Date,
    end: Date,
    location: {
      latitude: Number,
      longitude: Number,
      address: String
    },
    endLocation: {
      latitude: Number,
      longitude: Number,
      address: String
    }
  }],
  totalHours: { type: Number, default: 0 }, // In minutes
  overtime: { type: Number, default: 0 }, // In minutes
  shortHours: { type: Number, default: 0 }, // In minutes
  shortHoursReason: { type: String, default: '' },
  status: { type: String, enum: ['present', 'absent', 'on-leave', 'half-day', 'on-break'], default: 'present' },
  isEdited: { type: Boolean, default: false },
  modifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  emergencyLeaveApproved: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('Attendance', AttendanceSchema);
