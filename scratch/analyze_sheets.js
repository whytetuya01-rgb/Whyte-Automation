const fs = require('fs');
const path = require('path');

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
      rowData[col] = val
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
    }
    rows.push({ rowNum, data: rowData });
  }
  return rows;
}

const base = 'scratch/final_xlsx_extracted/xl/worksheets';
const catalogRows = parseSheetXml(path.join(base, 'sheet3.xml'));
const productReviewRows = parseSheetXml(path.join(base, 'sheet4.xml'));
const variantReviewRows = parseSheetXml(path.join(base, 'sheet5.xml'));

console.log('=== CATALOG_ROWS (Sheet 3) ANALYSIS ===');
console.log('Header:', catalogRows[0].data);
const items = catalogRows.slice(1);
console.log('Total catalog rows (excluding header):', items.length);

const familyCounts = {};
const moduleSizes = new Set();
let missingImages = 0;
let missingModuleSizes = 0;

items.forEach(r => {
  const fam = r.data['A'];
  familyCounts[fam] = (familyCounts[fam] || 0) + 1;
  const mod = r.data['F'];
  if (!mod || mod.trim() === '') missingModuleSizes++;
  else moduleSizes.add(mod.trim());
  const imgFile = r.data['N'];
  if (!imgFile || imgFile.trim() === '') missingImages++;
});

console.log('Catalog family counts:', familyCounts);
console.log('Module sizes found:', Array.from(moduleSizes));
console.log('Missing module size count:', missingModuleSizes);
console.log('Missing image file count in Sheet 3:', missingImages);

console.log('\n=== PRODUCT_REVIEW (Sheet 4) ANALYSIS ===');
console.log('Header:', productReviewRows[0].data);
const prodReviewItems = productReviewRows.slice(1);
console.log('Total product review rows:', prodReviewItems.length);

const prodCodes = [];
const catMappings = [];
const valStatusCounts = {};
prodReviewItems.forEach(r => {
  const code = r.data['I'];
  if (code && code.trim()) prodCodes.push(code.trim());
  const cat = r.data['J'];
  if (cat && cat.trim()) catMappings.push(cat.trim());
  const st = r.data['L'] || 'Empty';
  valStatusCounts[st] = (valStatusCounts[st] || 0) + 1;
});
console.log('Product codes present in Sheet 4:', prodCodes.length);
if (prodCodes.length > 0) console.log('Sample codes:', prodCodes.slice(0, 10));
console.log('Category mappings present in Sheet 4:', catMappings.length);
if (catMappings.length > 0) console.log('Sample category mappings:', catMappings.slice(0, 10));
console.log('Product Review Validation Status counts:', valStatusCounts);

console.log('\n=== VARIANT_REVIEW (Sheet 5) ANALYSIS ===');
console.log('Header:', variantReviewRows[0].data);
const varItems = variantReviewRows.slice(1);
console.log('Total variant rows:', varItems.length);
const varStatusCounts = {};
const automationTiers = new Set();
const surfaceFinishes = new Set();
let validPrices = 0;
let invalidPrices = 0;

varItems.forEach(r => {
  const st = r.data['J'] || 'Empty';
  varStatusCounts[st] = (varStatusCounts[st] || 0) + 1;
  automationTiers.add(r.data['F']);
  surfaceFinishes.add(r.data['G']);
  const parsedPrice = r.data['I'];
  if (parsedPrice && !isNaN(parseFloat(parsedPrice)) && parseFloat(parsedPrice) > 0) {
    validPrices++;
  } else {
    invalidPrices++;
  }
});
console.log('Variant Status counts:', varStatusCounts);
console.log('Automation tiers:', Array.from(automationTiers));
console.log('Surface finishes:', Array.from(surfaceFinishes));
console.log(`Variants with valid price: ${validPrices}, invalid/missing price: ${invalidPrices}`);
