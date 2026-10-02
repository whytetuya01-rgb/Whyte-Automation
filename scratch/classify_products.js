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

function normalize(s) {
  if (!s) return '';
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function run() {
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

  // Let's create an exact mapping dictionary for DB products:
  // We want to map existing DB products to their matching catalog item.
  // Note: Only one DB product should map to a single catalog item!
  // If multiple DB products resemble the same catalog item (e.g. ID 1 "8S-6M Touch Panel", ID 32 "8 Switch" code 8S-6M, ID 48 "Touch 8 Switch" code T8S-6M),
  // which one is the authoritative matched product?
  // ID 48 has the verified 6 variants and was confirmed in the audit!
  // IDs 1, 32, 69 are duplicates/stubs!
  
  const matches = {}; // dbId -> catalogKey

  // Confirmed from audit (these have 6 variants already):
  matches[44] = 'Tactus_4';   // Touch 4 Switch (All 6A) - 2M
  matches[46] = 'Tactus_16';  // Touch 6 Switch - 4M
  matches[47] = 'Tactus_15';  // Touch 4 Switch 1 Fan Regulator - 4M
  matches[48] = 'Tactus_24';  // Touch 8 Switch - 6M
  matches[49] = 'Tactus_30';  // Touch 6 Switch 1 Fan - 6M
  matches[50] = 'Tactus_52';  // Touch 8 Switch 1 Fan - 8M (or Item 36: 6 Switch 1 Fan, wait, let's verify Item 52)
  matches[51] = 'Tactus_50';  // Touch 10 Switch - 8M
  matches[53] = 'Tactus_62';  // Touch 12 Switch 2 Fan - 12M

  // Other switch boards in DB that have matching catalog items:
  // Let's check ID 19: "Touch Door Bell" (Bell-2M) -> Tactus_1: "Touch Door Bell (Only Touch)" (2M)
  matches[19] = 'Tactus_1';

  // ID 20: "2 Switches 1 Socket" (2S1P-4M) -> Tactus_11: "Touch 2 Switch 1 Socket (6A)" (4M)
  matches[20] = 'Tactus_11';

  // ID 21: "6 Switch 1 Socket" (6S1P-6M) -> Tactus_25: "Touch 6 Switch 1 Socket (6A)" (6M)
  matches[21] = 'Tactus_25';

  // ID 22: "6 Switch 1 Socket" (6S1P-8M) -> Tactus_41: "Touch 6 Switch 1 Socket (6A)" (8M)
  matches[22] = 'Tactus_41';

  // ID 23: "8 Switch 1 Socket" (8S1P-8M) -> Tactus_42: "Touch 8 Switch 1 Socket (6A)" (8M)
  matches[23] = 'Tactus_42';

  // ID 24: "4 Switch 1 Socket" (4S1P-6M) -> Tactus_22: "Touch 4 Switch 1 Socket (6A)" (6M)
  matches[24] = 'Tactus_22';

  // ID 26: "2 Switch" (2S-2M) -> Tactus_2: "Touch 2 Switch (1-2Way)" (2M)
  matches[26] = 'Tactus_2';

  // ID 27: "12 Switch 2 Socket" (12S1P-12M) -> Tactus_64: "Touch 12 Switch 2 Socket (6A)" (12M)
  matches[27] = 'Tactus_64';

  // ID 28: "4 Switch 2 Socket" (4S2P-8M) -> Tactus_47: "Touch 4 Switch 2 Socket (6A)" (8M)
  matches[28] = 'Tactus_47';

  // ID 29: "2 Switch 2 Socket" (2S2P-6M) -> Tactus_18: "Touch 2 Switch 2 Socket (6A)" (6M)
  matches[29] = 'Tactus_18';

  // ID 30: "4 Switch" (4S-4M) -> Tactus_13: "Touch 4 Switch" (4M)
  matches[30] = 'Tactus_13';

  // ID 33: "6 Switch 1 Fan 1 Socket" (6S1F1P-8M) -> Tactus_40: "Touch 6 Switch 1 Fan 1 Socket (6A)" (8M)
  matches[33] = 'Tactus_40';

  // ID 34: "4 Switch 1 Fan 1 Socket" (4S1F1P-8M) -> Tactus_39: "Touch 4 Switch 1 Fan 1 Socket (6A)" (8M)
  matches[34] = 'Tactus_39';

  // ID 36: "6 Switch" (6S-6M) -> Tactus_23: "Touch 6 Switch" (6M)
  matches[36] = 'Tactus_23';

  // ID 38: "4 Switch 2 Socket" (4S2P-6M) -> Tactus_21: "Edge Touch 4 Switch 2 Socket (6A) (All 6A Switch)" (6M)
  matches[38] = 'Tactus_21';

  // ID 39: "8 Switch" (8S-8M) -> Tactus_37: "Touch 8 Switch" (8M)
  matches[39] = 'Tactus_37';

  // ID 41: "4 Switch 1 Socket" (4S1P-8M) -> Tactus_38: "Touch 4 Switch 1 Socket (6A)" (8M)
  matches[41] = 'Tactus_38';

  // ID 55: "4 Scene Controller" (SCN4-2M) -> Tactus_5: "Touch 4 Switch Scene Control" (2M)
  matches[55] = 'Tactus_5';

  // ID 56: "Curtain Controller (Touch)" (2T CUR-2M) -> Tactus_7: "Touch Curtain Switch" (2M)
  matches[56] = 'Tactus_7';

  // ID 17: "Zigbee Gateway" (ZB-GW01) -> Tactus_83: "Zigbee Gateway ( Ethernet Based )"
  matches[17] = 'Tactus_83';

  console.log(`=== MATCHING RESULTS ===`);
  console.log(`Matched Products: ${Object.keys(matches).length}`);
  
  const matchedCatalogKeys = new Set(Object.values(matches));

  console.log('\n--- MATCHED DB PRODUCTS ---');
  for (const idStr of Object.keys(matches)) {
    const id = parseInt(idStr, 10);
    const p = dbProducts.find(x => x._id === id);
    const cat = catalogMap.get(matches[id]);
    const vCount = dbVariants.filter(v => v.productId === p._id).length;
    console.log(`Keep & Enrich: DB [${p._id}] "${p.name}" (${p.code}) [${vCount} vars] -> Catalog [${cat.key}] "${cat.sourceDesc}" (${cat.moduleSize}) [${cat.variants.length} vars]`);
  }

  console.log('\n--- UNMATCHED DB PRODUCTS (CANDIDATES FOR DELETION) ---');
  let unmatchedVarCount = 0;
  dbProducts.filter(p => !matches[p._id]).forEach(p => {
    const pVars = dbVariants.filter(v => v.productId === p._id);
    unmatchedVarCount += pVars.length;
    let reason = '';
    if (['curtain', 'accessory', 'smart_lock', 'vdp', 'retrofit'].includes(p.type)) {
      reason = `Product type '${p.type}' is outside the touch switch/catalog dataset`;
    } else if ([1, 3, 31, 32, 35, 37, 69].includes(p._id)) {
      reason = `Redundant legacy/test duplicate of catalog product`;
    } else if ([4, 6, 7].includes(p._id)) {
      reason = `Generic legacy stub with null module and 0 variants`;
    } else if ([45, 52, 54].includes(p._id)) {
      reason = `Configuration does not exist in official 287 catalog items`;
    } else {
      reason = `Not represented in 287 catalog items`;
    }
    console.log(`Delete Candidate: DB [${p._id}] "${p.name}" | Code: "${p.code}" | Mod: "${p.moduleSize}" | Type: "${p.type}" | Vars: ${pVars.length} | Reason: ${reason}`);
  });
  console.log(`Total Unmatched Products: ${dbProducts.filter(p => !matches[p._id]).length}`);
  console.log(`Total Variants to Delete: ${unmatchedVarCount}`);

  await mongoose.disconnect();
}

run().catch(console.error);
