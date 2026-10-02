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

const rows = parseSheetXml('scratch/final_xlsx_extracted/xl/worksheets/sheet3.xml').slice(1);
const imageFiles = rows.map(r => r.data['N']);
console.log('Total image file entries in Sheet 3:', imageFiles.length);
console.log('Sample entries (first 5):', imageFiles.slice(0, 5));
console.log('Sample entries (Tactus Color, around 85):', imageFiles.slice(84, 89));
console.log('Sample entries (Tactus VLUXE, around 166):', imageFiles.slice(165, 170));
console.log('Sample entries (Tactus Color EDGE, around 215):', imageFiles.slice(214, 219));
console.log('Unique image files count:', new Set(imageFiles).size);
