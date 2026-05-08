const mongoose = require('mongoose');

const HolidaySchema = new mongoose.Schema({
  name: { type: String, required: true },
  date: { type: String, required: true, unique: true }, // Format: YYYY-MM-DD
  description: String,
  isRecurring: { type: Boolean, default: false }, // If it repeats every year on same day/month
}, { timestamps: true });

module.exports = mongoose.model('Holiday', HolidaySchema);
