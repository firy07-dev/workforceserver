const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const LeaveRequest = require('../models/LeaveRequest');
const User = require('../models/User');
const Setting = require('../models/Setting');
const { DateTime } = require('luxon');
const { notifyAdmins } = require('../utils/pushNotifications');
const { emitToAdmins, emitToUser } = require('../utils/realtime');

const ensureSettings = async () => {
  let settings = await Setting.findOne();
  if (!settings) settings = await Setting.create({});
  return settings;
};

const withLeaveBalances = (user, settings) => {
  const balances = user?.leaveBalances || {};
  const vacation = balances.vacation || { total: settings.vacationLeaveTotal ?? 12, used: 0 };
  const sick = balances.sick || { total: settings.sickLeaveTotal ?? 6, used: 0 };
  const compOff = balances.compOff || { total: settings.compOffTotal ?? 0, used: 0 };

  return {
    vacation: { ...vacation, remaining: Math.max(0, (vacation.total || 0) - (vacation.used || 0)) },
    sick: { ...sick, remaining: Math.max(0, (sick.total || 0) - (sick.used || 0)) },
    compOff: { ...compOff, remaining: Math.max(0, (compOff.total || 0) - (compOff.used || 0)) },
  };
};

// Submit Request
router.post('/request', auth, async (req, res) => {
  try {
    const { type, startDate, endDate, reason, isEmergency = false } = req.body;
    const start = DateTime.fromISO(startDate);
    const end = DateTime.fromISO(endDate);
    const days = end.diff(start, 'days').days + 1;

    const leave = new LeaveRequest({
      userId: req.user._id,
      type,
      isEmergency,
      startDate: start.toJSDate(),
      endDate: end.toJSDate(),
      reason,
      totalDays: days
    });

    await leave.save();
    const startLabel = start.toFormat('dd LLL yyyy');
    const endLabel = end.toFormat('dd LLL yyyy');
    const leaveLabel = isEmergency ? 'Emergency leave request' : 'New leave request';
    const body = isEmergency
      ? `${req.user.name} (${req.user.employeeId}) requested emergency leave for ${startLabel}${startLabel === endLabel ? '' : ` to ${endLabel}`}.`
      : `${req.user.name} (${req.user.employeeId}) submitted a ${type} leave request for ${startLabel}${startLabel === endLabel ? '' : ` to ${endLabel}`}.`;

    try {
      await notifyAdmins({
        title: leaveLabel,
        body,
        type: 'leave',
        refModel: 'LeaveRequest',
        refId: leave._id,
        data: {
          route: '/(admin)/leaves',
          leaveId: String(leave._id),
          isEmergency: Boolean(isEmergency),
        },
      });
    } catch (pushError) {
      console.error('Admin leave notification failed:', pushError);
    }

    emitToAdmins('leave:updated', {
      action: 'created',
      leaveId: String(leave._id),
      userId: String(req.user._id),
      isEmergency: Boolean(isEmergency),
    });
    emitToAdmins('dashboard:refresh', { reason: 'leave-created' });
    emitToUser(req.user._id, 'leave:updated', {
      action: 'created',
      leaveId: String(leave._id),
      status: leave.status,
    });

    res.status(201).send(leave);
  } catch (error) {
    res.status(400).send(error);
  }
});

// My Requests
router.get('/my-requests', auth, async (req, res) => {
  const [requests, user, settings] = await Promise.all([
    LeaveRequest.find({ userId: req.user._id }).sort({ createdAt: -1 }),
    User.findById(req.user._id),
    ensureSettings(),
  ]);
  res.send({
    requests,
    balances: withLeaveBalances(user, settings),
  });
});

module.exports = router;
