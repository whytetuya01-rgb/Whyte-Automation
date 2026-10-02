const fs = require('fs');

const relsXml = fs.readFileSync('scratch/final_xlsx_extracted/xl/drawings/_rels/drawing1.xml.rels', 'utf8');
console.log('Sample rels (first 500 chars):');
console.log(relsXml.substring(0, 500));

// parse rels: id -> target
const relsMap = {};
const relRegex = /<Relationship\s+Id="([^"]+)"[^>]*Target="([^"]+)"/g;
let match;
while ((match = relRegex.exec(relsXml)) !== null) {
  relsMap[match[1]] = match[2];
}
console.log('Total relationships in drawing1.xml.rels:', Object.keys(relsMap).length);

// Now inspect drawing1.xml to see anchors (row, col -> r:embed)
const drawingXml = fs.readFileSync('scratch/final_xlsx_extracted/xl/drawings/drawing1.xml', 'utf8');
console.log('\nSample drawing1.xml (first 1000 chars):');
console.log(drawingXml.substring(0, 1000));

// Let's parse twoCellAnchor / oneCellAnchor
// Look for <xdr:from><xdr:col>..</xdr:col><xdr:row>..</xdr:row> and <a:blip r:embed=".."/>
const anchorRegex = /<xdr:twoCellAnchor[^>]*>.*?<xdr:from>\s*<xdr:col>(\d+)<\/xdr:col>.*?<xdr:row>(\d+)<\/xdr:row>.*?<a:blip[^>]*r:embed="([^"]+)".*?<\/xdr:twoCellAnchor>/gs;
let anchorMatch;
const anchors = [];
while ((anchorMatch = anchorRegex.exec(drawingXml)) !== null) {
  const col = parseInt(anchorMatch[1], 10);
  const row = parseInt(anchorMatch[2], 10);
  const embedId = anchorMatch[3];
  const target = relsMap[embedId];
  anchors.push({ row, col, embedId, target });
}
console.log('Total twoCellAnchors parsed:', anchors.length);
if (anchors.length > 0) {
  console.log('Sample anchors (first 5):', anchors.slice(0, 5));
}
