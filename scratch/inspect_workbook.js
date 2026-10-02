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
      // Unescape XML entities
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

// 1. README (sheet1)
console.log('=== SHEET 1: README ===');
const s1 = parseSheetXml(path.join(base, 'sheet1.xml'));
s1.forEach(r => console.log(`Row ${r.rowNum}:`, Object.values(r.data).join(' | ')));

// 2. Summary (sheet2)
console.log('\n=== SHEET 2: Summary ===');
const s2 = parseSheetXml(path.join(base, 'sheet2.xml'));
s2.forEach(r => console.log(`Row ${r.rowNum}:`, Object.values(r.data).join(' | ')));

// 3. Catalog_Rows (sheet3)
console.log('\n=== SHEET 3: Catalog_Rows (first row & count) ===');
const s3 = parseSheetXml(path.join(base, 'sheet3.xml'));
console.log('Total rows:', s3.length);
console.log('Header:', s3[0].data);
console.log('Row 2 sample:', s3[1]?.data);

// 4. Product_Review (sheet4)
console.log('\n=== SHEET 4: Product_Review (first row & count) ===');
const s4 = parseSheetXml(path.join(base, 'sheet4.xml'));
console.log('Total rows:', s4.length);
console.log('Header:', s4[0].data);
console.log('Row 2 sample:', s4[1]?.data);

// 5. Variant_Review (sheet5)
console.log('\n=== SHEET 5: Variant_Review (first row & count) ===');
const s5 = parseSheetXml(path.join(base, 'sheet5.xml'));
console.log('Total rows:', s5.length);
console.log('Header:', s5[0].data);
console.log('Row 2 sample:', s5[1]?.data);

// 6. Issues_To_Review (sheet6)
console.log('\n=== SHEET 6: Issues_To_Review (first row & count) ===');
const s6 = parseSheetXml(path.join(base, 'sheet6.xml'));
console.log('Total rows:', s6.length);
console.log('Header:', s6[0].data);
console.log('Row 2 sample:', s6[1]?.data);

// 7. Source_Files (sheet7)
console.log('\n=== SHEET 7: Source_Files ===');
const s7 = parseSheetXml(path.join(base, 'sheet7.xml'));
s7.forEach(r => console.log(`Row ${r.rowNum}:`, Object.values(r.data).join(' | ')));
