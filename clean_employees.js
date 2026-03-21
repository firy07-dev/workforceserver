require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./src/models/User');
const Attendance = require('./src/models/Attendance');
const LeaveRequest = require('./src/models/LeaveRequest');
const Notification = require('./src/models/Notification');

async function cleanEmployees() {
  const MONGODB_URL = process.env.MONGODB_URL;
  if (!MONGODB_URL) {
    console.error('MONGODB_URL is missing in .env');
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGODB_URL);
    console.log('Connected to Database');

    // 1. Delete all Attendance records
    const attendanceResult = await Attendance.deleteMany({});
    console.log(`Deleted ${attendanceResult.deletedCount} attendance records.`);

    // 2. Delete all Leave Requests
    const leaveResult = await LeaveRequest.deleteMany({});
    console.log(`Deleted ${leaveResult.deletedCount} leave requests.`);

    // 3. Delete all Notifications
    const notificationResult = await Notification.deleteMany({});
    console.log(`Deleted ${notificationResult.deletedCount} notifications.`);

    // 4. Delete only Users with role 'employee'
    const employeeResult = await User.deleteMany({ role: 'employee' });
    console.log(`Deleted ${employeeResult.deletedCount} employee accounts.`);

    console.log('--- Database cleanup complete (Admins preserved) ---');
  } catch (error) {
    console.error('Error during cleanup:', error);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

cleanEmployees();
