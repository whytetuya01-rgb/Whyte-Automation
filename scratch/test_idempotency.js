const fs = require('fs');
const mongoose = require('mongoose');

async function testIdempotency() {
  await mongoose.connect('mongodb://127.0.0.1:27017/whyte_quotation');
  const db = mongoose.connection.db;

  console.log('--- TESTING IDEMPOTENCY ON MONGODB ---');
  const products = await db.collection('products').find({}).toArray();
  const variants = await db.collection('productvariants').find({}).toArray();

  console.log(`Current Products: ${products.length} (Expected: 287)`);
  console.log(`Current Variants: ${variants.length} (Expected: 1571)`);

  if (products.length !== 287 || variants.length !== 1571) {
    throw new Error(`Database state mismatch: Expected 287 products and 1571 variants, found ${products.length} and ${variants.length}`);
  }

  // Check unique codes
  const codeCounts = {};
  products.forEach(p => {
    codeCounts[p.code] = (codeCounts[p.code] || 0) + 1;
  });
  const dupCodes = Object.entries(codeCounts).filter(([k, v]) => v > 1);

  // Check unique variants per product + tier + finish
  const varKeys = {};
  variants.forEach(v => {
    const key = `${v.productId}_${v.automationTier}_${v.surfaceFinish}`;
    varKeys[key] = (varKeys[key] || 0) + 1;
  });
  const dupVars = Object.entries(varKeys).filter(([k, v]) => v > 1);

  // Check parent product exists for each variant
  const prodIdSet = new Set(products.map(p => p._id));
  const orphans = variants.filter(v => !prodIdSet.has(v.productId));

  console.log(`Duplicate Product Codes: ${dupCodes.length}`);
  console.log(`Duplicate Variants: ${dupVars.length}`);
  console.log(`Orphaned Variants: ${orphans.length}`);

  if (dupCodes.length === 0 && dupVars.length === 0 && orphans.length === 0) {
    console.log('IDEMPOTENCY & INTEGRITY CONFIRMED 100%!');
  } else {
    console.error('Integrity issues found!');
  }

  await mongoose.disconnect();
}

testIdempotency().catch(console.error);
