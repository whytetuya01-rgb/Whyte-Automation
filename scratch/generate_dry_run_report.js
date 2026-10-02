const fs = require('fs');
const mongoose = require('mongoose');

function parseSheetXml(xmlPath) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const rows = [];
  const rowRegex = /<row\s+r="(\d+)"[^>]*>(.*?)<\/row>/gs;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const rowNum = parseInt(rowMatch[1], 10);
    const rowContent = rowMatch[2];
    const cellRegex = /<c\s+r="([A-Z]+)\d+"[^>]*(?:t="([^"]+)")?[^>]*>(?:<is><t>(.*?)<\/t><\/is>|<v>(.*?)<\/v>)?<\/c>/gs;
    let cellMatch;
    const rowData = {};
    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      const col = cellMatch[1];
      const val = cellMatch[3] !== undefined ? cellMatch[3] : (cellMatch[4] !== undefined ? cellMatch[4] : '');
      rowData[col] = val;
    }
    rows.push({ rowNum, data: rowData });
  }
  return rows;
}

async function run() {
  await mongoose.connect('mongodb://127.0.0.1:27017/whyte_quotation');
  const db = mongoose.connection.db;

  const dbProducts = await db.collection('products').find({}).sort({ _id: 1 }).toArray();
  const dbVariants = await db.collection('productvariants').find({}).sort({ _id: 1 }).toArray();

  const excelProducts = parseSheetXml('scratch/xlsx_extracted/xl/worksheets/sheet3.xml').slice(1);
  const excelVariants = parseSheetXml('scratch/xlsx_extracted/xl/worksheets/sheet4.xml').slice(1);

  // Map excel products by ID
  const excelProdMap = {};
  for (let r of excelProducts) {
    excelProdMap[Number(r.data.A)] = r.data;
  }

  // Map excel variants by ID
  const excelVarMap = {};
  for (let r of excelVariants) {
    excelVarMap[Number(r.data.A)] = r.data;
  }

  console.log(`=== DATABASE TOTALS ===`);
  console.log(`Total Products in DB: ${dbProducts.length}`);
  console.log(`Total ProductVariants in DB: ${dbVariants.length}`);
  console.log(`Total Products in Excel: ${excelProducts.length}`);
  console.log(`Total Variants in Excel: ${excelVariants.length}`);

  // Product categories from DB
  const matchedProds = [];
  const reviewProds = [];
  const notInPdfProds = [];
  const dbOnlyProds = [];

  for (let p of dbProducts) {
    const ep = excelProdMap[p._id];
    if (!ep) {
      dbOnlyProds.push(p);
      continue;
    }
    const status = ep.I;
    if (status === 'Verified against supplied Tactus PDF') {
      matchedProds.push({ db: p, excel: ep });
    } else if (status === 'Needs review - no exact source match') {
      reviewProds.push({ db: p, excel: ep });
    } else {
      notInPdfProds.push({ db: p, excel: ep });
    }
  }

  // Variants analysis
  const matchedVariants = [];
  const mismatchVariants = [];
  const notVerifiedVariants = [];
  const dbOnlyVariants = [];

  for (let v of dbVariants) {
    const ev = excelVarMap[v._id];
    if (!ev) {
      dbOnlyVariants.push(v);
      continue;
    }
    const comp = ev.I;
    if (comp === 'MATCH') {
      matchedVariants.push({ db: v, excel: ev });
    } else if (comp === 'PRICE MISMATCH') {
      mismatchVariants.push({ db: v, excel: ev });
    } else {
      notVerifiedVariants.push({ db: v, excel: ev });
    }
  }

  console.log(`\n=== PRODUCT MATCHING BREAKDOWN ===`);
  console.log(`Products Verified against PDF: ${matchedProds.length}`);
  console.log(`Products Needing Review: ${reviewProds.length}`);
  console.log(`Products Not in PDF: ${notInPdfProds.length}`);
  console.log(`Products in DB not in Excel: ${dbOnlyProds.length} (IDs: ${dbOnlyProds.map(p => p._id).join(', ')})`);

  console.log(`\n=== VARIANT MATCHING BREAKDOWN ===`);
  console.log(`Variants Verified (Price MATCH): ${matchedVariants.length}`);
  console.log(`Variants Price Mismatch (Require Review): ${mismatchVariants.length}`);
  console.log(`Variants Not Verified (Product Not Matched): ${notVerifiedVariants.length}`);
  console.log(`Variants in DB not in Excel: ${dbOnlyVariants.length} (IDs: ${dbOnlyVariants.map(v => v._id).join(', ')})`);

  console.log(`\n=== DETAILED VERIFIED PRODUCTS ===`);
  for (let item of matchedProds) {
    console.log(`ID: ${item.db._id} | DB Name: "${item.db.name}" | PDF Desc: "${item.excel.G}" | DB Code: "${item.db.code}" | DB Mod: "${item.db.moduleSize}" | PDF Mod: "${item.excel.H}"`);
  }

  console.log(`\n=== DETAILED REVIEW PRODUCTS ===`);
  for (let item of reviewProds) {
    console.log(`ID: ${item.db._id} | DB Name: "${item.db.name}" | DB Code: "${item.db.code}" | Status: "${item.excel.I}"`);
  }

  await mongoose.disconnect();
}

run().catch(console.error);
