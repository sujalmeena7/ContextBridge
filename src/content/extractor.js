/**
 * ContextBridge — Content Extractor
 * Injected into the active tab on demand.
 * Handles site-adaptive DOM parsing → clean markdown payload.
 */

(function () {
  'use strict';

  if (window.__contextBridgeInjected) return;
  window.__contextBridgeInjected = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== 'EXTRACT_CONTENT') return;

    try {
      const payload = extractPage();
      sendResponse(payload);
    } catch (err) {
      try {
        sendResponse({
          title: document.title,
          url: location.href,
          raw_content: document.title,
          chunks: [],
          codeBlocks: [],
          meta: { domain: location.hostname, contentType: 'unknown', error: err.message, truncated: true },
        });
      } catch (e) {
        sendResponse({ error: (err.message || 'Extraction failed') });
      }
    }
    return true;
  });

  function extractPage() {
    const hostname = location.hostname.replace(/^www\./, '');
    const title = document.title || 'Untitled';

    // Find a small content element — NEVER process document.body
    let contentEl = null;
    const CONTENT_SELECTORS = [
      '#readme .markdown-body',
      '.markdown-body',
      'article.main-page-content',
      '.s-prose',
      '.comment-body',
      '[role="main"] article',
      'article',
      '.prose',
      '[class*="post-content"]',
      '[class*="entry-content"]',
    ];

    for (const sel of CONTENT_SELECTORS) {
      try {
        contentEl = document.querySelector(sel);
        if (contentEl) break;
      } catch (e) {}
    }

    let markdown = '';
    let truncated = false;

    if (contentEl && contentEl.childElementCount < 500) {
      // Small enough to safely read textContent
      try {
        markdown = contentEl.textContent || '';
        if (markdown.length > 100000) {
          markdown = markdown.slice(0, 100000);
          truncated = true;
        }
        markdown = markdown.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      } catch (e) {
        markdown = title;
        truncated = true;
      }
    } else if (contentEl) {
      // Content element exists but might be large — read only direct children
      try {
        const children = contentEl.children;
        const parts = [];
        const limit = Math.min(children.length, 50);
        let charCount = 0;
        for (let i = 0; i < limit && charCount < 50000; i++) {
          const child = children[i];
          const tag = child.tagName?.toLowerCase() || '';
          if (['script', 'style', 'nav', 'footer', 'svg', 'noscript'].includes(tag)) continue;
          const text = child.textContent || '';
          if (text.length > 10000) {
            parts.push(text.slice(0, 10000));
            charCount += 10000;
            truncated = true;
          } else if (text.trim().length > 0) {
            parts.push(text.trim());
            charCount += text.length;
          }
        }
        markdown = parts.join('\n\n');
        if (children.length > 50) truncated = true;
      } catch (e) {
        markdown = title;
        truncated = true;
      }
    } else {
      // No content element found at all
      markdown = title;
      truncated = true;
    }

    // Detect content type from URL
    let contentType = 'blog_post';
    const url = location.href;
    if (url.includes('github.com')) contentType = 'github_readme';
    else if (url.includes('stackoverflow.com')) contentType = 'stack_overflow';
    else if (url.includes('developer.mozilla.org')) contentType = 'api_docs';
    else if (url.match(/\/docs?\//i)) contentType = 'api_docs';

    // Build chunks
    const words = markdown.split(/\s+/);
    const chunks = [];
    let start = 0;
    while (start < words.length) {
      const end = Math.min(start + 1200, words.length);
      chunks.push({ index: chunks.length, text: words.slice(start, end).join(' '), start, end });
      start = end - 150;
      if (start >= words.length) break;
    }

    return {
      title,
      url: location.href,
      raw_content: markdown,
      chunks,
      codeBlocks: [],
      meta: {
        domain: location.hostname,
        contentType,
        tags: [],
        readabilityScore: 70,
        extractionMode: 'safe',
        language: document.documentElement.lang || 'en',
        content_length: markdown.length,
        word_count: words.length,
        code_block_count: 0,
        chunk_count: chunks.length,
        truncated: truncated || undefined,
      },
    };
  }

})();
