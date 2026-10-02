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
console.log('=== PRODUCT REVIEW HEADER ===');
console.log(prodRows[0]);
console.log('=== SAMPLE PRODUCT ROWS (first 5) ===');
console.log(JSON.stringify(prodRows.slice(1, 6), null, 2));
console.log('Total product rows:', prodRows.length - 1);

const varRows = parseSheetXml('scratch/xlsx_extracted/xl/worksheets/sheet4.xml');
console.log('=== VARIANT REVIEW HEADER ===');
console.log(varRows[0]);
console.log('=== SAMPLE VARIANT ROWS (first 5) ===');
console.log(JSON.stringify(varRows.slice(1, 6), null, 2));
console.log('Total variant rows:', varRows.length - 1);

const issuesRows = parseSheetXml('scratch/xlsx_extracted/xl/worksheets/sheet5.xml');
console.log('=== SHEET 5 HEADER ===');
console.log(issuesRows[0]);
console.log('Total sheet5 rows:', issuesRows.length - 1);
