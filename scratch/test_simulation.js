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

async function testSimulation() {
  await mongoose.connect('mongodb://127.0.0.1:27017/whyte_quotation');
  const db = mongoose.connection.db;

  const dbProducts = await db.collection('products').find({}).sort({ _id: 1 }).toArray();
  const dbVariants = await db.collection('productvariants').find({}).sort({ _id: 1 }).toArray();

  const csvContent = fs.readFileSync('c:\\Project\\whyte-quotation\\Whyte_2026_MongoDB_Catalog_Import.csv', 'utf8');
  const { rows } = parseCsv(csvContent);

  // Group 287 catalog items
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

  // Define the exact 28 verified mappings from DB to Catalog
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

  const deleteProductCandidates = dbProducts.filter(p => !matchedDbIds.has(p._id));
  const deleteVariantCandidates = dbVariants.filter(v => deleteProductCandidates.some(dp => dp._id === v.productId));

  console.log('=== DRY RUN SIMULATION METRICS ===');
  console.log(`Total Catalog Rows: ${rows.length}`);
  console.log(`Unique Base Products Identified: ${catalogItems.length}`);
  console.log(`MongoDB Before - Products: ${dbProducts.length}`);
  console.log(`MongoDB Before - ProductVariants: ${dbVariants.length}`);

  console.log(`Existing Products Matched: ${matchedDbIds.size}`);

  // Count how many existing variants match
  let existingVariantsMatched = 0;
  let newVariantsForMatched = 0;

  matchedDbIds.forEach(dbId => {
    const catKey = matches[dbId];
    const catItem = catalogMap.get(catKey);
    const existingVars = dbVariants.filter(v => v.productId === dbId);

    catItem.variants.forEach(cv => {
      const ev = existingVars.find(v => v.automationTier === cv.tier && v.surfaceFinish === cv.finish);
      if (ev) existingVariantsMatched++;
      else newVariantsForMatched++;
    });
  });

  console.log(`Existing Variants Matched/Reused: ${existingVariantsMatched}`);

  const newProductsCount = catalogItems.length - matchedCatalogKeys.size;
  let newVariantsForNewProducts = 0;
  catalogItems.forEach(ci => {
    if (!matchedCatalogKeys.has(ci.key)) {
      newVariantsForNewProducts += ci.variants.length;
    }
  });

  const totalNewVariants = newVariantsForMatched + newVariantsForNewProducts;
  console.log(`New Products Required: ${newProductsCount}`);
  console.log(`New Variants Required: ${totalNewVariants}`);
  console.log(`Delete Candidates - Products: ${deleteProductCandidates.length}`);
  console.log(`Delete Candidates - Variants: ${deleteVariantCandidates.length}`);

  console.log(`\nFinal Expected State:`);
  console.log(`Final Products: ${matchedDbIds.size + newProductsCount} (should be exactly 287)`);
  console.log(`Final Variants: ${existingVariantsMatched + totalNewVariants} (should be exactly 1571)`);

  await mongoose.disconnect();
}

testSimulation().catch(console.error);
