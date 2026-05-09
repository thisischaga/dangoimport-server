const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Admin = require('./Models/Admin');
require('dotenv').config();

const seedAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/dangoimport', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    const adminEmail = 'admin@dangoimport.com';
    const adminPassword = 'dango123';

    const existingAdmin = await Admin.findOne({ adminName: adminEmail });
    if (existingAdmin) {
      existingAdmin.role = 'dev-admin';
      await existingAdmin.save();
      console.log('Default admin updated to dev-admin.');
      process.exit(0);
    }

    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    const newAdmin = new Admin({
      adminFirstname: 'Super',
      adminSurname: 'Admin',
      adminName: adminEmail,
      adminPassword: hashedPassword,
      role: 'dev-admin',
    });

    await newAdmin.save();
    console.log('Default admin created successfully:');
    console.log('Email:', adminEmail);
    console.log('Password:', adminPassword);
    process.exit(0);
  } catch (error) {
    console.error('Error seeding admin:', error);
    process.exit(1);
  }
};

seedAdmin();
