const mongoose = require('mongoose');

async function main() {
  await mongoose.connect('mongodb://127.0.0.1:27017/whyte_quotation');
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db;
  const products = await db.collection('products').find({}).toArray();
  const variants = await db.collection('productvariants').find({}).toArray();

  console.log(`Total Products in DB: ${products.length}`);
  console.log(`Total Variants in DB: ${variants.length}`);

  console.log('\nSample Product from DB:');
  console.log(JSON.stringify(products[0], null, 2));

  console.log('\nSample Variant from DB:');
  console.log(JSON.stringify(variants[0], null, 2));

  // Print all products _id, name, code, moduleSize
  console.log('\nAll Products summary (_id, code, name, moduleSize, price):');
  for (let p of products) {
    console.log(`[ID: ${p._id}] Code: "${p.code}" | Name: "${p.name}" | Mod: "${p.moduleSize}" | Price: ${p.price}`);
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
