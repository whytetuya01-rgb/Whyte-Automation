const fs = require('fs');

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

const varRows = parseSheetXml('scratch/xlsx_extracted/xl/worksheets/sheet4.xml');
const mismatches = [];

varRows.slice(1).forEach(r => {
  const d = r.data;
  if (d.I === 'PRICE MISMATCH') {
    mismatches.push(d);
  }
});

console.log(`\n--- ALL 30 PRICE MISMATCHES ---`);
mismatches.forEach(m => {
  console.log(`VarID: ${m.A} | ProdID: ${m.B} (${m.C}) | Tier: ${m.D} | Finish: ${m.E} | Current DB: ₹${m.F} | PDF: ₹${m.G} | Notes: "${m.J}"`);
});
