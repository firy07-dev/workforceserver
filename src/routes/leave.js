const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const LeaveRequest = require('../models/LeaveRequest');
const { DateTime } = require('luxon');
const { notifyAdmins } = require('../utils/pushNotifications');
const { emitToAdmins, emitToUser } = require('../utils/realtime');

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
  const requests = await LeaveRequest.find({ userId: req.user._id }).sort({ createdAt: -1 });
  res.send(requests);
});

module.exports = router;
