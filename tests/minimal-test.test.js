/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
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

function stripNoise(el) {
  STRIP_SELECTORS.forEach(function (sel) {
    try {
      el.querySelectorAll(sel).forEach(function (n) { n.remove(); });
    } catch (_) {}
  });
  el.querySelectorAll('*').forEach(function (node) {
    if (node.style && (node.style.display === 'none' || node.style.visibility === 'hidden')) {
      node.remove();
    }
  });
}

function domToMarkdown(el) {
  var lines = [];
  var visited = new WeakSet();

  function walk(node, depth) {
    if (!node || visited.has(node)) return;
    visited.add(node);

    if (node.nodeType === 3) {
      var text = node.textContent.replace(/\s+/g, ' ').trim();
      if (text) lines.push(text);
      return;
    }

    if (node.nodeType !== 1) return;
    var tag = node.tagName.toLowerCase();

    if (node.style && (node.style.display === 'none' || node.style.visibility === 'hidden')) return;

    switch (tag) {
      case 'h1': lines.push('\n# ' + node.textContent.trim() + '\n'); return;
      case 'h2': lines.push('\n## ' + node.textContent.trim() + '\n'); return;
      case 'p': lines.push('\n' + node.textContent.trim() + '\n'); return;
      case 'pre': {
        var codeEl = node.querySelector('code');
        var code = (codeEl || node).textContent;
        lines.push('\n```\n' + code + '\n```\n');
        return;
      }
      case 'a': {
        var href = node.getAttribute('href') || '';
        var aText = node.textContent.trim();
        if (aText) lines.push(href ? '[' + aText + '](' + href + ')' : aText);
        return;
      }
      case 'ul': case 'ol': {
        node.querySelectorAll(':scope > li').forEach(function (li, i) {
          var prefix = tag === 'ul' ? '- ' : (i + 1) + '. ';
          lines.push(prefix + li.textContent.trim().replace(/\n+/g, ' '));
        });
        lines.push('');
        return;
      }
      default:
        node.childNodes.forEach(function (child) { walk(child, depth + 1); });
    }
  }

  el.childNodes.forEach(function (child) { walk(child, 0); });
  var markdown = lines.join(' ').replace(/ {2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { markdown: markdown };
}

const arbText = fc.stringOf(
  fc.constantFrom(...'abcdefghijklm '.split('')),
  { minLength: 3, maxLength: 8 }
).map(s => s.trim() || 'text');

const arbContentElement = fc.oneof(
  arbText.map(t => '<h1>' + t + '</h1>'),
  arbText.map(t => '<p>' + t + '</p>'),
  fc.constant('<pre><code>const x = 1;\nfunction foo() { return x; }</code></pre>'),
  arbText.map(t => '<a href="/link">' + t + '</a>'),
  fc.array(arbText, { minLength: 1, maxLength: 3 }).map(items =>
    '<ul>' + items.map(item => '<li>' + item + '</li>').join('') + '</ul>'
  )
);

describe('full pipeline test', function () {
  it('extraction with stripNoise + domToMarkdown', function () {
    fc.assert(
      fc.property(
        fc.array(arbContentElement, { minLength: 2, maxLength: 4 }),
        function (elements) {
          var bodyHTML = '<main><article>' + elements.join('') + '</article></main><nav><p>Nav</p></nav><footer><p>Foot</p></footer>';
          var { document } = parseHTML('<html><body>' + bodyHTML + '</body></html>');
          var body = document.querySelector('body');

          var cloned = body.cloneNode(true);
          stripNoise(cloned);

          var article = cloned.querySelector('article');
          if (article) {
            var result = domToMarkdown(article);
            expect(result.markdown.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 10, seed: 42 }
    );
  });
});
