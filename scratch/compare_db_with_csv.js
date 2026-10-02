const fs = require('fs');
const mongoose = require('mongoose');

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  const header = parseCsvLine(lines[0]);
  // clean BOM
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

async function run() {
  await mongoose.connect('mongodb://127.0.0.1:27017/whyte_quotation');
  const db = mongoose.connection.db;

  const categories = await db.collection('categories').find({}).toArray();
  const dbProducts = await db.collection('products').find({}).sort({ _id: 1 }).toArray();
  const dbVariants = await db.collection('productvariants').find({}).sort({ _id: 1 }).toArray();

  console.log(`=== DB TOTALS ===`);
  console.log(`Categories: ${categories.length}`);
  categories.forEach(c => console.log(`  ID ${c._id}: ${c.name} (${c.slug || ''})`));
  console.log(`Products: ${dbProducts.length}`);
  console.log(`ProductVariants: ${dbVariants.length}`);

  // Parse CSV
  const csvContent = fs.readFileSync('c:\\Project\\whyte-quotation\\Whyte_2026_MongoDB_Catalog_Import.csv', 'utf8');
  const { rows } = parseCsv(csvContent);

  // Group CSV by Base Product: catalog_family + '_' + catalog_item_no
  const catalogProducts = new Map();
  for (const r of rows) {
    const key = `${r.catalog_family}_${r.catalog_item_no}`;
    if (!catalogProducts.has(key)) {
      catalogProducts.set(key, {
        catalog_family: r.catalog_family,
        catalog_item_no: r.catalog_item_no,
        source_page: r.source_page,
        source_product_description: r.source_product_description,
        base_product_name: r.base_product_name,
        module_size: r.module_size,
        variants: []
      });
    }
    catalogProducts.get(key).variants.push({
      automation_tier: r.automation_tier,
      surface_finish: r.surface_finish,
      price_inr: parseFloat(r.price_inr),
      availability_status: r.availability_status
    });
  }

  console.log(`\n=== CATALOG BASE PRODUCTS: ${catalogProducts.size} ===`);

  // Let's examine existing DB products
  console.log(`\n=== EXISTING DB PRODUCTS (first 15) ===`);
  dbProducts.slice(0, 15).forEach(p => {
    console.log(`ID: ${p._id} | Code: "${p.code}" | Name: "${p.name}" | Mod: "${p.moduleSize}" | Type: "${p.type}" | Tier: "${p.automationTier}" | Finish: "${p.surfaceFinish}"`);
  });

  // Check how DB products are structured (are some variants embedded in products? What types?)
  const typesCount = {};
  dbProducts.forEach(p => {
    typesCount[p.type] = (typesCount[p.type] || 0) + 1;
  });
  console.log('DB Product Types distribution:', typesCount);

  // Check how variants link to products
  const variantsByProd = {};
  dbVariants.forEach(v => {
    variantsByProd[v.productId] = (variantsByProd[v.productId] || 0) + 1;
  });
  console.log(`Products with variants: ${Object.keys(variantsByProd).length}`);
  console.log(`Products without variants: ${dbProducts.filter(p => !variantsByProd[p._id]).length}`);

  await mongoose.disconnect();
}

run().catch(console.error);
