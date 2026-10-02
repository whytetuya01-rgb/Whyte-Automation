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

// 1. Ensure target dirs exist
const dataImgDir = path.resolve('data/whyte_catalog_images');
const publicImgDir = path.resolve('public/whyte_catalog_images');
fs.mkdirSync(dataImgDir, { recursive: true });
fs.mkdirSync(publicImgDir, { recursive: true });

// 2. Read rows from Sheet 3
const rows = parseSheetXml('scratch/final_xlsx_extracted/xl/worksheets/sheet3.xml').slice(1);
console.log(`Processing ${rows.length} catalog rows for image export...`);

const mediaDir = path.resolve('scratch/final_xlsx_extracted/xl/media');
let copied = 0;
let errors = 0;

rows.forEach((r, idx) => {
  const mediaIndex = idx + 1; // image1.jpeg .. image287.jpeg
  const srcFile = path.join(mediaDir, `image${mediaIndex}.jpeg`);
  const relPath = r.data['N']; // e.g. "whyte_catalog_images/Tactus_item_001.jpg"
  const fileName = path.basename(relPath);

  if (!fs.existsSync(srcFile)) {
    console.error(`Missing source media file: ${srcFile} for row ${r.rowNum}`);
    errors++;
    return;
  }

  const targetDataFile = path.join(dataImgDir, fileName);
  const targetPublicFile = path.join(publicImgDir, fileName);

  const buf = fs.readFileSync(srcFile);
  fs.writeFileSync(targetDataFile, buf);
  fs.writeFileSync(targetPublicFile, buf);
  copied++;
});

console.log(`Successfully extracted and deployed ${copied} images (Errors: ${errors}).`);
console.log(`Data images dir: ${dataImgDir} (${fs.readdirSync(dataImgDir).length} files)`);
console.log(`Public images dir: ${publicImgDir} (${fs.readdirSync(publicImgDir).length} files)`);
