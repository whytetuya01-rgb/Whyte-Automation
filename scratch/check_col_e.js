const fs = require('fs');
const xml = fs.readFileSync('scratch/xlsx_extracted/xl/worksheets/sheet3.xml', 'utf8');
const cellRegex = /<c\s+r="E\d+"[^>]*>(?:<is><t>(.*?)<\/t><\/is>|<v>(.*?)<\/v>)?<\/c>/g;
let m;
let count = 0;
while ((m = cellRegex.exec(xml)) !== null) {
  const val = m[1] || m[2];
  if (val && val !== 'Rule-Based Code (where applicable)') {
    console.log('Found in Col E:', val);
    count++;
  }
}
console.log('Total non-empty non-header Col E cells:', count);
