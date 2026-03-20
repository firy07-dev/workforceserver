const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: {
    type: String,
    enum: ['policy', 'overtime', 'leave', 'alert'],
    required: true,
  },
  title: { type: String, required: true },
  body: { type: String, required: true },
  read: { type: Boolean, default: false },
  // optional reference to source record
  refModel: { type: String, enum: ['Attendance', 'LeaveRequest'], default: null },
  refId: { type: mongoose.Schema.Types.ObjectId, default: null },
  data: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Notification', NotificationSchema);
