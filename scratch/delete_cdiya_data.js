const mongoose = require('mongoose');
const User = require('../src/models/User');
const Attendance = require('../src/models/Attendance');
const TimeBankEntry = require('../src/models/TimeBankEntry');
const dotenv = require('dotenv');

dotenv.config();

async function deleteAttendance() {
  try {
    await mongoose.connect(process.env.MONGODB_URL);
    console.log('Connected to MongoDB');

    const email = 'cdiya957@gmail.com';
    const user = await User.findOne({ email });

    if (!user) {
      console.log('User not found with email:', email);
      process.exit(0);
    }

    console.log('Found user:', user.name, '(', user._id, ')');

    const attendanceResult = await Attendance.deleteMany({ userId: user._id });
    console.log('Deleted attendance records:', attendanceResult.deletedCount);

    const timeBankResult = await TimeBankEntry.deleteMany({ userId: user._id });
    console.log('Deleted time bank entries:', timeBankResult.deletedCount);

    console.log('Cleanup complete.');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

deleteAttendance();
