const fs = require('fs');
const content = fs.readFileSync('src/components/proposal-builder/StepProposalPreview.tsx', 'utf8');
const lines = content.split('\n');
console.log('Searching lines 1340 to', lines.length);
for (let i = 1340; i < lines.length; i++) {
  const line = lines[i];
  const matches = line.match(/\b(xs|sm|md|lg|xl|2xl):[a-zA-Z0-9\[\]\-]+/g);
  if (matches) {
    console.log('Line ' + (i + 1) + ': ' + matches.join(', ') + ' | ' + line.trim().slice(0, 80));
  }
}
