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

// Normalization function for product names / descriptions
function normalize(str) {
  if (!str) return '';
  return str.toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

  const catalogList = Array.from(catalogMap.values());
  console.log(`Total Catalog Base Products: ${catalogList.length}`);

  // Print all 57 DB products with details
  console.log(`\n=== ALL 57 MONGODB PRODUCTS ===`);
  for (const p of dbProducts) {
    const pVariants = dbVariants.filter(v => v.productId === p._id);
    console.log(`ID: ${p._id} | Code: "${p.code}" | Name: "${p.name}" | Mod: "${p.moduleSize}" | Type: "${p.type}" | Variants: ${pVariants.length}`);
  }

  await mongoose.disconnect();
}

run().catch(console.error);
