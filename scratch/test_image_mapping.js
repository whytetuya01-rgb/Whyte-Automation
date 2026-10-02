const fs = require('fs');

const relsXml = fs.readFileSync('scratch/final_xlsx_extracted/xl/drawings/_rels/drawing1.xml.rels', 'utf8');
const relRegex = /<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"|<Relationship[^>]+Target="([^"]+)"[^>]+Id="([^"]+)"/g;
const relsMap = {};
let m;
while ((m = relRegex.exec(relsXml)) !== null) {
  const id = m[1] || m[4];
  const target = m[2] || m[3];
  relsMap[id] = target;
}
console.log('Parsed rels count:', Object.keys(relsMap).length);

const drawingXml = fs.readFileSync('scratch/final_xlsx_extracted/xl/drawings/drawing1.xml', 'utf8');
const anchorRegex = /<oneCellAnchor>.*?<col>(\d+)<\/col>.*?<row>(\d+)<\/row>.*?<a:blip[^>]+r:embed="([^"]+)".*?<\/oneCellAnchor>/gs;
let am;
const rowToMedia = {};
while ((am = anchorRegex.exec(drawingXml)) !== null) {
  const col = parseInt(am[1], 10);
  const row = parseInt(am[2], 10); // 0-indexed row in sheet
  const embedId = am[3];
  const target = relsMap[embedId];
  rowToMedia[row + 1] = { col, embedId, target }; // 1-indexed Excel row
}
console.log('Total anchors matched:', Object.keys(rowToMedia).length);
console.log('Sample rows mapped to media:');
for (let r = 2; r <= 6; r++) {
  console.log(`Excel Row ${r}:`, rowToMedia[r]);
}
for (let r = 284; r <= 288; r++) {
  console.log(`Excel Row ${r}:`, rowToMedia[r]);
}
