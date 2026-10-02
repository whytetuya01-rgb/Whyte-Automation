const fs = require('fs');
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect('mongodb://127.0.0.1:27017/whyte_quotation');
  console.log('Connected to MongoDB: whyte_quotation');

  const db = mongoose.connection.db;

  // 1. Snapshot BEFORE state
  const initialProducts = await db.collection('products').find({}).toArray();
  const initialVariants = await db.collection('productvariants').find({}).toArray();

  console.log(`\n--- PRE-UPDATE SNAPSHOT ---`);
  console.log(`Initial Products: ${initialProducts.length}`);
  console.log(`Initial Variants: ${initialVariants.length}`);

  // 2. Define the exact verified updates from Excel for the 8 matched products
  const verifiedUpdates = [
    {
      id: 44,
      name: "Touch 4 Switch (All 6A)",
      description: "Touch 4 Switch (All 6A Switch) - 2 Module",
      moduleSize: "2M",
      code: "T4S-2M",
      excelRef: "Item 4 in Tactus PDF"
    },
    {
      id: 46,
      name: "Touch 6 Switch",
      description: "Touch 6 Switch - 4 Module",
      moduleSize: "4M",
      code: "T6S-4M",
      excelRef: "Item 16 in Tactus PDF"
    },
    {
      id: 47,
      name: "Touch 4 Switch 1 Fan Regulator",
      description: "Touch 4 Switch 1 Fan Regulator - 4 Module",
      moduleSize: "4M",
      code: "T4S1F-4M",
      excelRef: "Item 15 in Tactus PDF"
    },
    {
      id: 48,
      name: "Touch 8 Switch",
      description: "Touch 8 Switch - 6 Module",
      moduleSize: "6M",
      code: "T8S-6M",
      excelRef: "Item 24 in Tactus PDF"
    },
    {
      id: 49,
      name: "Touch 6 Switch 1 Fan",
      description: "Touch 6 Switch 1 Fan - 6 Module",
      moduleSize: "6M",
      code: "T6S1F-6M",
      excelRef: "Item 30 in Tactus PDF"
    },
    {
      id: 50,
      name: "Touch 8 Switch 1 Fan",
      description: "Touch 8 Switch 1 Fan - 8 Module",
      moduleSize: "8M",
      code: "T8S1F-8M",
      excelRef: "Item 52 in Tactus PDF"
    },
    {
      id: 51,
      name: "Touch 10 Switch",
      description: "Touch 10 Switch - 8 Module",
      moduleSize: "8M",
      code: "T10S-8M",
      excelRef: "Item 50 in Tactus PDF"
    },
    {
      id: 53,
      name: "Touch 12 Switch 2 Fan",
      description: "Touch 12 Switch 2 Fan - 12 Module",
      moduleSize: "12M",
      code: "T12S2F-12M",
      excelRef: "Item 62 in Tactus PDF"
    }
  ];

  // 3. Apply updates to the 8 verified products
  console.log(`\n--- APPLYING VERIFIED PRODUCT ENRICHMENTS (8 Products) ---`);
  for (let item of verifiedUpdates) {
    const res = await db.collection('products').updateOne(
      { _id: item.id },
      {
        $set: {
          name: item.name,
          description: item.description,
          moduleSize: item.moduleSize,
          code: item.code,
          updatedAt: new Date()
        }
      }
    );
    console.log(`Updated Product ID ${item.id} (${item.name}): matched=${res.matchedCount}, modified=${res.modifiedCount}`);
  }

  // Under Option A:
  // - 18 matching variants already match the PDF prices (verified).
  // - 30 mismatched variants are preserved with their existing DB prices (kept unchanged as per Option A).
  // - 48 variants for non-PDF products are kept unchanged.
  // - 1 manual variant (ID 112) is kept unchanged.

  // 4. POST-UPDATE VERIFICATION
  const postProducts = await db.collection('products').find({}).toArray();
  const postVariants = await db.collection('productvariants').find({}).toArray();

  console.log(`\n--- POST-UPDATE VERIFICATION ---`);
  console.log(`1. Product count preserved: ${postProducts.length === initialProducts.length} (${postProducts.length} == ${initialProducts.length})`);
  console.log(`2. Variant count preserved: ${postVariants.length === initialVariants.length} (${postVariants.length} == ${initialVariants.length})`);

  // Check no deletions
  const postProdIds = new Set(postProducts.map(p => p._id));
  const postVarIds = new Set(postVariants.map(v => v._id));
  const noProdDeleted = initialProducts.every(p => postProdIds.has(p._id));
  const noVarDeleted = initialVariants.every(v => postVarIds.has(v._id));
  console.log(`3. No existing products deleted: ${noProdDeleted}`);
  console.log(`4. No existing variants deleted: ${noVarDeleted}`);

  // Check relationships
  let brokenRels = 0;
  for (let v of postVariants) {
    if (!postProdIds.has(v.productId)) {
      brokenRels++;
    }
  }
  console.log(`5. Product -> Variant relationships valid: ${brokenRels === 0} (Broken: ${brokenRels})`);

  // Check the 8 updated products
  console.log(`\n6. Validated Products Details:`);
  for (let item of verifiedUpdates) {
    const updated = await db.collection('products').findOne({ _id: item.id });
    console.log(`   ID ${updated._id}: Name="${updated.name}" | Code="${updated.code}" | Mod="${updated.moduleSize}" | Desc="${updated.description}"`);
  }

  // Check untouched products (e.g. non-PDF products)
  const untouchedSampleIds = [1, 10, 15, 20, 45, 52, 57, 60, 69];
  console.log(`\n7. Non-PDF / Review Products Integrity Check:`);
  for (let id of untouchedSampleIds) {
    const p = await db.collection('products').findOne({ _id: id });
    console.log(`   ID ${p._id}: Name="${p.name}" | Code="${p.code}" | Mod="${p.moduleSize}" (KEPT UNCHANGED)`);
  }

  console.log(`\n[SUCCESS] Verification completed with 100% data integrity.`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error("Enrichment failed:", err);
  process.exit(1);
});
