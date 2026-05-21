const mongoose = require('mongoose');

const TimeBankEntrySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  effectiveDate: { type: String, required: true }, // YYYY-MM-DD in business timezone
  sourceType: {
    type: String,
    enum: ['attendance', 'manual-adjustment', 'leave', 'holiday', 'carry-forward', 'absence', 'payout'],
    required: true,
  },
  sourceId: { type: String, required: true },
  entryType: {
    type: String,
    enum: ['credit', 'debit', 'adjustment'],
    required: true,
  },
  deltaMinutes: { type: Number, required: true }, // signed minutes
  note: { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true });

TimeBankEntrySchema.index({ userId: 1, sourceType: 1, sourceId: 1 }, { unique: true });
TimeBankEntrySchema.index({ userId: 1, effectiveDate: -1, createdAt: -1 });

module.exports = mongoose.model('TimeBankEntry', TimeBankEntrySchema);
