/**
 * Direct runner for preservation tests - bypasses vitest worker memory issues
 */
import { parseHTML } from 'linkedom';
import * as fc from 'fast-check';

const MAX_NODE_COUNT = 50000;

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
  '[style*="display: none"]',
  '[style*="display:none"]',
  '[style*="visibility: hidden"]',
  '[style*="visibility:hidden"]',
];

const CONTENT_SELECTORS = [
  'main article', 'article[class*="content"]', '[role="main"] article',
  '[role="main"]', 'main', 'article', '.markdown-body', '.prose',
  '[class*="article-body"]', '[class*="post-content"]',
  '[class*="entry-content"]', '[class*="page-content"]',
  '[class*="doc-content"]', '[id*="main-content"]',
  '[id*="content"]', '.content', '#content',
];

function stripNoise(el) {
  STRIP_SELECTORS.forEach(sel => {
    try { el.querySelectorAll(sel).forEach(n => n.remove()); } catch (_) {}
  });
}

function detectCodeLanguage(el) {
  if (!el) return '';
  const cls = (el.className || '') + ' ' + (el.parentElement ? el.parentElement.className || '' : '');
  const match = cls.match(/language-(\w+)|lang-(\w+)|(\w+)-code/);
  if (match) return match[1] || match[2] || match[3];
  const code = el.textContent || '';
  if (/^\s*(import |from |def |class |if __name__)/.test(code)) return 'python';
  if (/^\s*(const |let |var |function |=>|require\()/.test(code)) return 'javascript';
  return '';
}

function domToMarkdown(el) {
  const lines = [];
  const visited = new WeakSet();
  function walk(node) {
    if (!node || visited.has(node)) return;
    visited.add(node);
    if (node.nodeType === 3) {
      const text = node.textContent.replace(/\s+/g, ' ').trim();
      if (text) lines.push(text);
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (node.style && (node.style.display === 'none' || node.style.visibility === 'hidden')) return;
    switch (tag) {
      case 'h1': lines.push('\n# ' + node.textContent.trim() + '\n'); return;
      case 'h2': lines.push('\n## ' + node.textContent.trim() + '\n'); return;
      case 'h3': lines.push('\n### ' + node.textContent.trim() + '\n'); return;
      case 'p': lines.push('\n' + node.textContent.trim() + '\n'); return;
      case 'pre': {
        const codeEl = node.querySelector('code');
        const lang = detectCodeLanguage(codeEl || node);
        const code = (codeEl || node).textContent;
        lines.push('\n```' + lang + '\n' + code + '\n```\n');
        return;
      }
      case 'a': {
        const href = node.getAttribute('href') || '';
        const text = node.textContent.trim();
        if (text) lines.push(href ? '[' + text + '](' + href + ')' : text);
        return;
      }
      case 'ul': case 'ol':
        node.querySelectorAll(':scope > li').forEach((li, i) => {
          const prefix = tag === 'ul' ? '- ' : (i + 1) + '. ';
          lines.push(prefix + li.textContent.trim().replace(/\n+/g, ' '));
        });
        lines.push('');
        return;
      default:
        node.childNodes.forEach(child => walk(child));
    }
  }
  el.childNodes.forEach(child => walk(child));
  return lines.join(' ').replace(/ {2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function extractCodeBlocks(el) {
  const blocks = [];
  el.querySelectorAll('pre').forEach(pre => {
    const codeEl = pre.querySelector('code');
    const language = detectCodeLanguage(codeEl || pre);
    const code = (codeEl || pre).textContent.trim();
    if (code.length > 10) blocks.push({ language, code, lines: code.split('\n').length });
  });
  return blocks;
}

function runExtraction(bodyHTML) {
  const { document: doc } = parseHTML('<html><body>' + bodyHTML + '</body></html>');
  const body = doc.body;
  stripNoise(body);
  let contentEl = null;
  for (const sel of CONTENT_SELECTORS) {
    contentEl = body.querySelector(sel);
    if (contentEl) break;
  }
  if (!contentEl) contentEl = body;
  const codeBlocks = extractCodeBlocks(contentEl);
  const markdown = domToMarkdown(contentEl);
  return { markdown, codeBlocks };
}

// Generators
const arbText = fc.constantFrom('hello', 'world', 'test', 'code', 'data');
const arbHeading = fc.tuple(fc.integer({ min: 1, max: 3 }), arbText).map(([l, t]) => '<h' + l + '>' + t + '</h' + l + '>');
const arbParagraph = arbText.map(t => '<p>' + t + '</p>');
const arbCodeBlock = fc.constantFrom(
  '<pre><code class="language-javascript">const x = 1;\nfunction foo() { return x; }</code></pre>'
);
const arbElement = fc.oneof(arbHeading, arbParagraph, arbCodeBlock);
const arbBody = fc.array(arbElement, { minLength: 2, maxLength: 3 }).map(els => '<main><article>' + els.join('') + '</article></main>');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

console.log('Preservation Property Tests:');

runTest('Property 2.1: domToMarkdown determinism', () => {
  fc.assert(fc.property(arbBody, bodyHTML => {
    const r1 = runExtraction(bodyHTML);
    const r2 = runExtraction(bodyHTML);
    if (r1.markdown !== r2.markdown) throw new Error('Not deterministic');
    if (r1.markdown.length === 0) throw new Error('Empty output');
  }), { numRuns: 5, seed: 123 });
});

runTest('Property 2.2: stripNoise removes noise', () => {
  fc.assert(fc.property(
    fc.tuple(fc.array(arbElement, { minLength: 1, maxLength: 2 }), fc.subarray(['nav', 'footer', 'aside'], { minLength: 1 })),
    ([content, noise]) => {
      const noiseHTML = noise.map(t => '<' + t + '><p>Noise</p></' + t + '>').join('');
      const html = '<main><article>' + content.join('') + '</article></main>' + noiseHTML;
      const { document: doc } = parseHTML('<html><body>' + html + '</body></html>');
      stripNoise(doc.body);
      for (const sel of ['nav', 'footer', 'aside']) {
        if (doc.body.querySelectorAll(sel).length > 0) throw new Error('Noise not removed: ' + sel);
      }
    }
  ), { numRuns: 5, seed: 456 });
});

runTest('Property 2.3: extractCodeBlocks determinism', () => {
  fc.assert(fc.property(arbCodeBlock, codeHTML => {
    const html = '<main><article>' + codeHTML + '</article></main>';
    const { document: doc1 } = parseHTML('<html><body>' + html + '</body></html>');
    const r1 = extractCodeBlocks(doc1.body.querySelector('article'));
    const { document: doc2 } = parseHTML('<html><body>' + html + '</body></html>');
    const r2 = extractCodeBlocks(doc2.body.querySelector('article'));
    if (JSON.stringify(r1) !== JSON.stringify(r2)) throw new Error('Not deterministic');
    if (r1.length === 0) throw new Error('No code blocks found');
  }), { numRuns: 5, seed: 789 });
});

runTest('Property 2.4: full pipeline determinism', () => {
  fc.assert(fc.property(arbBody, bodyHTML => {
    const r1 = runExtraction(bodyHTML);
    const r2 = runExtraction(bodyHTML);
    if (JSON.stringify(r1) !== JSON.stringify(r2)) throw new Error('Not deterministic');
  }), { numRuns: 5, seed: 101 });
});

runTest('Property 2.5: nested DOM determinism', () => {
  fc.assert(fc.property(
    fc.tuple(fc.integer({ min: 1, max: 3 }), fc.array(arbElement, { minLength: 1, maxLength: 2 })),
    ([depth, content]) => {
      let open = '', close = '';
      for (let i = 0; i < depth; i++) { open += '<div>'; close += '</div>'; }
      const html = '<main><article>' + open + content.join('') + close + '</article></main>';
      const r1 = runExtraction(html);
      const r2 = runExtraction(html);
      if (JSON.stringify(r1) !== JSON.stringify(r2)) throw new Error('Not deterministic');
    }
  ), { numRuns: 5, seed: 202 });
});

runTest('Property 2.6: GitHub extraction determinism', () => {
  fc.assert(fc.property(
    fc.tuple(arbText, fc.array(arbElement, { minLength: 1, maxLength: 2 })),
    ([name, content]) => {
      const html = '<main><div id="readme"><div class="markdown-body"><h1>' + name + '</h1>' + content.join('') + '</div></div></main>';
      const { document: doc1 } = parseHTML('<html><body>' + html + '</body></html>');
      const contentEl1 = doc1.body.querySelector('.markdown-body');
      stripNoise(contentEl1);
      const md1 = domToMarkdown(contentEl1);
      const { document: doc2 } = parseHTML('<html><body>' + html + '</body></html>');
      const contentEl2 = doc2.body.querySelector('.markdown-body');
      stripNoise(contentEl2);
      const md2 = domToMarkdown(contentEl2);
      if (md1 !== md2) throw new Error('Not deterministic');
    }
  ), { numRuns: 5, seed: 303 });
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
const mem = process.memoryUsage();
console.log(`Memory: RSS=${Math.round(mem.rss/1024/1024)}MB, Heap=${Math.round(mem.heapUsed/1024/1024)}MB`);
process.exit(failed > 0 ? 1 : 0);
