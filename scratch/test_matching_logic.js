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

function norm(str) {
  if (!str) return '';
  return str.toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function normalizeMod(mod) {
  if (!mod) return '';
  const m = String(mod).toUpperCase().trim();
  if (m === '8 SQ.' || m === '8SQ' || m === '8 SQ') return '8SQ';
  return m.replace(/[^0-9A-Z]/g, '');
}

async function run() {
  await mongoose.connect('mongodb://127.0.0.1:27017/whyte_quotation');
  const db = mongoose.connection.db;

  const dbProducts = await db.collection('products').find({}).sort({ _id: 1 }).toArray();
  const dbVariants = await db.collection('productvariants').find({}).sort({ _id: 1 }).toArray();

  const csvContent = fs.readFileSync('c:\\Project\\whyte-quotation\\Whyte_2026_MongoDB_Catalog_Import.csv', 'utf8');
  const { rows } = parseCsv(csvContent);

  // Group 287 catalog products
  const catalogProducts = [];
  const catalogMap = new Map();

  rows.forEach(r => {
    const key = `${r.catalog_family}_${r.catalog_item_no}`;
    if (!catalogMap.has(key)) {
      const item = {
        key,
        family: r.catalog_family,
        itemNo: parseInt(r.catalog_item_no, 10),
        page: r.source_page,
        sourceDesc: r.source_product_description,
        baseName: r.base_product_name,
        moduleSize: r.module_size,
        variants: []
      };
      catalogMap.set(key, item);
      catalogProducts.push(item);
    }
    catalogMap.get(key).variants.push({
      tier: r.automation_tier,
      finish: r.surface_finish,
      price: parseFloat(r.price_inr),
      status: r.availability_status
    });
  });

  console.log(`Loaded ${catalogProducts.length} Base Products from CSV.`);

  // Analyze matching against DB products
  // In the previous audit:
  // Products 44, 46, 47, 48, 49, 50, 51, 53 were confirmed Tactus products!
  // What about other products in DB?
  // Let's test matching criteria:
  // 1. Exact catalog reference or confirmed mapping
  // 2. Name + module matching
  // 3. Code matching

  const matched = [];
  const unmatched = [];

  for (const p of dbProducts) {
    let match = null;
    let matchReason = '';

    // Check specific known confirmed Tactus items from earlier audit:
    // ID 44 -> Tactus Item 4: "Touch 4 Switch (All 6A Switch)" - 2M
    // ID 46 -> Tactus Item 16: "Touch 6 Switch" - 4M
    // ID 47 -> Tactus Item 15: "Touch 4 Switch 1 Fan Regulator" - 4M
    // ID 48 -> Tactus Item 24: "Touch 8 Switch" - 6M
    // ID 49 -> Tactus Item 30: "Touch 6 Switch 1 Fan" - 6M
    // ID 50 -> Tactus Item 52: "Touch 8 Switch 1 Fan" - 8M (Wait, or 36?)
    // ID 51 -> Tactus Item 50: "Touch 10 Switch" - 8M
    // ID 53 -> Tactus Item 62: "Touch 12 Switch 2 Fan" - 12M

    // Let's test matching for each product:
    // Look in Tactus family first for standard Tactus products
    for (const c of catalogProducts) {
      // 1. Direct family + itemNo check if stored in notes / excelRef
      // 2. Normalized sourceDesc or baseName + moduleSize
      const cNormDesc = norm(c.sourceDesc);
      const cNormBase = norm(c.baseName);
      const pNormName = norm(p.name);
      const pNormDesc = norm(p.description);

      const pMod = normalizeMod(p.moduleSize);
      const cMod = normalizeMod(c.moduleSize);

      // Check if module matches or pMod is null
      const modMatches = (!pMod || pMod === cMod);

      // Check name match in same family
      // If DB product doesn't specify family, default is Tactus (Standard)
      if (c.family === 'Tactus') {
        if (p._id === 44 && c.itemNo === 4) { match = c; matchReason = 'Confirmed Item 4'; break; }
        if (p._id === 46 && c.itemNo === 16) { match = c; matchReason = 'Confirmed Item 16'; break; }
        if (p._id === 47 && c.itemNo === 15) { match = c; matchReason = 'Confirmed Item 15'; break; }
        if (p._id === 48 && c.itemNo === 24) { match = c; matchReason = 'Confirmed Item 24'; break; }
        if (p._id === 49 && c.itemNo === 30) { match = c; matchReason = 'Confirmed Item 30'; break; }
        if (p._id === 50 && c.itemNo === 52) { match = c; matchReason = 'Confirmed Item 52'; break; }
        if (p._id === 51 && c.itemNo === 50) { match = c; matchReason = 'Confirmed Item 50'; break; }
        if (p._id === 53 && c.itemNo === 62) { match = c; matchReason = 'Confirmed Item 62'; break; }

        // Also check IDs 45, 52, 54, 55, 56, 19, 17, 85 etc.
        // ID 19: "Touch Door Bell", code "Bell-2M" -> Tactus Item 1: "Touch Door Bell (Only Touch)" - 2M
        if (p._id === 19 && c.itemNo === 1) { match = c; matchReason = 'Touch Door Bell 2M'; break; }
        // ID 17: "Zigbee Gateway", code "ZB-GW01" -> Tactus Item 83: "Zigbee Gateway ( Ethernet Based )"
        if (p._id === 17 && c.itemNo === 83) { match = c; matchReason = 'Zigbee Gateway Ethernet'; break; }
        // ID 55: "4 Scene Controller", code "SCN4-2M", 2M -> Tactus Item 5: "Touch 4 Switch Scene Control" - 2M
        if (p._id === 55 && c.itemNo === 5) { match = c; matchReason = '4 Scene Controller 2M'; break; }
        // ID 56: "Curtain Controller (Touch)", code "2T CUR-2M", 2M -> Tactus Item 7: "Touch Curtain Switch" - 2M
        if (p._id === 56 && c.itemNo === 7) { match = c; matchReason = 'Touch Curtain Switch 2M'; break; }
      }
    }

    if (match) {
      matched.push({ product: p, match, reason: matchReason });
    } else {
      unmatched.push(p);
    }
  }

  console.log(`\nMatched Products: ${matched.length}`);
  matched.forEach(m => {
    console.log(`  DB [${m.product._id}] "${m.product.name}" (${m.product.code}) -> Catalog [${m.match.key}] "${m.match.sourceDesc}" (${m.reason})`);
  });

  console.log(`\nUnmatched Products: ${unmatched.length}`);
  unmatched.forEach(p => {
    const vCount = dbVariants.filter(v => v.productId === p._id).length;
    console.log(`  DB [${p._id}] "${p.name}" | Code: "${p.code}" | Mod: "${p.moduleSize}" | Type: "${p.type}" | Variants: ${vCount}`);
  });

  await mongoose.disconnect();
}

run().catch(console.error);
