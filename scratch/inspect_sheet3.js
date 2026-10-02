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

const prodRows = parseSheetXml('scratch/xlsx_extracted/xl/worksheets/sheet3.xml');
console.log('--- ALL PRODUCTS IN SHEET 3 ---');
prodRows.forEach(r => {
  const d = r.data;
  console.log(`Row ${r.rowNum}: ID=${d.A} | Code="${d.B}" | RuleCode="${d.E}" | PDFItem="${d.F}" | PDFDesc="${d.G}" | PDFMod="${d.H}" | Status="${d.I}" | Notes="${d.J}"`);
});
