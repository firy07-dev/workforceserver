const mongoose = require('mongoose');

const SettingSchema = new mongoose.Schema({
  dailyMinutes: { type: Number, default: 493 }, // 8h13m
  weeklyMinutes: { type: Number, default: 5 * 493 },
  vacationLeaveTotal: { type: Number, default: 12 },
  sickLeaveTotal: { type: Number, default: 6 },
  compOffTotal: { type: Number, default: 0 },
  attendanceMode: { type: String, enum: ['selfie', 'qr'], default: 'selfie' },
  qrCodeValue: { type: String, default: '' },
  clockInWindowStart: { type: Number, default: 6 * 60 },
  clockInWindowEnd: { type: Number, default: 10 * 60 },
  clockOutEarliest: { type: Number, default: 15 * 60 },
  overtimeGraceMinutes: { type: Number, default: 60 },
  lunchBreakStart: { type: Number, default: 11 * 60 + 30 },
  lunchBreakEnd: { type: Number, default: 12 * 60 + 30 },
  lunchMinimumMinutes: { type: Number, default: 30 },
  locationLatitude: Number,
  locationLongitude: Number,
  locationRadius: { type: Number, default: 500 }, // meters
  locationName: String,
  locationAddress: String,
}, { timestamps: true });

module.exports = mongoose.model('Setting', SettingSchema);
