import { parseHTML } from 'linkedom';

// Test: create many elements using a shared document
const { document } = parseHTML('<!DOCTYPE html><html><body></body></html>');

console.log('Starting memory test...');
const startMem = process.memoryUsage().heapUsed;

for (let i = 0; i < 100; i++) {
  const el = document.createElement('div');
  el.innerHTML = '<main><article><h1>Test</h1><p>Hello world</p><pre><code>const x = 1;\nfunction foo() { return x; }</code></pre></article></main><nav><p>Nav</p></nav>';
  
  const cloned = el.cloneNode(true);
  // stripNoise equivalent
  cloned.querySelectorAll('nav, header, footer, aside').forEach(n => n.remove());
  cloned.querySelectorAll('*').forEach(node => {
    if (node.style && node.style.display === 'none') node.remove();
  });
}

const endMem = process.memoryUsage().heapUsed;
console.log(`Done! Memory: ${Math.round(startMem / 1024 / 1024)}MB -> ${Math.round(endMem / 1024 / 1024)}MB (delta: ${Math.round((endMem - startMem) / 1024 / 1024)}MB)`);
