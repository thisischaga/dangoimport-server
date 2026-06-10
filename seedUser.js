const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Admin = require('./Models/Admin');
const User = require('./Models/User');
require('dotenv').config();

const seedUser = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/dangoimport', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    const email = 'user@dangoimport.com';
    const password = 'user123';
    const firstname = 'user123';
    const surname = 'user123';

    const existingAdmin = await User.findOne({ userEmail: email });
    if (existingAdmin) {
      existingAdmin.role = 'dev-admin';
      await existingAdmin.save();
      console.log('Default user updated to dev-user.');
      process.exit(0);
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({

      userFirstname: firstname,
      userSurname: surname,
      userEmail: email,
      userPassword: hashedPassword,
      isVerified: true
    });

    await newUser.save();
    console.log('Default user created successfully:');

    process.exit(0);
  } catch (error) {
    console.error('Error seeding admin:', error);
    process.exit(1);
  }
};

seedUser();
