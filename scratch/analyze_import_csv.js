const fs = require('fs');

const csvPath = 'c:\\Project\\whyte-quotation\\Whyte_2026_MongoDB_Catalog_Import.csv';
const content = fs.readFileSync(csvPath, 'utf8');

// Parse CSV lines handling potential quotes
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  const header = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    const obj = {};
    header.forEach((h, idx) => {
      obj[h.trim()] = vals[idx] !== undefined ? vals[idx].trim() : '';
    });
    rows.push({ rowIdx: i + 1, data: obj });
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

const { header, rows } = parseCsv(content);

console.log('Headers:', header);
console.log('Total expanded rows:', rows.length);

// Analyze unique catalog families, items, base products
const families = new Set();
const catalogItems = new Set(); // catalog_family + '_' + catalog_item_no
const baseProductGroups = new Map(); // key -> list of rows
const availStatuses = new Set();

rows.forEach(r => {
  const d = r.data;
  families.add(d.catalog_family);
  catalogItems.add(`${d.catalog_family}_${d.catalog_item_no}`);
  availStatuses.add(d.availability_status);

  // Group key: catalog_family + '||' + base_product_name + '||' + module_size
  const groupKey = `${d.catalog_family}||${d.base_product_name}||${d.module_size}||${d.source_product_description}`;
  if (!baseProductGroups.has(groupKey)) {
    baseProductGroups.set(groupKey, []);
  }
  baseProductGroups.get(groupKey).push(d);
});

console.log('Unique catalog families:', Array.from(families));
console.log('Unique catalog_family + catalog_item_no (Base catalog items):', catalogItems.size);
console.log('Unique base product groups:', baseProductGroups.size);
console.log('Availability statuses:', Array.from(availStatuses));

// Check availability breakdown
let availableCount = 0;
let unavailableCount = 0;
rows.forEach(r => {
  const s = r.data.availability_status.toLowerCase();
  if (s === 'available') availableCount++;
  else unavailableCount++;
});
console.log(`Available variant rows: ${availableCount}, Unavailable/Review variant rows: ${unavailableCount}`);
