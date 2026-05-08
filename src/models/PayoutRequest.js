const mongoose = require('mongoose');

const PayoutRequestSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amountMinutes: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  reason: String,
  adminComment: String,
  balanceAtRequest: Number, // Balance at the time of request for reference
  processedAt: Date,
  processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('PayoutRequest', PayoutRequestSchema);
