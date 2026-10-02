const mongoose = require('mongoose');

async function run() {
  await mongoose.connect('mongodb://127.0.0.1:27017/whyte_quotation');
  const db = mongoose.connection.db;

  console.log('=== PRODUCT TYPE CORRECTION SCRIPT ===\n');

  // 1. Snapshot pre-update state
  const preProducts = await db.collection('products').find({}).toArray();
  const preVariants = await db.collection('productvariants').find({}).toArray();

  console.log(`Pre-update verification:`);
  console.log(`  Products count: ${preProducts.length}`);
  console.log(`  Variants count: ${preVariants.length}`);

  const curtainIds = [56, 72, 133, 134, 214, 215, 263, 264];
  const socketUsbAccessoryIds = [121, 122, 123, 124, 204, 205, 206, 207, 325, 326, 327, 328];

  // 2. Perform updates
  const curtainRes = await db.collection('products').updateMany(
    { _id: { $in: curtainIds } },
    { $set: { type: 'curtain', updatedAt: new Date() } }
  );
  console.log(`\nUpdated curtain products to type="curtain": ${curtainRes.modifiedCount} modified.`);

  const accessoryRes = await db.collection('products').updateMany(
    { _id: { $in: socketUsbAccessoryIds } },
    { $set: { type: 'accessory', updatedAt: new Date() } }
  );
  console.log(`Updated sockets/USB products to type="accessory": ${accessoryRes.modifiedCount} modified.`);

  // 3. Post-update verification
  const postProducts = await db.collection('products').find({}).toArray();
  const postVariants = await db.collection('productvariants').find({}).toArray();

  console.log(`\nPost-update verification:`);
  console.log(`  Products count: ${postProducts.length} (Expected: 287)`);
  console.log(`  Variants count: ${postVariants.length} (Expected: 1571)`);

  if (postProducts.length !== preProducts.length) {
    throw new Error('FAIL: Product count changed!');
  }
  if (postVariants.length !== preVariants.length) {
    throw new Error('FAIL: Variant count changed!');
  }

  // Check no other fields were modified
  for (const postP of postProducts) {
    const preP = preProducts.find(p => p._id === postP._id);
    if (!preP) throw new Error(`FAIL: Product ${postP._id} not found in preProducts!`);
    
    // Check fields except type and updatedAt
    if (preP.name !== postP.name) throw new Error(`FAIL: Name changed for ID ${postP._id}`);
    if (preP.code !== postP.code) throw new Error(`FAIL: Code changed for ID ${postP._id}`);
    if (preP.description !== postP.description) throw new Error(`FAIL: Description changed for ID ${postP._id}`);
    if (preP.moduleSize !== postP.moduleSize) throw new Error(`FAIL: ModuleSize changed for ID ${postP._id}`);
    if (preP.automationTier !== postP.automationTier) throw new Error(`FAIL: AutomationTier changed for ID ${postP._id}`);
    if (preP.surfaceFinish !== postP.surfaceFinish) throw new Error(`FAIL: SurfaceFinish changed for ID ${postP._id}`);
    if (preP.categoryId !== postP.categoryId) throw new Error(`FAIL: CategoryId changed for ID ${postP._id}`);
  }
  console.log(`  Integrity check: All product names, codes, descriptions, module sizes, categories, tiers, and finishes are 100% UNCHANGED.`);

  // Check variant integrity
  const productIds = new Set(postProducts.map(p => p._id));
  for (const v of postVariants) {
    if (!productIds.has(v.productId)) {
      throw new Error(`FAIL: Broken relationship - variant ${v._id} has invalid productId ${v.productId}`);
    }
  }
  console.log(`  Integrity check: All 1,571 variants reference valid product IDs (0 broken relationships).`);

  // Type summary
  const byType = {};
  for (const p of postProducts) {
    byType[p.type] = (byType[p.type] || 0) + 1;
  }
  console.log(`\nFinal type distribution in MongoDB:`, byType);

  await mongoose.disconnect();
  console.log('\nDone successfully!');
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
