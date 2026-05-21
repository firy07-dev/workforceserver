const { DateTime } = require('luxon');

const getScheduleMode = (settings = {}) => (settings.scheduleMode === 'flexible' ? 'flexible' : 'shift');

const toSafeMinutes = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.round(parsed));
};

const getContractPercentage = (employee = {}) => {
  const parsed = Number(employee.contractPercentage);
  if (!Number.isFinite(parsed) || parsed <= 0) return 100;
  return Math.min(100, Math.max(1, Math.round(parsed)));
};

const getBaseDailyMinutes = (settings = {}) => toSafeMinutes(settings.dailyMinutes, 493);
const getBaseWeeklyMinutes = (settings = {}) => toSafeMinutes(settings.weeklyMinutes, 5 * 493);

const getEmployeeDailyTargetMinutes = (employee = {}, settings = {}, date = null) => {
  if (date) {
    const timezone = process.env.APP_TIMEZONE || 'Asia/Kolkata';
    const dt = typeof date === 'string' 
      ? DateTime.fromISO(date, { zone: timezone }) 
      : DateTime.fromJSDate(date).setZone(timezone);
      
    // 6 = Saturday, 7 = Sunday
    if (dt.weekday === 6 || dt.weekday === 7) {
      return 0;
    }
  }
  const baseDaily = getBaseDailyMinutes(settings);
  const percentage = getContractPercentage(employee);
  return Math.max(1, Math.round((baseDaily * percentage) / 100));
};

const getEmployeeWeeklyTargetMinutes = (employee = {}, settings = {}) => {
  const baseWeekly = getBaseWeeklyMinutes(settings);
  const percentage = getContractPercentage(employee);
  return Math.max(1, Math.round((baseWeekly * percentage) / 100));
};

const withMinutesOnDate = (baseDateTime, totalMinutes) => baseDateTime.startOf('day').plus({ minutes: totalMinutes });

const getBreakMinutes = ({ breaks = [], settings = {} }) => {
  let actualBreakMinutes = 0;
  breaks.forEach((b) => {
    if (b.start && b.end) {
      actualBreakMinutes += DateTime.fromJSDate(b.end).diff(DateTime.fromJSDate(b.start), 'minutes').minutes;
    }
  });

  const defaultLunchDeduction = toSafeMinutes(settings.lunchMinimumMinutes, 30);
  // If actualBreakMinutes is 0 (no log), use default.
  // If actualBreakMinutes is > 0 but < default, use default.
  return Math.max(actualBreakMinutes, defaultLunchDeduction);
};

const calculateAttendanceTotals = ({
  employee = {},
  settings = {},
  clockInTime,
  clockOutTime,
  breaks = [],
  breakMinutesOverride,
}) => {
  const scheduleMode = getScheduleMode(settings);
  const targetDailyMinutes = scheduleMode === 'flexible'
    ? getEmployeeDailyTargetMinutes(employee, settings, clockInTime)
    : getBaseDailyMinutes(settings);

  const breakMinutes = typeof breakMinutesOverride === 'number'
    ? Math.max(0, Math.round(breakMinutesOverride))
    : getBreakMinutes({ breaks, settings });
  const shiftStartTime = withMinutesOnDate(clockInTime, settings.clockInWindowStart || 0);
  const effectiveClockInTime = scheduleMode === 'shift' && clockInTime < shiftStartTime
    ? shiftStartTime
    : clockInTime;
  const duration = clockOutTime.diff(effectiveClockInTime, 'minutes').minutes;
  const workingMinutes = Math.max(0, Math.round(duration - breakMinutes));

  let overtime = 0;
  let shortHours = Math.max(0, targetDailyMinutes - workingMinutes);

  if (scheduleMode === 'flexible') {
    overtime = Math.max(0, workingMinutes - targetDailyMinutes);
    shortHours = Math.max(0, targetDailyMinutes - workingMinutes);
  } else {
    const overtimeGraceMinutes = toSafeMinutes(settings.overtimeGraceMinutes, 60);
    const overtimeThresholdTime = withMinutesOnDate(clockOutTime, (settings.clockOutEarliest || 0) + overtimeGraceMinutes);
    overtime = clockOutTime >= overtimeThresholdTime
      ? Math.max(0, Math.round(clockOutTime.diff(withMinutesOnDate(clockOutTime, settings.clockOutEarliest || 0), 'minutes').minutes))
      : 0;
  }

  return {
    scheduleMode,
    targetDailyMinutes,
    breakMinutes,
    workingMinutes,
    overtime,
    shortHours,
  };
};

module.exports = {
  getScheduleMode,
  getContractPercentage,
  getEmployeeDailyTargetMinutes,
  getEmployeeWeeklyTargetMinutes,
  withMinutesOnDate,
  calculateAttendanceTotals,
  getBreakMinutes,
};