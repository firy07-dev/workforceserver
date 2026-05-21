const User = require('../models/User');
const Attendance = require('../models/Attendance');
const LeaveRequest = require('../models/LeaveRequest');
const Holiday = require('../models/Holiday');
const { syncTimeBankForAbsence } = require('../utils/timeBankLedger');
const { getEmployeeDailyTargetMinutes } = require('../utils/attendancePolicy');
const Setting = require('../models/Setting');
const { DateTime } = require('luxon');
const BUSINESS_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';

/**
 * @description This job runs daily to find employees who were absent without approved leave
 * and creates a debit entry in their time bank for the missed hours.
 */
const settleDailyAbsences = async () => {
  const log = [];
  console.log('Starting daily absence settlement job...');

  const today = DateTime.now().setZone(BUSINESS_TIMEZONE).startOf('day');
  const yesterday = today.minus({ days: 1 });
  const date = yesterday.toISODate();

  try {
    const settings = await Setting.findOne();
    if (!settings || settings.scheduleMode !== 'flexible') {
      log.push('Time bank is not enabled. Skipping absence settlement.');
      return log;
    }

    const holiday = await Holiday.findOne({ date });
    if (holiday) {
      log.push(`Skipping job because ${date} was a public holiday: ${holiday.name}`);
      return log;
    }

    const activeEmployees = await User.find({
      role: 'employee',
      isActive: { $ne: false },
    });
    log.push(`Found ${activeEmployees.length} active employees for ${date}.`);

    for (const employee of activeEmployees) {
      const attendanceRecord = await Attendance.findOne({ userId: employee._id, date });
      if (attendanceRecord) {
        // Employee has an attendance record, so they were not absent.
        continue;
      }

      const yesterdayDate = yesterday.toJSDate();
      const leaveRecord = await LeaveRequest.findOne({
        userId: employee._id,
        status: 'approved',
        startDate: { $lte: yesterdayDate },
        endDate: { $gte: yesterdayDate },
      });

      if (leaveRecord) {
        // Employee was on approved leave.
        continue;
      }

      // If we reach here, the employee was absent without approved leave.
      console.log(`Employee ${employee.name} was absent on ${date}. Creating time bank debit.`);
      
      const targetMinutes = getEmployeeDailyTargetMinutes(employee, settings, date);
      if (targetMinutes <= 0) {
        log.push(`Skipping ${employee.name} on ${date}: no target minutes.`);
        continue;
      }

      await syncTimeBankForAbsence({
        employee,
        date,
        targetMinutes,
      });
      log.push(`Debited ${employee.name} ${targetMinutes} minutes for ${date}.`);
    }

    console.log('Daily absence settlement job finished successfully.');
    return log;
  } catch (error) {
    console.error('Error running daily absence settlement job:', error);
    log.push(`Error: ${error.message}`);
    return log;
  }
};

module.exports = {
  settleDailyAbsences,
};
