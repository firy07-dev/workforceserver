const express = require('express');
const router = express.Router();
const { auth, admin } = require('../middleware/auth');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const LeaveRequest = require('../models/LeaveRequest');
const Setting = require('../models/Setting');
const { DateTime } = require('luxon');
const { notifyUserById } = require('../utils/pushNotifications');
const { emitToAdmins, emitToUser } = require('../utils/realtime');

const BUSINESS_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';
const nowInBusinessZone = () => DateTime.now().setZone(BUSINESS_TIMEZONE);

const buildRecentActivity = async () => {
  const [attendanceRecords, leaveRequests] = await Promise.all([
    Attendance.find({})
      .populate('userId', 'name employeeId')
      .sort({ updatedAt: -1 })
      .limit(20),
    LeaveRequest.find({})
      .populate('userId', 'name employeeId')
      .sort({ updatedAt: -1 })
      .limit(20),
  ]);

  const attendanceEvents = attendanceRecords.flatMap((record) => {
    const events = [];
    if (record.clockIn?.time) {
      events.push({
        id: `clock-in-${record._id}`,
        type: 'clock-in',
        actorName: record.userId?.name || 'Unknown',
        actorEmployeeId: record.userId?.employeeId || '',
        timestamp: record.clockIn.time,
        description: `${record.userId?.name || 'Unknown'} clocked in`,
        meta: record.verificationMethod === 'qr' ? 'QR' : 'Selfie',
      });
    }
    if (record.clockOut?.time) {
      events.push({
        id: `clock-out-${record._id}`,
        type: 'clock-out',
        actorName: record.userId?.name || 'Unknown',
        actorEmployeeId: record.userId?.employeeId || '',
        timestamp: record.clockOut.time,
        description: `${record.userId?.name || 'Unknown'} clocked out`,
        meta: record.totalHours ? `${record.totalHours} min worked` : '',
      });
    }
    return events;
  });

  const leaveEvents = leaveRequests.flatMap((leave) => {
    const createdEvent = {
      id: `leave-created-${leave._id}`,
      type: 'leave-request',
      actorName: leave.userId?.name || 'Unknown',
      actorEmployeeId: leave.userId?.employeeId || '',
      timestamp: leave.createdAt,
      description: `${leave.userId?.name || 'Unknown'} submitted a ${leave.type} leave request`,
      meta: leave.status,
    };

    const statusChanged = leave.status !== 'pending' && leave.updatedAt && leave.updatedAt.getTime() !== leave.createdAt.getTime();
    const decisionEvent = statusChanged
      ? [{
          id: `leave-decision-${leave._id}`,
          type: leave.status === 'approved' ? 'leave-approved' : 'leave-rejected',
          actorName: leave.userId?.name || 'Unknown',
          actorEmployeeId: leave.userId?.employeeId || '',
          timestamp: leave.updatedAt,
          description: `${leave.userId?.name || 'Unknown'}'s ${leave.type} leave was ${leave.status}`,
          meta: leave.adminComment || '',
        }]
      : [];

    return [createdEvent, ...decisionEvent];
  });

  return [...attendanceEvents, ...leaveEvents]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10)
    .map((event) => ({
      ...event,
      timestamp: event.timestamp,
    }));
};

const ensureSettings = async () => {
  let settings = await Setting.findOne();
  if (!settings) {
    settings = await Setting.create({});
  }
  return settings;
};

const ensureLeaveBalances = (user, settings) => {
  if (!user.leaveBalances) user.leaveBalances = {};
  user.leaveBalances.vacation = {
    total: user.leaveBalances.vacation?.total ?? settings.vacationLeaveTotal ?? 12,
    used: user.leaveBalances.vacation?.used ?? 0,
  };
  user.leaveBalances.sick = {
    total: user.leaveBalances.sick?.total ?? settings.sickLeaveTotal ?? 6,
    used: user.leaveBalances.sick?.used ?? 0,
  };
  user.leaveBalances.compOff = {
    total: user.leaveBalances.compOff?.total ?? settings.compOffTotal ?? 0,
    used: user.leaveBalances.compOff?.used ?? 0,
  };
};

// Get all employees
router.get('/employees', auth, admin, async (req, res) => {
  const employees = await User.find({ role: 'employee' });
  res.send(employees);
});

// Create employee
router.post('/employees', auth, admin, async (req, res) => {
  try {
    const settings = await ensureSettings();
    const { email, employeeId } = req.body;
    const existingEmail = await User.findOne({ email: email.toLowerCase() });
    if (existingEmail) {
      return res.status(400).send({ error: 'User with this email already exists' });
    }

    const existingId = await User.findOne({ employeeId });
    if (existingId) {
      return res.status(400).send({ error: 'Employee ID already in use' });
    }
    const employee = new User({
      ...req.body,
      email: email.toLowerCase(),
      role: 'employee',
      leaveBalances: {
        vacation: { total: settings.vacationLeaveTotal ?? 12, used: 0 },
        sick: { total: settings.sickLeaveTotal ?? 6, used: 0 },
        compOff: { total: settings.compOffTotal ?? 0, used: 0 },
      },
    });
    await employee.save();
    res.status(201).send(employee);
  } catch (error) {
    console.error('Create Employee Error:', error);
    res.status(400).send({ error: error.message || 'Failed to create employee' });
  }
});

// Get all attendance for a date
router.get('/attendance', auth, admin, async (req, res) => {
  const { date } = req.query;
  const attendance = await Attendance.find(date ? { date } : {}).populate('userId', 'name employeeId profilePhoto');
  res.send(attendance);
});

// Manage Leave Requests
router.get('/leaves', auth, admin, async (req, res) => {
  const leaves = await LeaveRequest.find({ status: 'pending' }).populate('userId', 'name employeeId');
  res.send(leaves);
});

router.patch('/leaves/:id', auth, admin, async (req, res) => {
  try {
    const { status, adminComment } = req.body;
    const leave = await LeaveRequest.findById(req.params.id).populate('userId', 'name employeeId pushTokens isActive');
    if (!leave) {
      return res.status(404).send({ error: 'Leave request not found' });
    }

    const previousStatus = leave.status;
    if (status) {
      leave.status = status;
    }
    if (adminComment !== undefined) {
      leave.adminComment = adminComment;
    }

    const settings = await ensureSettings();
    const employee = await User.findById(leave.userId?._id || leave.userId);
    if (employee) {
      ensureLeaveBalances(employee, settings);
      const balanceKey = leave.type === 'vacation'
        ? 'vacation'
        : leave.type === 'sick'
          ? 'sick'
          : leave.type === 'compOff'
            ? 'compOff'
            : null;

      if (balanceKey) {
        const balance = employee.leaveBalances[balanceKey];
        if (previousStatus !== 'approved' && leave.status === 'approved' && !leave.balanceApplied) {
          balance.used += leave.totalDays || 0;
          leave.balanceApplied = true;
          await employee.save();
        } else if (previousStatus === 'approved' && leave.status !== 'approved' && leave.balanceApplied) {
          balance.used = Math.max(0, balance.used - (leave.totalDays || 0));
          leave.balanceApplied = false;
          await employee.save();
        }
      }
    }

    await leave.save();

    if (leave.isEmergency) {
      const startDay = DateTime.fromJSDate(leave.startDate).startOf('day');
      const endDay = DateTime.fromJSDate(leave.endDate).startOf('day');
      const days = [];
      let cursor = startDay;
      while (cursor <= endDay) {
        days.push(cursor.toISODate());
        cursor = cursor.plus({ days: 1 });
      }

      const shouldApprove = leave.status === 'approved';
      await Promise.all(days.map(async (day) => {
        const attendance = await Attendance.findOne({ userId: leave.userId, date: day });
        if (attendance) {
          attendance.emergencyLeaveApproved = shouldApprove;
          await attendance.save();
        }
      }));
    }

    try {
      const approved = leave.status === 'approved';
      const title = leave.isEmergency && approved
        ? 'Emergency leave approved'
        : `Leave request ${approved ? 'approved' : 'rejected'}`;
      const body = approved
        ? `Your ${leave.type} leave request has been approved.${leave.adminComment ? ` Comment: ${leave.adminComment}` : ''}`
        : `Your ${leave.type} leave request was rejected.${leave.adminComment ? ` Reason: ${leave.adminComment}` : ''}`;

      await notifyUserById(leave.userId?._id || leave.userId, {
        title,
        body,
        type: 'leave',
        refModel: 'LeaveRequest',
        refId: leave._id,
        data: {
          route: '/(employee)/leaves',
          leaveId: String(leave._id),
          status: leave.status,
          isEmergency: Boolean(leave.isEmergency),
        },
      });
    } catch (pushError) {
      console.error('Employee leave notification failed:', pushError);
    }

    emitToAdmins('leave:updated', {
      action: 'decision',
      leaveId: String(leave._id),
      status: leave.status,
      userId: String(leave.userId?._id || leave.userId),
    });
    emitToAdmins('dashboard:refresh', { reason: 'leave-decision' });
    emitToUser(leave.userId?._id || leave.userId, 'leave:updated', {
      action: 'decision',
      leaveId: String(leave._id),
      status: leave.status,
      isEmergency: Boolean(leave.isEmergency),
    });

    res.send(leave);
  } catch (error) {
    res.status(400).send(error);
  }
});

router.patch('/employees/:id', auth, admin, async (req, res) => {
  try {
    const allowed = ['name', 'email', 'department', 'designation', 'employeeId', 'isActive'];
    const updates = {};
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    if (updates.email) {
      const existingEmail = await User.findOne({ email: updates.email.toLowerCase(), _id: { $ne: req.params.id } });
      if (existingEmail) {
        return res.status(400).send({ error: 'Another user already uses that email' });
      }
      updates.email = updates.email.toLowerCase();
    }

    if (updates.employeeId) {
      const existingId = await User.findOne({ employeeId: updates.employeeId, _id: { $ne: req.params.id } });
      if (existingId) {
        return res.status(400).send({ error: 'Employee ID already in use' });
      }
    }

    const employee = await User.findByIdAndUpdate(req.params.id, updates, { returnDocument: 'after' });
    res.send(employee);
  } catch (error) {
    res.status(400).send({ error: error.message || 'Failed to update employee' });
  }
});

router.delete('/employees/:id', auth, admin, async (req, res) => {
  try {
    const employee = await User.findById(req.params.id);
    if (!employee || employee.role !== 'employee') {
      return res.status(404).send({ error: 'Employee not found' });
    }

    const [attendanceCount, leaveCount] = await Promise.all([
      Attendance.countDocuments({ userId: employee._id }),
      LeaveRequest.countDocuments({ userId: employee._id }),
    ]);

    if (attendanceCount > 0 || leaveCount > 0) {
      return res.status(400).send({
        error: 'This employee already has attendance or leave records. Disable the account instead of deleting it.',
      });
    }

    await User.findByIdAndDelete(employee._id);
    res.send({ ok: true });
  } catch (error) {
    res.status(400).send({ error: error.message || 'Failed to delete employee' });
  }
});

router.get('/employees/:id/overview', auth, admin, async (req, res) => {
  try {
    const employee = await User.findById(req.params.id).select('-password');
    if (!employee || employee.role !== 'employee') {
      return res.status(404).send({ error: 'Employee not found' });
    }

    const settings = await ensureSettings();
    ensureLeaveBalances(employee, settings);

    const now = nowInBusinessZone();
    const monthStart = now.startOf('month').toISODate();
    const monthEnd = now.endOf('month').toISODate();
    const sevenDaysAgo = now.minus({ days: 6 }).toISODate();

    const [monthlyAttendance, monthlyLeaves, recentAttendance, recentLeaves, fullAttendanceHistory, approvedLeaveRecords] = await Promise.all([
      Attendance.find({
        userId: employee._id,
        date: { $gte: monthStart, $lte: monthEnd },
      }).sort({ date: 1 }),
      LeaveRequest.find({
        userId: employee._id,
        createdAt: { $gte: now.startOf('month').toJSDate() },
      }).sort({ createdAt: -1 }),
      Attendance.find({
        userId: employee._id,
        date: { $gte: sevenDaysAgo, $lte: now.toISODate() },
      }).sort({ date: 1 }),
      LeaveRequest.find({ userId: employee._id }).sort({ updatedAt: -1 }).limit(5),
      Attendance.find({ userId: employee._id }).sort({ date: 1 }),
      LeaveRequest.find({ userId: employee._id, status: 'approved' }).sort({ startDate: 1 }),
    ]);

    const presentDays = monthlyAttendance.length;
    const overtimeMinutes = monthlyAttendance.reduce((sum, item) => sum + (item.overtime || 0), 0);
    const totalWorkedMinutes = monthlyAttendance.reduce((sum, item) => sum + (item.totalHours || 0), 0);
    const pendingLeaves = monthlyLeaves.filter((item) => item.status === 'pending').length;
    const approvedLeaves = monthlyLeaves.filter((item) => item.status === 'approved').length;

    const leaveBreakdown = ['vacation', 'sick', 'compOff', 'emergency', 'other'].map((type) => ({
      type,
      count: monthlyLeaves.filter((item) => item.status === 'approved' && item.type === type).length,
    }));

    const workHoursSeries = [];
    for (let cursor = DateTime.fromISO(sevenDaysAgo); cursor <= now; cursor = cursor.plus({ days: 1 })) {
      const day = cursor.toISODate();
      const record = recentAttendance.find((item) => item.date === day);
      workHoursSeries.push({
        date: day,
        label: cursor.toFormat('dd MMM'),
        workedMinutes: record?.totalHours || 0,
      });
    }

    const recentActivity = [
      ...monthlyAttendance.slice(-5).flatMap((record) => {
        const events = [];
        if (record.clockIn?.time) {
          events.push({
            id: `clock-in-${record._id}`,
            type: 'clock-in',
            timestamp: record.clockIn.time,
            title: 'Clocked in',
            detail: record.verificationMethod === 'qr' ? 'QR verification' : 'Selfie verification',
          });
        }
        if (record.clockOut?.time) {
          events.push({
            id: `clock-out-${record._id}`,
            type: 'clock-out',
            timestamp: record.clockOut.time,
            title: 'Clocked out',
            detail: `${record.totalHours || 0} min worked`,
          });
        }
        return events;
      }),
      ...recentLeaves.map((leave) => ({
        id: `leave-${leave._id}`,
        type: `leave-${leave.status}`,
        timestamp: leave.updatedAt || leave.createdAt,
        title: `${leave.type} leave ${leave.status}`,
        detail: leave.adminComment || leave.reason,
      })),
    ]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 8);

    res.send({
      employee,
      stats: {
        presentDays,
        totalWorkedMinutes,
        overtimeMinutes,
        pendingLeaves,
        approvedLeaves,
      },
      workHoursSeries,
      leaveBreakdown,
      recentActivity,
      attendanceHistory: fullAttendanceHistory,
      approvedLeaves: approvedLeaveRecords,
    });
  } catch (error) {
    res.status(400).send({ error: error.message || 'Failed to load employee overview' });
  }
});

router.post('/employees/:id/primary-device', auth, admin, async (req, res) => {
  try {
    const { deviceId, deviceName } = req.body;
    if (!deviceId) {
      return res.status(400).send({ error: 'Device ID is required' });
    }

    const employee = await User.findById(req.params.id);
    if (!employee || employee.role !== 'employee') {
      return res.status(404).send({ error: 'Employee not found' });
    }

    employee.primaryDevice = {
      deviceId,
      deviceName: deviceName || 'Unknown device',
      assignedAt: new Date(),
      lastSeenAt: new Date(),
    };
    await employee.save();

    res.send({
      message: 'Primary device updated',
      primaryDevice: employee.primaryDevice,
    });
  } catch (error) {
    res.status(400).send({ error: error.message || 'Failed to update primary device' });
  }
});

router.post('/employees/:id/reset-password', auth, admin, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || String(password).trim().length < 6) {
      return res.status(400).send({ error: 'Password must be at least 6 characters' });
    }

    const employee = await User.findById(req.params.id);
    if (!employee || employee.role !== 'employee') {
      return res.status(404).send({ error: 'Employee not found' });
    }

    employee.password = String(password).trim();
    employee.mustChangePassword = true;
    await employee.save();

    res.send({ ok: true });
  } catch (error) {
    res.status(400).send({ error: error.message || 'Failed to reset password' });
  }
});

router.patch('/attendance/:id', auth, admin, async (req, res) => {
  try {
    const attendance = await Attendance.findById(req.params.id);
    if (!attendance) {
      return res.status(404).send({ error: 'Attendance record not found' });
    }

    const allowed = ['clockIn', 'clockOut', 'status', 'totalHours', 'overtime', 'shortHours', 'shortHoursReason', 'breaks'];
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) {
        attendance[field] = req.body[field];
      }
    });

    attendance.isEdited = true;
    attendance.modifiedBy = req.user._id;
    await attendance.save();
    res.send(attendance);
  } catch (error) {
    res.status(400).send({ error: error.message || 'Failed to update attendance' });
  }
});

router.get('/settings', auth, admin, async (req, res) => {
  const settings = await ensureSettings();
  res.send(settings);
});

router.patch('/settings', auth, admin, async (req, res) => {
  try {
    const settings = await ensureSettings();
    const allowed = [
      'attendanceMode',
      'qrCodeValue',
      'dailyMinutes',
      'weeklyMinutes',
      'vacationLeaveTotal',
      'sickLeaveTotal',
      'compOffTotal',
      'clockInWindowStart',
      'clockInWindowEnd',
      'clockOutEarliest',
      'overtimeGraceMinutes',
      'lunchBreakStart',
      'lunchBreakEnd',
      'lunchMinimumMinutes',
      'locationLatitude',
      'locationLongitude',
      'locationRadius',
      'locationName',
      'locationAddress'
    ];

    allowed.forEach((field) => {
      if (req.body[field] !== undefined) {
        settings[field] = req.body[field];
      }
    });

    if (req.body.regenerateQrSecret) {
      settings.qrCodeValue = `OFFICE-${Date.now()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    }

    await settings.save();
    res.send(settings);
  } catch (error) {
    res.status(400).send({ error: error.message || 'Failed to update settings' });
  }
});

// Reports (Simplified)
router.get('/reports/summary', auth, admin, async (req, res) => {
  const totalEmployees = await User.countDocuments({ role: 'employee' });
  const pendingLeaves = await LeaveRequest.countDocuments({ status: 'pending' });
  const today = nowInBusinessZone().toISODate();
  const presentToday = await Attendance.countDocuments({ date: today });
  const settings = await ensureSettings();
  const recentActivity = await buildRecentActivity();
  
  res.send({
    totalEmployees,
    pendingLeaves,
    presentToday,
    absentToday: totalEmployees - presentToday,
    dailyMinutes: settings.dailyMinutes,
    weeklyMinutes: settings.weeklyMinutes,
    recentActivity,
  });
});

router.get('/reports/present-today', auth, admin, async (req, res) => {
  const today = nowInBusinessZone().toISODate();
  const records = await Attendance.find({ date: today })
    .populate('userId', 'name employeeId')
    .sort({ 'clockIn.time': 1 });

  res.send(records.map((record) => ({
    id: record.userId?._id || String(record._id),
    attendanceId: record._id,
    name: record.userId?.name || 'Unknown',
    employeeId: record.userId?.employeeId || '',
    deviceId: record.deviceId || 'Not captured',
    deviceName: record.deviceName || 'Unknown device',
    clockInTime: record.clockIn?.time,
    status: record.status,
    verificationMethod: record.verificationMethod,
  })));
});

router.get('/reports/absent-today', auth, admin, async (req, res) => {
  const today = nowInBusinessZone().toISODate();
  const presentRecords = await Attendance.find({ date: today }).select('userId');
  const presentUserIds = presentRecords.map((record) => record.userId);
  const absentEmployees = await User.find({
    role: 'employee',
    _id: { $nin: presentUserIds },
  })
    .select('name employeeId department designation')
    .sort({ name: 1 });

  res.send(absentEmployees.map((employee) => ({
    id: employee._id,
    name: employee.name,
    employeeId: employee.employeeId,
    department: employee.department || '',
    designation: employee.designation || '',
  })));
});

// Export attendance for printing
router.get('/reports/export', auth, admin, async (req, res) => {
  const { start, end } = req.query;
  const from = start || nowInBusinessZone().startOf('week').toISODate();
  const to = end || nowInBusinessZone().endOf('week').toISODate();
  const query = {
    date: {
      $gte: from,
      $lte: to
    }
  };
  const records = await Attendance.find(query).populate('userId', 'name employeeId');
  const rows = [
    'Date,Employee,Employee ID,Clock In,Clock Out,Total Minutes,Overtime Minutes,Verified,Status'
  ];
  records.forEach((record) => {
    const clockIn = record.clockIn?.time ? DateTime.fromJSDate(record.clockIn.time).toFormat('HH:mm') : '';
    const clockOut = record.clockOut?.time ? DateTime.fromJSDate(record.clockOut.time).toFormat('HH:mm') : '';
    rows.push([
      record.date,
      `"${record.userId?.name || 'Unknown'}"`,
      record.userId?.employeeId || '',
      clockIn,
      clockOut,
      record.totalHours,
      record.overtime,
      record.locationVerified && record.photoCaptured ? 'Yes' : 'No',
      record.status
    ].join(','));
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="attendance_${from}_${to}.csv"`);
  res.send(rows.join('\n'));
});

module.exports = router;
