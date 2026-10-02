const fs = require('fs');

function inspect(file) {
  console.log('=== Inspecting:', file);
  const text = fs.readFileSync(file, 'utf8');
  const imgs = [];
  const imgRegex = /<img[^>]+src=["']([^"']+)["']/g;
  let match;
  while ((match = imgRegex.exec(text)) !== null) {
    imgs.push(match[1]);
  }
  console.log('Unique Images:', Array.from(new Set(imgs)).filter(url => !url.includes('gravatar') && !url.includes('google')));

  const hRegex = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/g;
  const headings = [];
  while ((match = hRegex.exec(text)) !== null) {
    headings.push(match[1].replace(/<[^>]+>/g, '').trim());
  }
  console.log('Headings:', headings);

  // Look for features / texts
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/g;
  const paragraphs = [];
  while ((match = pRegex.exec(text)) !== null) {
    const p = match[1].replace(/<[^>]+>/g, '').trim();
    if (p.length > 20) paragraphs.push(p);
  }
  console.log('Sample Paragraphs:', paragraphs.slice(0, 10));
}

try {
  inspect('C:/Users/ADMIN/.gemini/antigravity-ide/brain/eae40b17-8f0d-4601-8990-c3d342101f39/.system_generated/steps/2067/content.md');
} catch (e) { console.error('Error 2067', e.message); }

try {
  inspect('C:/Users/ADMIN/.gemini/antigravity-ide/brain/eae40b17-8f0d-4601-8990-c3d342101f39/.system_generated/steps/2079/content.md');
} catch (e) { console.error('Error 2079', e.message); }
