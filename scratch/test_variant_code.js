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

const varRows = parseSheetXml('scratch/final_xlsx_extracted/xl/worksheets/sheet5.xml').slice(1);
const availableVars = varRows.filter(r => r.data['J'] === 'Available');

function getFamilyPrefix(fam) {
  switch (fam) {
    case 'Tactus': return 'TAC';
    case 'Tactus Color': return 'TC';
    case 'Tactus Color EDGE': return 'TCE';
    case 'Tactus VLUXE': return 'TVL';
    default: return fam.toUpperCase().replace(/\s+/g, '');
  }
}

function getModStr(mod) {
  if (!mod || mod === 'NA') return 'NA';
  const m = String(mod).trim().toUpperCase();
  if (m === '8 SQ.' || m === '8SQ') return '8SQ';
  if (/^\d+$/.test(m)) return `${m}M`;
  return m.replace(/\s+/g, '');
}

function getAutoAbbr(auto) {
  switch ((auto || '').toLowerCase()) {
    case 'remote': return 'RE';
    case 'wifi': return 'WH';
    case 'zigbee': return 'ZB';
    default: return (auto || '').toUpperCase().slice(0, 2);
  }
}

function getFinishAbbr(finish) {
  switch ((finish || '').toLowerCase()) {
    case 'acrylic': return 'A';
    case 'glass': return 'G';
    default: return (finish || '').toUpperCase().slice(0, 1);
  }
}

const codes = new Set();
const duplicates = [];

availableVars.forEach(r => {
  const fam = r.data['A'];
  const itemNo = String(r.data['B']).padStart(3, '0');
  const mod = getModStr(r.data['E']);
  const auto = getAutoAbbr(r.data['F']);
  const finish = getFinishAbbr(r.data['G']);

  const vCode = `${getFamilyPrefix(fam)}-${itemNo}-${mod}-${auto}-${finish}`;
  if (codes.has(vCode)) duplicates.push(vCode);
  codes.add(vCode);
});

console.log(`Available variants: ${availableVars.length}`);
console.log(`Unique variantCodes generated: ${codes.size}`);
console.log(`Duplicate variantCodes: ${duplicates.length}`);
console.log('\nSample variant codes:');
Array.from(codes).slice(0, 10).forEach(c => console.log(c));
Array.from(codes).slice(500, 506).forEach(c => console.log(c));
