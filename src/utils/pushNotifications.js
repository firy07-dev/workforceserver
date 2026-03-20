const Notification = require('../models/Notification');
const User = require('../models/User');
const { emitToUser, emitToAdmins } = require('./realtime');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const uniqTokens = (tokens = []) => {
  const seen = new Set();
  return tokens.filter((item) => {
    if (!item?.token || seen.has(item.token)) return false;
    seen.add(item.token);
    return true;
  });
};

const createNotification = async ({ userId, type, title, body, refModel, refId, data }) => {
  const notification = await Notification.create({
    userId,
    type,
    title,
    body,
    refModel,
    refId,
    data,
  });
  const payload = {
    _id: notification._id,
    userId,
    type,
    title,
    body,
    read: notification.read,
    refModel,
    refId,
    data,
    createdAt: notification.createdAt,
  };
  emitToUser(userId, 'notification:new', payload);
  return notification;
};

const savePushToken = async ({ userId, token, platform, deviceName, projectId }) => {
  if (!userId || !token) return;
  const user = await User.findById(userId);
  if (!user) return;

  const existing = (user.pushTokens || []).find((entry) => entry.token === token);
  if (existing) {
    existing.platform = platform || existing.platform;
    existing.deviceName = deviceName || existing.deviceName;
    existing.projectId = projectId || existing.projectId;
    existing.updatedAt = new Date();
  } else {
    user.pushTokens = [
      ...(user.pushTokens || []),
      {
        token,
        platform: platform || 'android',
        deviceName,
        projectId,
        updatedAt: new Date(),
      },
    ];
  }

  await user.save();
};

const removePushToken = async ({ userId, token }) => {
  if (!userId || !token) return;
  await User.findByIdAndUpdate(userId, {
    $pull: { pushTokens: { token } },
  });
};

const sendExpoPushMessages = async (tokens, payload) => {
  const targets = uniqTokens(tokens);
  if (!targets.length) return [];

  const messages = targets.map((item) => ({
    to: item.token,
    sound: 'default',
    title: payload.title,
    body: payload.body,
    data: payload.data || {},
  }));

  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Expo push failed: ${response.status} ${text}`);
  }

  const result = await response.json();
  const tickets = Array.isArray(result?.data) ? result.data : [];

  tickets.forEach((ticket, index) => {
    if (ticket?.status === 'error') {
      const failedToken = targets[index]?.token;
      console.error('Expo push ticket error:', {
        token: failedToken,
        details: ticket.details || null,
        message: ticket.message || 'Unknown Expo push error',
      });
    }
  });

  const invalidTokens = tickets
    .map((ticket, index) => ({
      ticket,
      token: targets[index]?.token,
    }))
    .filter(({ ticket, token }) => token && ticket?.details?.error === 'DeviceNotRegistered')
    .map(({ token }) => token);

  if (invalidTokens.length) {
    await User.updateMany(
      { 'pushTokens.token': { $in: invalidTokens } },
      { $pull: { pushTokens: { token: { $in: invalidTokens } } } }
    );
  }

  return result;
};

const notifyUsers = async (users, { title, body, type = 'leave', refModel, refId, data }) => {
  const recipients = (users || []).filter(Boolean);
  if (!recipients.length) return;

  await Promise.all(
    recipients.map((user) =>
      createNotification({
        userId: user._id,
        type,
        title,
        body,
        refModel,
        refId,
        data,
      })
    )
  );

  const pushTargets = recipients.flatMap((user) => user.pushTokens || []);
  if (!pushTargets.length) return;

  const groupedTargets = pushTargets.reduce((acc, item) => {
    const key = item.projectId || `legacy:${item.token}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const groups = Object.values(groupedTargets);
  for (const group of groups) {
    await sendExpoPushMessages(group, {
      title,
      body,
      data,
    });
  }
};

const notifyAdmins = async (payload) => {
  const admins = await User.find({ role: 'admin', isActive: { $ne: false } });
  await notifyUsers(admins, payload);
  emitToAdmins('notification:refresh', { scope: 'admins' });
};

const notifyUserById = async (userId, payload) => {
  if (!userId) return;
  const user = await User.findById(userId);
  if (!user || user.isActive === false) return;
  await notifyUsers([user], payload);
};

module.exports = {
  createNotification,
  notifyAdmins,
  notifyUserById,
  notifyUsers,
  removePushToken,
  savePushToken,
};
