/**
 * Unit tests for boundedClone helper function
 *
 * **Validates: Requirements 2.1**
 *
 * Tests the boundedClone function that performs depth-first cloning
 * with a node count limit to prevent OOM on large DOM trees.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { JSDOM } from 'jsdom';

const MAX_NODE_COUNT = 50000;

// ─── Exact replica of boundedClone from extractor.js ────────────────────────

function boundedClone(element, maxNodes) {
  let count = 0;
  let truncated = false;

  function cloneTree(source, parentClone) {
    const children = source.childNodes;
    for (let i = 0; i < children.length; i++) {
      if (truncated) return;

      const child = children[i];
      // Clone the node shallowly (no children)
      const clonedChild = child.cloneNode(false);
      count++;

      parentClone.appendChild(clonedChild);

      if (count >= maxNodes) {
        truncated = true;
        return;
      }

      // Recurse into element/document fragment children
      if (child.childNodes && child.childNodes.length > 0) {
        cloneTree(child, clonedChild);
      }
    }
  }

  // Clone the root element itself (shallow)
  const clone = element.cloneNode(false);
  count++;

  if (count >= maxNodes) {
    return { clone, truncated: true };
  }

  // Recursively clone children up to the limit
  cloneTree(element, clone);

  return { clone, truncated };
}

// ─── Helper: count all nodes in a tree (element + all descendants) ──────────

function countNodes(el) {
  let count = 1; // the element itself
  const walker = el.ownerDocument.createTreeWalker(el, 0xFFFFFFFF); // NodeFilter.SHOW_ALL
  while (walker.nextNode()) count++;
  return count;
}

// ─── Unit Tests ─────────────────────────────────────────────────────────────

describe('boundedClone unit tests', () => {

  it('clones a small tree completely with truncated=false', () => {
    const dom = new JSDOM('<html><body><div><p>Hello</p><span>World</span></div></body></html>');
    const el = dom.window.document.querySelector('div');

    const { clone, truncated } = boundedClone(el, MAX_NODE_COUNT);

    expect(truncated).toBe(false);
    expect(clone.tagName).toBe('DIV');
    expect(clone.querySelector('p').textContent).toBe('Hello');
    expect(clone.querySelector('span').textContent).toBe('World');

    dom.window.close();
  });

  it('clones an empty element with truncated=false', () => {
    const dom = new JSDOM('<html><body><div></div></body></html>');
    const el = dom.window.document.querySelector('div');

    const { clone, truncated } = boundedClone(el, MAX_NODE_COUNT);

    expect(truncated).toBe(false);
    expect(clone.tagName).toBe('DIV');
    expect(clone.childNodes.length).toBe(0);

    dom.window.close();
  });

  it('truncates when tree exceeds maxNodes limit', () => {
    // Build a tree with many nodes
    let html = '<div>';
    for (let i = 0; i < 100; i++) {
      html += `<p>Node ${i}</p>`;
    }
    html += '</div>';

    const dom = new JSDOM(`<html><body>${html}</body></html>`);
    const el = dom.window.document.querySelector('div');

    // Set a low limit (e.g., 20 nodes)
    const { clone, truncated } = boundedClone(el, 20);

    expect(truncated).toBe(true);
    // The clone should have fewer nodes than the original
    const clonedNodeCount = countNodes(clone);
    expect(clonedNodeCount).toBeLessThanOrEqual(20);

    dom.window.close();
  });

  it('returns truncated=true when maxNodes is 1 (only root cloned)', () => {
    const dom = new JSDOM('<html><body><div><p>Hello</p></div></body></html>');
    const el = dom.window.document.querySelector('div');

    const { clone, truncated } = boundedClone(el, 1);

    expect(truncated).toBe(true);
    expect(clone.tagName).toBe('DIV');
    expect(clone.childNodes.length).toBe(0);

    dom.window.close();
  });

  it('preserves element attributes in cloned nodes', () => {
    const dom = new JSDOM('<html><body><div id="root" class="container"><a href="/link" class="btn">Click</a></div></body></html>');
    const el = dom.window.document.querySelector('div');

    const { clone, truncated } = boundedClone(el, MAX_NODE_COUNT);

    expect(truncated).toBe(false);
    expect(clone.id).toBe('root');
    expect(clone.className).toBe('container');
    const link = clone.querySelector('a');
    expect(link.getAttribute('href')).toBe('/link');
    expect(link.className).toBe('btn');

    dom.window.close();
  });

  it('handles deeply nested trees correctly', () => {
    let html = '';
    const depth = 50;
    for (let i = 0; i < depth; i++) html += '<div>';
    html += '<span>Deep</span>';
    for (let i = 0; i < depth; i++) html += '</div>';

    const dom = new JSDOM(`<html><body>${html}</body></html>`);
    const el = dom.window.document.body.firstElementChild;

    const { clone, truncated } = boundedClone(el, MAX_NODE_COUNT);

    expect(truncated).toBe(false);
    // Verify the deepest node is present
    let node = clone;
    for (let i = 0; i < depth - 1; i++) {
      node = node.firstElementChild;
      expect(node).not.toBeNull();
    }
    expect(node.querySelector('span').textContent).toBe('Deep');

    dom.window.close();
  });

  it('clones text nodes correctly', () => {
    const dom = new JSDOM('<html><body><div>Hello <strong>World</strong> Goodbye</div></body></html>');
    const el = dom.window.document.querySelector('div');

    const { clone, truncated } = boundedClone(el, MAX_NODE_COUNT);

    expect(truncated).toBe(false);
    expect(clone.textContent).toBe('Hello World Goodbye');

    dom.window.close();
  });
});

// ─── Property-Based Tests ───────────────────────────────────────────────────

describe('boundedClone property-based tests', () => {

  /**
   * Property: boundedClone never produces more than maxNodes nodes in output
   *
   * **Validates: Requirements 2.1**
   */
  it('Property: boundedClone never produces more than maxNodes nodes in output', () => {
    fc.assert(
      fc.property(
        // Generate tree sizes from small to large
        fc.integer({ min: 10, max: 500 }),
        // Generate a maxNodes limit
        fc.integer({ min: 1, max: 600 }),
        (treeSize, maxNodes) => {
          // Build a DOM tree with approximately treeSize nodes
          let html = '<div>';
          for (let i = 0; i < treeSize; i++) {
            html += `<span>N${i}</span>`;
          }
          html += '</div>';

          const dom = new JSDOM(`<html><body>${html}</body></html>`);
          const el = dom.window.document.querySelector('div');

          const { clone, truncated } = boundedClone(el, maxNodes);

          const clonedCount = countNodes(clone);

          // Core property: output never exceeds maxNodes
          expect(clonedCount).toBeLessThanOrEqual(maxNodes);

          // If not truncated, the clone should have the same structure as original
          if (!truncated) {
            const originalCount = countNodes(el);
            expect(clonedCount).toBe(originalCount);
          }

          dom.window.close();
        }
      ),
      { numRuns: 50, seed: 42 }
    );
  });

  /**
   * Property: Trees below maxNodes are cloned identically to cloneNode(true)
   *
   * **Validates: Requirements 2.1**
   */
  it('Property: trees below maxNodes are cloned identically to cloneNode(true)', () => {
    fc.assert(
      fc.property(
        // Generate small tree sizes that will be below the limit
        fc.integer({ min: 1, max: 50 }),
        (treeSize) => {
          let html = '<div>';
          for (let i = 0; i < treeSize; i++) {
            if (i % 3 === 0) html += `<p>Para ${i}</p>`;
            else if (i % 3 === 1) html += `<a href="/l${i}">Link ${i}</a>`;
            else html += `<span>Span ${i}</span>`;
          }
          html += '</div>';

          const dom = new JSDOM(`<html><body>${html}</body></html>`);
          const el = dom.window.document.querySelector('div');

          const originalCount = countNodes(el);
          // Use a limit well above the tree size
          const { clone, truncated } = boundedClone(el, originalCount + 1000);

          expect(truncated).toBe(false);

          // Compare innerHTML to verify identical structure
          expect(clone.innerHTML).toBe(el.innerHTML);

          dom.window.close();
        }
      ),
      { numRuns: 30, seed: 99 }
    );
  });
});
