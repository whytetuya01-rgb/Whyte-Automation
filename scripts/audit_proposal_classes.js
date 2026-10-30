const fs = require('fs');
const content = fs.readFileSync('src/components/proposal-builder/StepProposalPreview.tsx', 'utf8');

const pageStartIdx = content.indexOf('className="proposal-page');
const pageSection = content.slice(pageStartIdx);

const matches = pageSection.match(/(sm|md|lg|xl|2xl):[^\s"'`]+/g);
console.log('Responsive classes inside proposal pages:', matches);
