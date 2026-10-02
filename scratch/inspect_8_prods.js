const mongoose = require('mongoose');

async function main() {
  await mongoose.connect('mongodb://127.0.0.1:27017/whyte_quotation');
  const db = mongoose.connection.db;

  const targetIds = [44, 46, 47, 48, 49, 50, 51, 53];
  const prods = await db.collection('products').find({ _id: { $in: targetIds } }).sort({ _id: 1 }).toArray();

  for (let p of prods) {
    console.log(`\nID: ${p._id}`);
    console.log(`  Name: "${p.name}"`);
    console.log(`  Code: "${p.code}"`);
    console.log(`  Description: "${p.description}"`);
    console.log(`  ModuleSize: "${p.moduleSize}"`);
    console.log(`  Notes: "${p.notes}"`);
    console.log(`  Type: "${p.type}"`);
    console.log(`  IsActive: ${p.isActive}`);
  }

  await mongoose.disconnect();
}

main().catch(console.error);
