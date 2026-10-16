const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();
const mongoose = require('mongoose');

async function test() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const companies = await db.collection('companies').find({}).toArray();
  console.log('Companies:', companies.map(c => ({ _id: c._id, name: c.name, status: c.status })));

  const usersWithCompany = await db.collection('adminusers')
    .find({ companyId: { $ne: null } })
    .project({ email: 1, role: 1, companyId: 1 })
    .toArray();
  console.log('Users with companyId count:', usersWithCompany.length);
  console.log('Users sample:', usersWithCompany.slice(0, 10));

  const dealers = await db.collection('adminusers')
    .find({ role: 'dealer' })
    .project({ email: 1, role: 1, companyId: 1, isActive: 1 })
    .toArray();
  console.log('Dealers:', dealers);

  await mongoose.disconnect();
}
test().catch(console.error);
