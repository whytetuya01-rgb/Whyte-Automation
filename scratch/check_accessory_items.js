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
rows.forEach(r => {
  const fam = r.data['A'];
  const itemNo = parseInt(r.data['B'], 10);
  if (
    (fam === 'Tactus' && itemNo >= 79) ||
    (fam === 'Tactus Color' && itemNo >= 78) ||
    (fam === 'Tactus Color EDGE' && itemNo >= 69)
  ) {
    console.log(`[${fam} #${itemNo}] Desc: "${r.data['D']}" | Name: "${r.data['E']}" | Mod: "${r.data['F']}"`);
  }
});
