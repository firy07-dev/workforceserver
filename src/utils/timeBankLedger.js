const TimeBankEntry = require('../models/TimeBankEntry');
const { getEmployeeDailyTargetMinutes, getScheduleMode } = require('./attendancePolicy');
const { DateTime } = require('luxon');

const toSafeDelta = (value) => Math.round(Number(value) || 0);

const syncAttendanceLedgerEntry = async ({
  attendance,
  employee,
  settings,
  createdBy,
}) => {
  if (!attendance || !employee || !settings) return null;
  if (getScheduleMode(settings) !== 'flexible') return null;

  const targetMinutes = getEmployeeDailyTargetMinutes(employee, settings, attendance.date);
  const workedMinutes = toSafeDelta(attendance.totalHours);
  const deltaMinutes = workedMinutes - targetMinutes;
  const entryType = deltaMinutes >= 0 ? 'credit' : 'debit';

  return TimeBankEntry.findOneAndUpdate(
    {
      userId: employee._id,
      sourceType: 'attendance',
      sourceId: String(attendance._id),
    },
    {
      userId: employee._id,
      effectiveDate: attendance.date,
      sourceType: 'attendance',
      sourceId: String(attendance._id),
      entryType,
      deltaMinutes,
      note: `Attendance settlement for ${attendance.date}`,
      createdBy,
      metadata: {
        attendanceId: String(attendance._id),
        workedMinutes,
        targetMinutes,
        overtimeMinutes: Math.max(0, deltaMinutes),
        shortHoursMinutes: Math.max(0, -deltaMinutes),
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
};

const createManualAdjustmentEntry = async ({
  userId,
  effectiveDate,
  deltaMinutes,
  note,
  createdBy,
  sourceId,
  metadata = null,
}) => {
  const safeDelta = toSafeDelta(deltaMinutes);
  return TimeBankEntry.findOneAndUpdate(
    {
      userId,
      sourceType: 'manual-adjustment',
      sourceId,
    },
    {
      userId,
      effectiveDate,
      sourceType: 'manual-adjustment',
      sourceId,
      entryType: 'adjustment',
      deltaMinutes: safeDelta,
      note: note || 'Manual time bank adjustment',
      createdBy,
      metadata,
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
};

const syncHolidayLedgerEntry = async ({
  holiday,
  employee,
  settings,
  createdBy,
}) => {
  if (!holiday || !employee || !settings) return null;
  
  const targetMinutes = getEmployeeDailyTargetMinutes(employee, settings);
  
  return TimeBankEntry.findOneAndUpdate(
    {
      userId: employee._id,
      sourceType: 'holiday',
      sourceId: String(holiday._id),
    },
    {
      userId: employee._id,
      effectiveDate: holiday.date,
      sourceType: 'holiday',
      sourceId: String(holiday._id),
      entryType: 'credit',
      deltaMinutes: targetMinutes,
      note: `Holiday credit: ${holiday.name}`,
      createdBy,
      metadata: {
        holidayId: String(holiday._id),
        holidayName: holiday.name,
        targetMinutes,
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
};

const getTimeBankBalance = async (userId) => {
  const agg = await TimeBankEntry.aggregate([
    { $match: { userId } },
    { $group: { _id: '$userId', balanceMinutes: { $sum: '$deltaMinutes' } } },
  ]);
  return agg[0]?.balanceMinutes || 0;
};

const getTimeBankEntries = async (userId, limit = 50) => TimeBankEntry.find({ userId })
  .sort({ effectiveDate: -1, createdAt: -1 })
  .limit(limit);

const syncLeaveLedgerEntry = async ({
  leave,
  employee,
  settings,
  createdBy,
}) => {
  if (!leave || !employee || !settings) return null;
  if (leave.type !== 'compOff' || leave.status !== 'approved') {
    // If leave was previously synced but now cancelled/rejected, remove the entry
    return TimeBankEntry.deleteMany({
      userId: employee._id,
      sourceType: 'leave',
      sourceId: String(leave._id),
    });
  }

  // Calculate total debit (target minutes for each day in leave range)
  const start = DateTime.fromJSDate(leave.startDate).startOf('day');
  const end = DateTime.fromJSDate(leave.endDate).startOf('day');
  let totalDebit = 0;
  let cursor = start;
  while (cursor <= end) {
    const target = getEmployeeDailyTargetMinutes(employee, settings, cursor.toISODate());
    totalDebit += target;
    cursor = cursor.plus({ days: 1 });
  }

  return TimeBankEntry.findOneAndUpdate(
    {
      userId: employee._id,
      sourceType: 'leave',
      sourceId: String(leave._id),
    },
    {
      userId: employee._id,
      effectiveDate: leave.startDate,
      sourceType: 'leave',
      sourceId: String(leave._id),
      entryType: 'debit',
      deltaMinutes: -totalDebit,
      note: `Day off in lieu (CompOff): ${leave.reason || 'No reason provided'}`,
      createdBy,
      metadata: {
        leaveId: String(leave._id),
        leaveType: leave.type,
        totalDays: leave.totalDays,
        totalDebitMinutes: totalDebit,
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
};

const syncPayoutLedgerEntry = async ({
  payoutRequest,
  employee,
  createdBy,
}) => {
  if (!payoutRequest || !employee) return null;
  
  if (payoutRequest.status !== 'approved') {
    // If payout was previously synced but now cancelled/rejected, remove the entry
    return TimeBankEntry.deleteMany({
      userId: employee._id,
      sourceType: 'payout',
      sourceId: String(payoutRequest._id),
    });
  }

  return TimeBankEntry.findOneAndUpdate(
    {
      userId: employee._id,
      sourceType: 'payout',
      sourceId: String(payoutRequest._id),
    },
    {
      userId: employee._id,
      effectiveDate: payoutRequest.createdAt,
      sourceType: 'payout',
      sourceId: String(payoutRequest._id),
      entryType: 'debit',
      deltaMinutes: -Math.abs(payoutRequest.amountMinutes),
      note: `Extra work payout: ${payoutRequest.reason || 'Requested by employee'}`,
      createdBy,
      metadata: {
        payoutId: String(payoutRequest._id),
        amountMinutes: payoutRequest.amountMinutes,
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
};

const syncTimeBankForAbsence = async ({ employee, date, targetMinutes }) => {
  if (!employee || !date || !targetMinutes) return null;

  const deltaMinutes = -Math.abs(targetMinutes);
  const sourceId = `absence-${date}`;
  return TimeBankEntry.findOneAndUpdate(
    {
      userId: employee._id,
      sourceType: 'absence',
      sourceId: sourceId,
    },
    {
      userId: employee._id,
      effectiveDate: date,
      sourceType: 'absence',
      sourceId: sourceId,
      entryType: 'debit',
      deltaMinutes,
      note: `Unexcused absence on ${date}`,
      metadata: {
        targetMinutes,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

module.exports = {
  syncAttendanceLedgerEntry,
  createManualAdjustmentEntry,
  getTimeBankBalance,
  getTimeBankEntries,
  syncHolidayLedgerEntry,
  syncLeaveLedgerEntry,
  syncPayoutLedgerEntry,
  syncTimeBankForAbsence,
};