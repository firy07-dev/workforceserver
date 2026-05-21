const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Models
const User = require('../src/models/User');
const Attendance = require('../src/models/Attendance');
const LeaveRequest = require('../src/models/LeaveRequest');
const Notification = require('../src/models/Notification');
const PayoutRequest = require('../src/models/PayoutRequest');
const TimeBankEntry = require('../src/models/TimeBankEntry');

dotenv.config();

const MONGODB_URL = process.env.MONGODB_URL;

async function cleanup() {
  try {
    if (!MONGODB_URL) {
      throw new Error('MONGODB_URL is required');
    }

    await mongoose.connect(MONGODB_URL);
    console.log('Connected to MongoDB.');

    // 1. Find all employee IDs
    const employees = await User.find({ role: 'employee' }).select('_id');
    const employeeIds = employees.map(emp => emp._id);

    if (employeeIds.length === 0) {
      console.log('No employee data found to delete.');
      // Still good to check for orphans in other collections if necessary, 
      // but usually employeeIds is the source of truth.
    } else {
        console.log(`Found ${employeeIds.length} employees. Starting data cleanup...`);

        // 2. Delete related data
        const attendanceRes = await Attendance.deleteMany({ userId: { $in: employeeIds } });
        console.log(`Cleared ${attendanceRes.deletedCount} Attendance records.`);

        const leaveRes = await LeaveRequest.deleteMany({ userId: { $in: employeeIds } });
        console.log(`Cleared ${leaveRes.deletedCount} Leave Requests.`);

        const notifRes = await Notification.deleteMany({ userId: { $in: employeeIds } });
        console.log(`Cleared ${notifRes.deletedCount} Notifications.`);

        const payoutRes = await PayoutRequest.deleteMany({ userId: { $in: employeeIds } });
        console.log(`Cleared ${payoutRes.deletedCount} Payout Requests.`);

        const timeBankRes = await TimeBankEntry.deleteMany({ userId: { $in: employeeIds } });
        console.log(`Cleared ${timeBankRes.deletedCount} Time Bank entries.`);

        // 3. Finally, delete the employees
        const userRes = await User.deleteMany({ _id: { $in: employeeIds } });
        console.log(`Deleted ${userRes.deletedCount} employee accounts.`);
    }

    // Optional: Log remaining admins
    const admins = await User.find({ role: 'admin' }, 'name email');
    console.log(`Remaining Admin accounts (${admins.length}):`);
    admins.forEach(admin => console.log(` - ${admin.name} (${admin.email})`));

    console.log('\nCleanup process finished.');
  } catch (error) {
    console.error('Cleanup failed:', error);
  } finally {
    await mongoose.disconnect();
  }
}

cleanup();
