require('dns').setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);
const mongoose = require('mongoose');
require('dotenv').config({ path: '.env' });

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const variants = await db.collection('productvariants').find({}).toArray();
  console.log('Total variants in DB:', variants.length);
  const variantProductIds = [...new Set(variants.map(v => v.productId))];
  console.log('Products that have variants in productvariants collection:', variantProductIds);
  for (const pid of variantProductIds) {
    const p = await db.collection('products').findOne({ _id: pid });
    console.log('Product', pid, p?.name, 'isMatrix:', p?.isMatrix, 'matrixDimensions:', JSON.stringify(p?.matrixDimensions));
    const prodVariants = variants.filter(v => v.productId === pid);
    console.log('  variant configs:', prodVariants.map(v => ({ id: v._id, code: v.code || v.variantCode, config: v.config, tier: v.automationTier, finish: v.surfaceFinish, price: v.price?.toString() })));
  }
  await mongoose.disconnect();
}
check().catch(console.error);
