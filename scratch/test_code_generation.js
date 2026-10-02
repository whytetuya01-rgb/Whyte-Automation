const fs = require('fs');

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
  catalogMap.get(key).variants.push(r);
});

console.log(`Loaded ${catalogMap.size} catalog items.`);

// Let's create deterministic product code generation:
// Prefix:
// Tactus -> 'TAC'
// Tactus Color -> 'TC'
// Tactus Color EDGE -> 'TCE'
// Tactus VLUXE -> 'TVL'
// Format: PREFIX-ITEMNO-[MODULE]M or descriptive code

function generateProductCode(item) {
  let prefix = 'TAC';
  if (item.family === 'Tactus Color') prefix = 'TC';
  else if (item.family === 'Tactus Color EDGE') prefix = 'TCE';
  else if (item.family === 'Tactus VLUXE') prefix = 'TVL';

  // Format module: e.g. "2" -> "2M", "8 SQ." -> "8SQ", "12" -> "12M"
  let modStr = '';
  if (item.moduleSize) {
    const m = String(item.moduleSize).trim().toUpperCase();
    if (m === '8 SQ.' || m === '8SQ') modStr = '-8SQ';
    else if (/^\d+$/.test(m)) modStr = `-${m}M`;
    else modStr = `-${m.replace(/\s+/g, '')}`;
  }

  // Derive compact descriptive token from sourceDesc or baseName
  // e.g. "Touch 4 Switch 1 Fan Regulator" -> "4S1F"
  // "Touch 2 Switch 1 Socket (6A)" -> "2S1P"
  // "Touch Door Bell" -> "BELL"
  // "Curtain Switch" -> "CURT"
  // "Zigbee Gateway ( Ethernet Based )" -> "GW-ETH"
  // "Remote R1-R2" -> "RMT"

  // To guarantee 100% uniqueness and zero collision:
  // Use format: `${prefix}-${item.itemNo.toString().padStart(2, '0')}${modStr}` or descriptive
  // Let's check:
  return `${prefix}-${item.itemNo.toString().padStart(2, '0')}${modStr}`;
}

const codes = new Set();
const duplicateCodes = [];
catalogMap.forEach((item) => {
  const code = generateProductCode(item);
  item.generatedCode = code;
  if (codes.has(code)) duplicateCodes.push(code);
  codes.add(code);
});

console.log(`Unique codes generated: ${codes.size} / ${catalogMap.size}`);
console.log('Duplicates:', duplicateCodes);
console.log('\nSample codes:');
Array.from(catalogMap.values()).slice(0, 10).forEach(i => {
  console.log(`${i.key} -> Code: ${i.generatedCode} | "${i.sourceDesc}" (${i.moduleSize})`);
});
Array.from(catalogMap.values()).slice(85, 95).forEach(i => {
  console.log(`${i.key} -> Code: ${i.generatedCode} | "${i.sourceDesc}" (${i.moduleSize})`);
});
