const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { DateTime } = require('luxon');
const Notification = require('../models/Notification');
const Attendance = require('../models/Attendance');
const LeaveRequest = require('../models/LeaveRequest');
const Setting = require('../models/Setting');
const { removePushToken, savePushToken } = require('../utils/pushNotifications');

// ── Helpers ───────────────────────────────────────────────────────────────────

const retentionDaysByType = {
  policy: 7,
  alert: 14,
  overtime: 30,
  leave: 90,
};

const ensureSettings = async () => {
  let s = await Setting.findOne();
  if (!s) s = await Setting.create({});
  return s;
};

const cleanupOldNotifications = async (userId) => {
  const now = DateTime.now();
  await Promise.all(
    Object.entries(retentionDaysByType).map(([type, days]) =>
      Notification.deleteMany({
        userId,
        type,
        createdAt: { $lt: now.minus({ days }).toJSDate() },
      })
    )
  );
};

/**
 * For the requesting user, look at real data (attendance + leave) and
 * generate any notifications that don't yet exist in the DB.
 * Only creates one notification per "event" using refId deduplication.
 */
const generateForUser = async (user) => {
  const today = DateTime.now().toISODate();
  const todayStart = DateTime.now().startOf('day').toJSDate();
  const settings = await ensureSettings();
  const dailyTarget = settings.dailyMinutes ?? 493; // 8h 13m default
  const clockInWindowStart = settings.clockInWindowStart ?? 360; // 6:00 AM in minutes

  // ── 1. Late clock-in alert ───────────────────────────────────────────────
  const todayAttendance = await Attendance.findOne({ userId: user._id, date: today });
  if (todayAttendance?.clockIn?.time) {
    const clockInMinute =
      DateTime.fromJSDate(todayAttendance.clockIn.time).hour * 60 +
      DateTime.fromJSDate(todayAttendance.clockIn.time).minute;
    const lateBy = clockInMinute - clockInWindowStart;
    if (lateBy > 5) {
      // Only create once per attendance record
      const exists = await Notification.findOne({
        userId: user._id,
        refModel: 'Attendance',
        refId: todayAttendance._id,
        type: 'alert',
        title: { $regex: /late/i },
      });
      if (!exists) {
        await Notification.create({
          userId: user._id,
          type: 'alert',
          title: 'Late clock-in detected',
          body: `You clocked in ${lateBy} minutes late today (${DateTime.fromJSDate(todayAttendance.clockIn.time).toFormat('hh:mm a')}).`,
          refModel: 'Attendance',
          refId: todayAttendance._id,
        });
      }
    }
  }

  // ── 2. Overtime notification ──────────────────────────────────────────────
  if (todayAttendance && todayAttendance.totalHours > dailyTarget) {
    const overtime = todayAttendance.totalHours - dailyTarget;
    const exists = await Notification.findOne({
      userId: user._id,
      refModel: 'Attendance',
      refId: todayAttendance._id,
      type: 'overtime',
    });
    if (!exists) {
      const hrs = Math.floor(overtime / 60);
      const mins = overtime % 60;
      await Notification.create({
        userId: user._id,
        type: 'overtime',
        title: 'Overtime recorded',
        body: `You worked ${hrs}h ${mins}m overtime today. Your manager may need to approve this.`,
        refModel: 'Attendance',
        refId: todayAttendance._id,
      });
    }
  }

  // ── 3. Leave request status updates ──────────────────────────────────────
  const settledLeaves = await LeaveRequest.find({
    userId: user._id,
    status: { $in: ['approved', 'rejected'] },
    updatedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // last 7 days
  });

  for (const leave of settledLeaves) {
    const exists = await Notification.findOne({
      userId: user._id,
      refModel: 'LeaveRequest',
      refId: leave._id,
      type: 'leave',
    });
    if (!exists) {
      const approved = leave.status === 'approved';
      await Notification.create({
        userId: user._id,
        type: 'leave',
        title: `Leave request ${approved ? 'approved' : 'rejected'}`,
        body: approved
          ? `Your ${leave.type} leave request has been approved.${leave.adminComment ? ' Comment: ' + leave.adminComment : ''}`
          : `Your ${leave.type} leave request was rejected.${leave.adminComment ? ' Reason: ' + leave.adminComment : ''}`,
        refModel: 'LeaveRequest',
        refId: leave._id,
      });
    }
  }

  // ── 4. Pending leave reminder (for admins only) ───────────────────────────
  if (user.role === 'admin') {
    const pendingCount = await LeaveRequest.countDocuments({ status: 'pending' });
    if (pendingCount > 0) {
      // One reminder per day
      const dayKey = today;
      const exists = await Notification.findOne({
        userId: user._id,
        type: 'policy',
        title: 'Pending leave requests',
        createdAt: { $gte: DateTime.now().startOf('day').toJSDate() },
      });
      if (!exists) {
        await Notification.create({
          userId: user._id,
          type: 'policy',
          title: 'Pending leave requests',
          body: `There ${pendingCount === 1 ? 'is' : 'are'} ${pendingCount} leave request${pendingCount > 1 ? 's' : ''} awaiting your approval.`,
        });
      }
    }
  }

  // ── 5. Daily attendance policy reminder (employee, if no clock-in yet) ────
  if (user.role === 'employee' && !todayAttendance) {
    const nowMinute = DateTime.now().hour * 60 + DateTime.now().minute;
    if (nowMinute >= clockInWindowStart) {
      const exists = await Notification.findOne({
        userId: user._id,
        type: 'policy',
        title: 'Attendance reminder',
        createdAt: { $gte: DateTime.now().startOf('day').toJSDate() },
      });
      if (!exists) {
        await Notification.create({
          userId: user._id,
          type: 'policy',
          title: 'Attendance reminder',
          body: `You haven't clocked in yet today. Don't forget to clock in and log your lunch break.`,
        });
      }
    }
  }
};

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/notifications  — generate fresh + return all
router.get('/', auth, async (req, res) => {
  try {
    await cleanupOldNotifications(req.user._id);
    await generateForUser(req.user);

    const notifications = await Notification.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);

    res.send(notifications);
  } catch (err) {
    console.error('Notifications error:', err);
    res.status(500).send({ error: 'Failed to fetch notifications' });
  }
});

router.post('/push-token', auth, async (req, res) => {
  try {
    const { token, platform, deviceName, projectId } = req.body || {};
    if (!token) {
      return res.status(400).send({ error: 'Push token is required' });
    }

    await savePushToken({
      userId: req.user._id,
      token,
      platform,
      deviceName,
      projectId,
    });

    res.send({ ok: true });
  } catch (err) {
    console.error('Push token register error:', err);
    res.status(500).send({ error: 'Failed to register push token' });
  }
});

router.delete('/push-token', auth, async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) {
      return res.status(400).send({ error: 'Push token is required' });
    }

    await removePushToken({ userId: req.user._id, token });
    res.send({ ok: true });
  } catch (err) {
    console.error('Push token remove error:', err);
    res.status(500).send({ error: 'Failed to remove push token' });
  }
});

router.delete('/clear-old', auth, async (req, res) => {
  try {
    const now = DateTime.now();
    const keepAfter = now.minus({ days: 7 }).toJSDate();
    const result = await Notification.deleteMany({
      userId: req.user._id,
      read: true,
      createdAt: { $lt: keepAfter },
    });
    res.send({ ok: true, deletedCount: result.deletedCount || 0 });
  } catch (err) {
    res.status(500).send({ error: 'Failed to clear old notifications' });
  }
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', auth, async (req, res) => {
  try {
    const notif = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { read: true },
      { returnDocument: 'after' }
    );
    if (!notif) return res.status(404).send({ error: 'Not found' });
    res.send(notif);
  } catch (err) {
    res.status(500).send({ error: 'Failed to mark as read' });
  }
});

// PATCH /api/notifications/read-all
router.patch('/read-all', auth, async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.user._id, read: false }, { read: true });
    res.send({ ok: true });
  } catch (err) {
    res.status(500).send({ error: 'Failed to mark all as read' });
  }
});

module.exports = router;
