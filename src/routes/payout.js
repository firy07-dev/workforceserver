const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const PayoutRequest = require('../models/PayoutRequest');
const Setting = require('../models/Setting');
const User = require('../models/User');
const { getTimeBankBalance } = require('../utils/timeBankLedger');
const { notifyAdmins } = require('../utils/pushNotifications');
const { emitToAdmins, emitToUser } = require('../utils/realtime');

// Submit Payout Request
router.post('/request', auth, async (req, res) => {
  try {
    const { amountMinutes, reason } = req.body;
    const settings = await Setting.findOne() || {};
    const minPayout = settings.minPayoutMinutes || 480;
    const balance = await getTimeBankBalance(req.user._id);

    if (amountMinutes < minPayout) {
      return res.status(400).send({ error: `Minimum payout request is ${minPayout / 60} hours.` });
    }

    if (balance < amountMinutes) {
      return res.status(400).send({ error: 'Insufficient time bank balance.' });
    }

    const payout = new PayoutRequest({
      userId: req.user._id,
      amountMinutes,
      reason,
      balanceAtRequest: balance,
    });

    await payout.save();

    // Notify Admins
    try {
      await notifyAdmins({
        title: 'New Payout Request',
        body: `${req.user.name} requested a payout of ${Math.round(amountMinutes / 60 * 10) / 10} hours.`,
        type: 'payout',
        refModel: 'PayoutRequest',
        refId: payout._id,
        data: {
          route: '/(admin)/payouts', // Future admin route
          payoutId: String(payout._id),
        },
      });
    } catch (err) {
      console.error('Payout notification failed:', err);
    }

    emitToAdmins('payout:updated', { action: 'created', payoutId: String(payout._id) });

    res.status(201).send(payout);
  } catch (error) {
    res.status(400).send(error);
  }
});

// My Payout Requests
router.get('/my-requests', auth, async (req, res) => {
  try {
    const requests = await PayoutRequest.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.send(requests);
  } catch (error) {
    res.status(500).send(error);
  }
});

module.exports = router;
