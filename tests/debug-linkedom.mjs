import { parseHTML } from 'linkedom';

const STRIP_SELECTORS = [
  'script', 'style', 'noscript', 'iframe', 'svg',
  'nav', 'header', 'footer',
  '.sidebar', '.side-bar', '[class*="sidebar"]', '[id*="sidebar"]',
  '.ads', '.advertisement', '[class*="ad-"]', '[id*="ad-"]',
  '.cookie', '[class*="cookie"]', '[class*="banner"]',
  '.modal', '.overlay', '.popup',
  '.breadcrumb', '[class*="breadcrumb"]',
  '.toc', '[class*="table-of-contents"]',
  '.social-share', '[class*="share"]',
  '.comment', '[class*="comments"]',
  '.related', '[class*="related-"]',
  '.newsletter', '[class*="newsletter"]',
  'aside',
];

const html = '<main><article><h1>hello</h1><p>world</p></article></main><nav><p>Nav</p></nav><footer><p>Foot</p></footer><div style="display: none"><p>Hidden</p></div>';

console.log('Starting...');
const { document } = parseHTML('<!DOCTYPE html><html><body>' + html + '</body></html>');
const body = document.querySelector('body');
console.log('Parsed, body children:', body.childNodes.length);

const cloned = body.cloneNode(true);
console.log('Cloned, elements:', cloned.querySelectorAll('*').length);

console.log('Running stripNoise...');
for (let i = 0; i < STRIP_SELECTORS.length; i++) {
  const sel = STRIP_SELECTORS[i];
  try {
    const nodes = cloned.querySelectorAll(sel);
    console.log(`  ${sel}: found ${nodes.length}`);
    nodes.forEach(n => n.remove());
  } catch (e) {
    console.log(`  ${sel}: ERROR ${e.message}`);
  }
}

console.log('Running querySelectorAll("*")...');
const allNodes = cloned.querySelectorAll('*');
console.log('  Total nodes:', allNodes.length);
allNodes.forEach(node => {
  if (node.style && (node.style.display === 'none' || node.style.visibility === 'hidden')) {
    node.remove();
  }
});

console.log('Done! Remaining elements:', cloned.querySelectorAll('*').length);
console.log('Article text:', cloned.querySelector('article')?.textContent);
