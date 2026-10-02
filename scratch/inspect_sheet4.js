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
console.log('Total variant rows:', varRows.length);

// Group by Product ID
const byProd = {};
for (let r of varRows.slice(1)) {
  const d = r.data;
  const pid = d.B;
  if (!byProd[pid]) byProd[pid] = { name: d.C, variants: [] };
  byProd[pid].variants.push({
    variantId: d.A,
    tier: d.D,
    finish: d.E,
    currentDbPrice: d.F,
    pdfPrice: d.G,
    availability: d.H,
    priceComparison: d.I,
    notes: d.J
  });
}

console.log('Products in Variant Review:', Object.keys(byProd));
console.log(JSON.stringify(byProd, null, 2));
