const fs = require('fs');
const mongoose = require('mongoose');

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  const header = parseCsvLine(lines[0]);
  if (header[0]) header[0] = header[0].replace(/^\uFEFF/, '');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    const obj = {};
    header.forEach((h, idx) => {
      obj[h.trim()] = vals[idx] !== undefined ? vals[idx].trim() : '';
    });
    rows.push(obj);
  }
  return { header, rows };
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function normalizeMod(mod) {
  if (!mod) return null;
  const m = String(mod).trim().toUpperCase();
  if (m === '8 SQ.' || m === '8SQ') return '8 SQ.';
  if (/^\d+$/.test(m)) return `${m}M`;
  return m;
}

function generateProductCode(item) {
  let prefix = 'TAC';
  if (item.family === 'Tactus Color') prefix = 'TC';
  else if (item.family === 'Tactus Color EDGE') prefix = 'TCE';
  else if (item.family === 'Tactus VLUXE') prefix = 'TVL';

  let modStr = '';
  if (item.moduleSize) {
    const m = String(item.moduleSize).trim().toUpperCase();
    if (m === '8 SQ.' || m === '8SQ') modStr = '-8SQ';
    else if (/^\d+$/.test(m)) modStr = `-${m}M`;
    else modStr = `-${m.replace(/\s+/g, '')}`;
  }
  return `${prefix}-${item.itemNo.toString().padStart(2, '0')}${modStr}`;
}

async function executeSync() {
  await mongoose.connect('mongodb://127.0.0.1:27017/whyte_quotation');
  const db = mongoose.connection.db;

  console.log('Connected to MongoDB. Starting catalog synchronization...');

  // 1. Initial State Snapshot & Safety Backup
  const initialProducts = await db.collection('products').find({}).sort({ _id: 1 }).toArray();
  const initialVariants = await db.collection('productvariants').find({}).sort({ _id: 1 }).toArray();

  fs.writeFileSync('scratch/backup_products_pre_sync.json', JSON.stringify(initialProducts, null, 2));
  fs.writeFileSync('scratch/backup_productvariants_pre_sync.json', JSON.stringify(initialVariants, null, 2));
  console.log(`[BACKUP CREATED] ${initialProducts.length} Products and ${initialVariants.length} Variants backed up safely.`);

  // 2. Parse Catalog CSV
  const csvContent = fs.readFileSync('c:\\Project\\whyte-quotation\\Whyte_2026_MongoDB_Catalog_Import.csv', 'utf8');
  const { rows } = parseCsv(csvContent);

  const catalogMap = new Map();
  rows.forEach(r => {
    const key = `${r.catalog_family}_${r.catalog_item_no}`;
    if (!catalogMap.has(key)) {
      catalogMap.set(key, {
        key,
        family: r.catalog_family,
        itemNo: parseInt(r.catalog_item_no, 10),
        page: r.source_page,
        sourceDesc: r.source_product_description,
        baseName: r.base_product_name,
        moduleSize: r.module_size,
        variants: []
      });
    }
    catalogMap.get(key).variants.push({
      tier: r.automation_tier,
      finish: r.surface_finish,
      price: parseFloat(r.price_inr),
      status: r.availability_status
    });
  });

  const catalogItems = Array.from(catalogMap.values());
  console.log(`[CATALOG LOADED] ${catalogItems.length} Base Products and ${rows.length} Variant rows.`);

  // 3. Mapping of 28 Confirmed Existing Products
  const matches = {
    17: 'Tactus_83',
    19: 'Tactus_1',
    20: 'Tactus_11',
    21: 'Tactus_25',
    22: 'Tactus_41',
    23: 'Tactus_42',
    24: 'Tactus_22',
    26: 'Tactus_2',
    27: 'Tactus_64',
    28: 'Tactus_47',
    29: 'Tactus_18',
    30: 'Tactus_13',
    33: 'Tactus_40',
    34: 'Tactus_39',
    36: 'Tactus_23',
    38: 'Tactus_21',
    39: 'Tactus_37',
    41: 'Tactus_38',
    44: 'Tactus_4',
    46: 'Tactus_16',
    47: 'Tactus_15',
    48: 'Tactus_24',
    49: 'Tactus_30',
    50: 'Tactus_52',
    51: 'Tactus_50',
    53: 'Tactus_62',
    55: 'Tactus_5',
    56: 'Tactus_7'
  };

  const matchedDbIds = new Set(Object.keys(matches).map(Number));
  const matchedCatalogKeys = new Set(Object.values(matches));

  // Category mapping
  // 1: Tactus, 2: Tactus Edge, 3: Tactus VLuxe, 6: Accessories
  function getCategoryId(family, itemNo) {
    if (family === 'Tactus') {
      if (itemNo === 83 || itemNo === 84 || itemNo === 85) return 6; // Accessories
      return 1; // Tactus
    }
    if (family === 'Tactus Color') return 1; // Tactus
    if (family === 'Tactus Color EDGE') return 2; // Tactus Edge
    if (family === 'Tactus VLUXE') return 3; // Tactus VLuxe
    return 1;
  }

  function getProductType(family, itemNo) {
    if (family === 'Tactus' && (itemNo === 83 || itemNo === 84 || itemNo === 85)) {
      return 'accessory';
    }
    return 'switch_board';
  }

  // 4. Update the 28 Matched Products & Update/Create their Variants
  let updatedProductsCount = 0;
  let reusedVariantsCount = 0;
  let newVariantsForMatchedCount = 0;

  // Track max ID for assigning IDs to new variants & products
  let maxVariantId = initialVariants.reduce((max, v) => (v._id > max ? v._id : max), 0);
  let maxProductId = initialProducts.reduce((max, p) => (p._id > max ? p._id : max), 0);

  // Map to track catalog key -> product ID
  const catalogKeyToProductId = {};

  for (const [dbIdStr, catKey] of Object.entries(matches)) {
    const dbId = parseInt(dbIdStr, 10);
    const catItem = catalogMap.get(catKey);
    catalogKeyToProductId[catKey] = dbId;

    const existingProduct = initialProducts.find(p => p._id === dbId);
    const minPrice = Math.min(...catItem.variants.map(v => v.price));

    const finalModule = normalizeMod(catItem.moduleSize);
    const finalCode = existingProduct.code || generateProductCode(catItem);

    await db.collection('products').updateOne(
      { _id: dbId },
      {
        $set: {
          name: catItem.sourceDesc,
          code: finalCode,
          description: `${catItem.sourceDesc} - ${catItem.family}${finalModule ? ' - ' + finalModule : ''}`,
          moduleSize: finalModule,
          categoryId: getCategoryId(catItem.family, catItem.itemNo),
          type: getProductType(catItem.family, catItem.itemNo),
          price: mongoose.Types.Decimal128.fromString(minPrice.toFixed(2)),
          unit: 'pcs',
          isActive: true,
          notes: `Catalog: ${catKey}`,
          updatedAt: new Date()
        }
      }
    );
    updatedProductsCount++;

    // Update or create variants for this product
    const existingProductVariants = initialVariants.filter(v => v.productId === dbId);

    // If ID 17 had a variant with null tier/finish, update it to remote/acrylic
    if (dbId === 17 && existingProductVariants.length === 1 && existingProductVariants[0].automationTier === null) {
      await db.collection('productvariants').updateOne(
        { _id: existingProductVariants[0]._id },
        {
          $set: {
            automationTier: 'remote',
            surfaceFinish: 'acrylic',
            price: mongoose.Types.Decimal128.fromString('7499.00'),
            isActive: true,
            sortOrder: 1
          }
        }
      );
      reusedVariantsCount++;
      continue;
    }

    let sortOrder = 1;
    for (const vData of catItem.variants) {
      const matchVar = existingProductVariants.find(
        ev => ev.automationTier === vData.tier && ev.surfaceFinish === vData.finish
      );

      if (matchVar) {
        await db.collection('productvariants').updateOne(
          { _id: matchVar._id },
          {
            $set: {
              price: mongoose.Types.Decimal128.fromString(vData.price.toFixed(2)),
              isActive: true,
              sortOrder
            }
          }
        );
        reusedVariantsCount++;
      } else {
        maxVariantId++;
        await db.collection('productvariants').insertOne({
          _id: maxVariantId,
          productId: dbId,
          automationTier: vData.tier,
          surfaceFinish: vData.finish,
          config: {},
          price: mongoose.Types.Decimal128.fromString(vData.price.toFixed(2)),
          isActive: true,
          sortOrder
        });
        newVariantsForMatchedCount++;
      }
      sortOrder++;
    }
  }

  console.log(`[MATCHED PRODUCTS UPDATED] ${updatedProductsCount} Products updated.`);
  console.log(`[VARIANTS FOR MATCHED] ${reusedVariantsCount} variants reused/updated, ${newVariantsForMatchedCount} new variants created.`);

  // 5. Create New Products & Variants for remaining 259 Catalog Items
  let newProductsCreated = 0;
  let newVariantsForNewProductsCount = 0;

  for (const catItem of catalogItems) {
    if (matchedCatalogKeys.has(catItem.key)) continue;

    maxProductId++;
    const newProdId = maxProductId;
    catalogKeyToProductId[catItem.key] = newProdId;

    const minPrice = Math.min(...catItem.variants.map(v => v.price));
    const finalModule = normalizeMod(catItem.moduleSize);
    const finalCode = generateProductCode(catItem);

    await db.collection('products').insertOne({
      _id: newProdId,
      name: catItem.sourceDesc,
      code: finalCode,
      description: `${catItem.sourceDesc} - ${catItem.family}${finalModule ? ' - ' + finalModule : ''}`,
      type: getProductType(catItem.family, catItem.itemNo),
      categoryId: getCategoryId(catItem.family, catItem.itemNo),
      automationTier: null,
      surfaceFinish: null,
      price: mongoose.Types.Decimal128.fromString(minPrice.toFixed(2)),
      unit: 'pcs',
      imageUrl: null,
      moduleSize: finalModule,
      notes: `Catalog: ${catItem.key}`,
      isActive: true,
      sortOrder: catItem.itemNo,
      createdAt: new Date(),
      updatedAt: new Date(),
      isMatrix: false,
      matrixDimensions: null
    });
    newProductsCreated++;

    let sortOrder = 1;
    for (const vData of catItem.variants) {
      maxVariantId++;
      await db.collection('productvariants').insertOne({
        _id: maxVariantId,
        productId: newProdId,
        automationTier: vData.tier,
        surfaceFinish: vData.finish,
        config: {},
        price: mongoose.Types.Decimal128.fromString(vData.price.toFixed(2)),
        isActive: true,
        sortOrder
      });
      newVariantsForNewProductsCount++;
      sortOrder++;
    }
  }

  console.log(`[NEW PRODUCTS CREATED] ${newProductsCreated} Base Products created.`);
  console.log(`[NEW VARIANTS CREATED] ${newVariantsForNewProductsCount} ProductVariants created for new products.`);

  // 6. Targeted Deletion of Non-Catalog Products and their Variants
  const deleteProductCandidates = initialProducts.filter(p => !matchedDbIds.has(p._id));
  const deleteProductIds = deleteProductCandidates.map(p => p._id);

  const deleteVariantCandidates = initialVariants.filter(v => deleteProductIds.includes(v.productId));
  const deleteVariantIds = deleteVariantCandidates.map(v => v._id);

  console.log(`[DELETION TARGETS] ${deleteProductIds.length} non-catalog Products, ${deleteVariantIds.length} related Variants.`);

  const delVarRes = await db.collection('productvariants').deleteMany({ _id: { $in: deleteVariantIds } });
  const delProdRes = await db.collection('products').deleteMany({ _id: { $in: deleteProductIds } });

  console.log(`[DELETIONS EXECUTED] Deleted ${delProdRes.deletedCount} Products and ${delVarRes.deletedCount} Variants.`);

  // 7. POST-IMPORT COMPREHENSIVE VERIFICATION
  console.log('\n==================================================');
  console.log('EXECUTING POST-IMPORT VERIFICATION ON MONGODB');
  console.log('==================================================');

  const finalProducts = await db.collection('products').find({}).sort({ _id: 1 }).toArray();
  const finalVariants = await db.collection('productvariants').find({}).sort({ _id: 1 }).toArray();

  console.log(`Final Products in DB: ${finalProducts.length}`);
  console.log(`Final Variants in DB: ${finalVariants.length}`);

  // Check duplicate product codes or IDs
  const seenProdIds = new Set();
  const duplicateProdIds = [];
  const seenProdCodes = new Set();
  const duplicateProdCodes = [];

  finalProducts.forEach(p => {
    if (seenProdIds.has(p._id)) duplicateProdIds.push(p._id);
    seenProdIds.add(p._id);

    if (p.code) {
      if (seenProdCodes.has(p.code)) duplicateProdCodes.push(p.code);
      seenProdCodes.add(p.code);
    }
  });

  // Check duplicate variants (same productId + automationTier + surfaceFinish)
  const seenVariantKeys = new Set();
  const duplicateVariants = [];
  finalVariants.forEach(v => {
    const key = `${v.productId}_${v.automationTier}_${v.surfaceFinish}`;
    if (seenVariantKeys.has(key)) duplicateVariants.push({ id: v._id, key });
    seenVariantKeys.add(key);
  });

  // Check broken references (ProductVariant -> non-existing Product)
  const finalProdIdSet = new Set(finalProducts.map(p => p._id));
  const brokenReferences = finalVariants.filter(v => !finalProdIdSet.has(v.productId));

  // Check unmapped catalog rows
  let unmappedCatalogItems = 0;
  catalogItems.forEach(ci => {
    const pId = catalogKeyToProductId[ci.key];
    const p = finalProducts.find(x => x._id === pId);
    if (!p) unmappedCatalogItems++;
  });

  // Check invalid/unavailable price variants
  const invalidPrices = finalVariants.filter(v => {
    const priceNum = parseFloat(v.price.toString());
    return isNaN(priceNum) || priceNum <= 0;
  });

  console.log('\n--- VERIFICATION CHECKS ---');
  console.log(`Duplicate Product IDs: ${duplicateProdIds.length}`);
  console.log(`Duplicate Product Codes: ${duplicateProdCodes.length}`);
  console.log(`Duplicate ProductVariants: ${duplicateVariants.length}`);
  console.log(`Broken Product References: ${brokenReferences.length}`);
  console.log(`Unmapped Catalog Rows: ${unmappedCatalogItems}`);
  console.log(`Invalid Prices: ${invalidPrices.length}`);

  // Summary Report Structure
  const report = {
    catalogRows: 287,
    totalExpandedVariantRows: rows.length,
    baseProductsIdentified: catalogItems.length,
    totalProductVariantsImported: finalVariants.length,
    existingProductsMatched: updatedProductsCount,
    newProductsCreated: newProductsCreated,
    existingProductsDeleted: delProdRes.deletedCount,
    existingProductsUpdated: updatedProductsCount,
    existingVariantsReused: reusedVariantsCount,
    newVariantsCreated: newVariantsForMatchedCount + newVariantsForNewProductsCount,
    variantsRemovedWithNonCatalog: delVarRes.deletedCount,
    duplicateProducts: duplicateProdIds.length,
    duplicateVariants: duplicateVariants.length,
    brokenReferences: brokenReferences.length,
    unmappedCatalogRows: unmappedCatalogItems,
    invalidPrices: invalidPrices.length,
    mongoDbBefore: {
      products: initialProducts.length,
      variants: initialVariants.length
    },
    mongoDbAfter: {
      products: finalProducts.length,
      variants: finalVariants.length
    }
  };

  fs.writeFileSync('scratch/sync_verification_report.json', JSON.stringify(report, null, 2));
  console.log('\nReport saved to scratch/sync_verification_report.json');

  await mongoose.disconnect();
}

executeSync().catch(console.error);
