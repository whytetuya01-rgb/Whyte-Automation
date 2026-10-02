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
const catalogRows = parseSheetXml(path.join(base, 'sheet3.xml')).slice(1);
const sheet4Rows = parseSheetXml(path.join(base, 'sheet4.xml')).slice(1);

console.log('=== PRODUCT UNIQUENESS & KEYS CHECK ===');
console.log('Total catalog rows:', catalogRows.length);

// 1. Raw Base Product Names
const nameCounts = {};
catalogRows.forEach(r => {
  const name = r.data['E']?.trim();
  nameCounts[name] = (nameCounts[name] || 0) + 1;
});
const duplicateNames = Object.entries(nameCounts).filter(([_, c]) => c > 1);
console.log(`Unique base product names: ${Object.keys(nameCounts).length}`);
console.log(`Duplicate base product names count: ${duplicateNames.length}`);
console.log('Sample duplicate names across catalog rows:');
duplicateNames.slice(0, 5).forEach(([name, c]) => {
  const matches = catalogRows.filter(r => r.data['E']?.trim() === name);
  console.log(`  "${name}" appears ${c} times:`, matches.map(m => `${m.data['A']} #${m.data['B']} (${m.data['F']}M)`).join(', '));
});

// 2. Family + Item No + Name
const familyItemKeys = {};
catalogRows.forEach(r => {
  const key = `${r.data['A']} | ${r.data['B']} | ${r.data['E']?.trim()}`;
  familyItemKeys[key] = (familyItemKeys[key] || 0) + 1;
});
const dupFamilyItemKeys = Object.entries(familyItemKeys).filter(([_, c]) => c > 1);
console.log(`\nFamily + ItemNo + Name unique keys: ${Object.keys(familyItemKeys).length} (Duplicates: ${dupFamilyItemKeys.length})`);

// 3. Sheet 4 Suggested Base Product Key (Column G)
const sheet4Keys = {};
sheet4Rows.forEach(r => {
  const key = r.data['G']?.trim();
  sheet4Keys[key] = (sheet4Keys[key] || 0) + 1;
});
const dupSheet4Keys = Object.entries(sheet4Keys).filter(([_, c]) => c > 1);
console.log(`\nSheet 4 Suggested Base Product Key (Column G) count: ${Object.keys(sheet4Keys).length} (Duplicates: ${dupSheet4Keys.length})`);
if (dupSheet4Keys.length > 0) {
  console.log('Duplicate Sheet 4 keys:', dupSheet4Keys);
}
