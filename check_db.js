require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const User = require('./src/models/User');

async function checkAndSeed() {
  try {
    await mongoose.connect(process.env.MONGODB_URL);
    console.log('Connected to DB');
    
    const count = await User.countDocuments();
    console.log(`Current user count: ${count}`);
    
    if (count === 0) {
      console.log('No users found. Seeding default admin...');
      const admin = new User({
        name: 'System Admin',
        email: 'admin@lms.com',
        password: 'adminpassword123',
        role: 'admin',
        employeeId: 'ADM001'
      });
      await admin.save();
      console.log('Admin seeded: admin@lms.com / adminpassword123');
    } else {
      const users = await User.find({}, 'name email role');
      console.log('Existing users:');
      console.log(JSON.stringify(users, null, 2));
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await mongoose.connection.close();
  }
}

checkAndSeed();
