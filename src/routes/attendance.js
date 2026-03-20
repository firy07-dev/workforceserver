const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Attendance = require('../models/Attendance');
const Setting = require('../models/Setting');
const { DateTime } = require('luxon');
const { notifyAdmins } = require('../utils/pushNotifications');
const { emitToAdmins, emitToUser } = require('../utils/realtime');

const BUSINESS_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';
const nowInBusinessZone = () => DateTime.now().setZone(BUSINESS_TIMEZONE);

const ensureSettings = async () => {
  let settings = await Setting.findOne();
  if (!settings) {
    settings = await Setting.create({});
  }
  return settings;
};

const toMinutes = (dt) => dt.hour * 60 + dt.minute;
const toClockLabel = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};
const isWithinWindow = (currentMinutes, startMinutes, endMinutes) => {
  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
};

const getDistanceMeters = (lat1, lon1, lat2, lon2) => {
  const toRad = (value) => (value * Math.PI) / 180;
  const R = 6371e3; // meters
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2)
    + Math.cos(φ1) * Math.cos(φ2)
    * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
};

const withinRadius = (location, settings) => {
  if (
    typeof settings.locationLatitude !== 'number'
    || typeof settings.locationLongitude !== 'number'
    || typeof settings.locationRadius !== 'number'
  ) {
    return true;
  }
  return getDistanceMeters(
    settings.locationLatitude,
    settings.locationLongitude,
    location.latitude,
    location.longitude
  ) <= settings.locationRadius;
};

// Get current status
router.get('/status', auth, async (req, res) => {
  const today = nowInBusinessZone().toFormat('yyyy-MM-dd');
  const record = await Attendance.findOne({ userId: req.user._id, date: today });
  res.send(record || { status: 'none' });
});

router.get('/config', auth, async (req, res) => {
  const settings = await ensureSettings();
  res.send({
    attendanceMode: settings.attendanceMode,
    dailyMinutes: settings.dailyMinutes,
    weeklyMinutes: settings.weeklyMinutes,
    clockInWindowStart: settings.clockInWindowStart,
    clockInWindowEnd: settings.clockInWindowEnd,
    clockOutEarliest: settings.clockOutEarliest,
    lunchBreakStart: settings.lunchBreakStart,
    lunchBreakEnd: settings.lunchBreakEnd,
    lunchMinimumMinutes: settings.lunchMinimumMinutes,
  });
});

// Clock In
router.post('/clock-in', auth, async (req, res) => {
  try {
    const now = nowInBusinessZone();
    const settings = await ensureSettings();

    const currentMinutes = toMinutes(now);
    if (!isWithinWindow(currentMinutes, settings.clockInWindowStart, settings.clockInWindowEnd)) {
      return res.status(400).send({
        error: `Clock-in is allowed only between ${toClockLabel(settings.clockInWindowStart)} and ${toClockLabel(settings.clockInWindowEnd)}`,
      });
    }

    const today = now.toFormat('yyyy-MM-dd');
    let record = await Attendance.findOne({ userId: req.user._id, date: today });
    if (record) return res.status(400).send({ error: 'Already clocked in today' });

    if (!req.body.location?.latitude || !req.body.location?.longitude) {
      return res.status(400).send({ error: 'Location is required for clock-in' });
    }

    if (settings.attendanceMode === 'selfie' && !req.body.photo) {
      return res.status(400).send({ error: 'Photo proof is required for clock-in' });
    }

    if (settings.attendanceMode === 'qr') {
      if (!settings.qrCodeValue) {
        return res.status(400).send({ error: 'QR attendance is not configured yet' });
      }
      if (!req.body.qrCodeValue) {
        return res.status(400).send({ error: 'QR scan is required for clock-in' });
      }
      if (req.body.qrCodeValue !== settings.qrCodeValue) {
        return res.status(400).send({ error: 'Invalid office QR code' });
      }
    }

    if (!withinRadius(req.body.location, settings)) {
      return res.status(400).send({ error: 'Please clock in from the registered workplace location' });
    }

    record = new Attendance({
      userId: req.user._id,
      date: today,
      clockIn: {
        time: now.toJSDate(),
        location: req.body.location,
        photo: req.body.photo
      },
      photoCaptured: settings.attendanceMode === 'selfie',
      locationVerified: true,
      verificationMethod: settings.attendanceMode,
      qrVerified: settings.attendanceMode === 'qr',
      deviceId: req.body.deviceId || '',
      deviceName: req.body.deviceName || '',
      verificationStatus: 'verified'
    });

    await record.save();

    const lateByMinutes = currentMinutes - settings.clockInWindowStart;
    if (lateByMinutes > 5) {
      try {
        await notifyAdmins({
          title: 'Late clock-in alert',
          body: `${req.user.name} (${req.user.employeeId}) clocked in ${lateByMinutes} minutes late at ${now.toFormat('hh:mm a')}.`,
          type: 'alert',
          refModel: 'Attendance',
          refId: record._id,
          data: {
            route: '/(admin)/attendance_records',
            attendanceId: String(record._id),
            employeeId: req.user.employeeId,
          },
        });
      } catch (pushError) {
        console.error('Late clock-in notification failed:', pushError);
      }
    }

    emitToUser(req.user._id, 'attendance:updated', {
      action: 'clock-in',
      attendanceId: String(record._id),
      date: today,
    });
    emitToAdmins('attendance:updated', {
      action: 'clock-in',
      attendanceId: String(record._id),
      userId: String(req.user._id),
      date: today,
    });
    emitToAdmins('dashboard:refresh', { reason: 'clock-in' });

    res.status(201).send(record);
  } catch (error) {
    console.error('Clock-in error:', error);
    res.status(400).send({ error: error.message || 'Failed to clock in' });
  }
});

// Clock Out
router.post('/clock-out', auth, async (req, res) => {
  try {
    const now = nowInBusinessZone();
    const settings = await ensureSettings();

    const today = now.toFormat('yyyy-MM-dd');
    const record = await Attendance.findOne({ userId: req.user._id, date: today });
    if (!record) return res.status(400).send({ error: 'No clock-in record found for today' });
    if (record.clockOut.time) return res.status(400).send({ error: 'Already clocked out' });

    const currentMinutes = toMinutes(now);
    if (currentMinutes < settings.clockOutEarliest && !record.emergencyLeaveApproved) {
      return res.status(400).send({ error: 'Clock-out is allowed only after the configured end of day' });
    }

    if (record.breaks.some(b => b.start && !b.end)) {
      return res.status(400).send({ error: 'Please end the active break before clocking out' });
    }

    if (!req.body.location?.latitude || !req.body.location?.longitude) {
      return res.status(400).send({ error: 'Location is required for clock-out' });
    }

    record.clockOut = {
      time: now.toJSDate(),
      location: req.body.location
    };

    // Calculate total hours
    const clockInTime = DateTime.fromJSDate(record.clockIn.time);
    const clockOutTime = now;
    const duration = clockOutTime.diff(clockInTime, 'minutes').minutes;

    // Subtract breaks; default to the configured lunch minimum (30 min) when no break is recorded
    let actualBreakMinutes = 0;
    record.breaks.forEach(b => {
      if (b.start && b.end) {
        actualBreakMinutes += DateTime.fromJSDate(b.end).diff(DateTime.fromJSDate(b.start), 'minutes').minutes;
      }
    });
    const defaultLunchDeduction = settings.lunchMinimumMinutes || 30;
    const breakMinutes = actualBreakMinutes > 0 ? actualBreakMinutes : defaultLunchDeduction;
    
    const workingMinutes = Math.max(0, duration - breakMinutes);
    record.totalHours = workingMinutes;

    // Overtime: Standard is 8h 13m = 493 minutes
    const standardMinutes = settings.dailyMinutes || 493;
    if (workingMinutes > standardMinutes) {
      record.overtime = workingMinutes - standardMinutes;
    }

    await record.save();
    emitToUser(req.user._id, 'attendance:updated', {
      action: 'clock-out',
      attendanceId: String(record._id),
      date: today,
    });
    emitToAdmins('attendance:updated', {
      action: 'clock-out',
      attendanceId: String(record._id),
      userId: String(req.user._id),
      date: today,
    });
    emitToAdmins('dashboard:refresh', { reason: 'clock-out' });
    res.send(record);
  } catch (error) {
    console.error('Clock-out error:', error);
    res.status(400).send({ error: error.message || 'Failed to clock out' });
  }
});

// History
router.get('/history', auth, async (req, res) => {
  const history = await Attendance.find({ userId: req.user._id }).sort({ date: -1 });
  res.send(history);
});

// Start lunch break
router.post('/break/start', auth, async (req, res) => {
  try {
    const now = nowInBusinessZone();
    const settings = await ensureSettings();
    const today = now.toFormat('yyyy-MM-dd');
    const currentMinutes = toMinutes(now);

    if (currentMinutes < settings.lunchBreakStart || currentMinutes > settings.lunchBreakEnd) {
      return res.status(400).send({ error: 'Break can only start during the configured lunch window' });
    }

    const record = await Attendance.findOne({ userId: req.user._id, date: today });
    if (!record) return res.status(400).send({ error: 'No attendance record found for today' });
    if (!record.clockIn.time) return res.status(400).send({ error: 'Clock in before taking a break' });
    if (record.breaks.some(b => b.start && !b.end)) {
      return res.status(400).send({ error: 'A break is already in progress' });
    }

    if (!req.body.location?.latitude || !req.body.location?.longitude) {
      return res.status(400).send({ error: 'Location is required for break start' });
    }

    record.breaks.push({
      start: now.toJSDate(),
      location: req.body.location
    });
    record.status = 'on-break';
    await record.save();
    emitToUser(req.user._id, 'attendance:updated', {
      action: 'break-start',
      attendanceId: String(record._id),
      date: today,
    });
    emitToAdmins('attendance:updated', {
      action: 'break-start',
      attendanceId: String(record._id),
      userId: String(req.user._id),
      date: today,
    });
    res.send(record);
  } catch (error) {
    console.error('Break start error:', error);
    res.status(400).send({ error: error.message || 'Failed to start break' });
  }
});

// End lunch break
router.post('/break/end', auth, async (req, res) => {
  try {
    const now = nowInBusinessZone();
    const settings = await ensureSettings();
    const today = now.toFormat('yyyy-MM-dd');
    const record = await Attendance.findOne({ userId: req.user._id, date: today });
    if (!record) return res.status(400).send({ error: 'No attendance record found for today' });

    const activeBreak = record.breaks.find(b => b.start && !b.end);
    if (!activeBreak) {
      return res.status(400).send({ error: 'No active break to stop' });
    }

    const breakStart = DateTime.fromJSDate(activeBreak.start);
    const duration = now.diff(breakStart, 'minutes').minutes;
    if (duration < settings.lunchMinimumMinutes) {
      return res.status(400).send({ error: 'Break must be at least the minimum configured duration' });
    }

    if (!req.body.location?.latitude || !req.body.location?.longitude) {
      return res.status(400).send({ error: 'Location is required for break end' });
    }

    activeBreak.end = now.toJSDate();
    activeBreak.endLocation = req.body.location;
    record.status = 'present';
    await record.save();
    emitToUser(req.user._id, 'attendance:updated', {
      action: 'break-end',
      attendanceId: String(record._id),
      date: today,
    });
    emitToAdmins('attendance:updated', {
      action: 'break-end',
      attendanceId: String(record._id),
      userId: String(req.user._id),
      date: today,
    });
    res.send(record);
  } catch (error) {
    console.error('Break end error:', error);
    res.status(400).send({ error: error.message || 'Failed to end break' });
  }
});

module.exports = router;
