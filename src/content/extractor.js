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
    const codeBlocks = [];
    let truncated = false;

    // Recursive DOM to Markdown converter
    function domToMarkdown(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (node.nodeType !== Node.ELEMENT_NODE) return '';

      const tag = node.tagName.toLowerCase();
      if (['script', 'style', 'nav', 'footer', 'svg', 'noscript', 'button', 'iframe'].includes(tag)) return '';

      // Skip elements that are visually hidden
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return '';

      let md = '';
      for (const child of node.childNodes) {
        md += domToMarkdown(child);
      }

      if (tag === 'h1') return `\n# ${md.trim()}\n\n`;
      if (tag === 'h2') return `\n## ${md.trim()}\n\n`;
      if (tag === 'h3') return `\n### ${md.trim()}\n\n`;
      if (tag === 'h4') return `\n#### ${md.trim()}\n\n`;
      if (tag === 'h5') return `\n##### ${md.trim()}\n\n`;
      if (tag === 'h6') return `\n###### ${md.trim()}\n\n`;
      if (tag === 'p') return `\n${md.trim()}\n\n`;
      if (tag === 'strong' || tag === 'b') return `**${md.trim()}**`;
      if (tag === 'em' || tag === 'i') return `*${md.trim()}*`;
      
      if (tag === 'code') {
        if (node.parentNode && node.parentNode.tagName.toLowerCase() !== 'pre') {
          return `\`${md.trim()}\``;
        }
        return md; // pre handles the block
      }
      if (tag === 'pre') {
        const langClass = Array.from(node.classList).find(c => c.startsWith('language-')) || '';
        const lang = node.getAttribute('data-language') || langClass.replace('language-', '') || '';
        const codeText = md.trim();
        if (codeText) {
          codeBlocks.push({ language: lang, code: codeText, lines: codeText.split('\n').length });
        }
        return `\n\`\`\`${lang}\n${codeText}\n\`\`\`\n\n`;
      }
      
      if (tag === 'a') return `[${md.trim()}](${node.href || ''})`;
      if (tag === 'li') return `\n- ${md.trim()}`;
      if (tag === 'ul' || tag === 'ol') return `\n${md}\n`;
      if (tag === 'blockquote') return `\n> ${md.trim().replace(/\n/g, '\n> ')}\n\n`;
      if (tag === 'br') return `\n`;
      if (tag === 'img') return `![${node.alt || ''}](${node.src || ''})`;
      
      if (['div', 'section', 'article', 'main'].includes(tag)) return `\n${md}\n`;

      return md;
    }

    // Find a content element
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
    try {
      if (contentEl) {
        markdown = domToMarkdown(contentEl);
      } else {
        // Fallback to body but skip huge trees
        markdown = domToMarkdown(document.body);
      }
      // Cleanup whitespace
      markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();
      
      // Safety limit
      if (markdown.length > 200000) {
        markdown = markdown.slice(0, 200000);
        truncated = true;
      }
    } catch (e) {
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

    // Semantic Chunking
    const paragraphs = markdown.split(/\n\n+/);
    const chunks = [];
    let currentChunk = '';
    let start = 0;
    
    // Roughly 5000 chars is ~1000 words
    for (const p of paragraphs) {
      if (currentChunk.length + p.length > 5000 && currentChunk.length > 0) {
        chunks.push({ index: chunks.length, text: currentChunk.trim(), start, end: start + currentChunk.length });
        start += currentChunk.length;
        currentChunk = p + '\n\n';
      } else {
        currentChunk += p + '\n\n';
      }
    }
    if (currentChunk.trim()) {
      chunks.push({ index: chunks.length, text: currentChunk.trim(), start, end: start + currentChunk.length });
    }

    const words = markdown.split(/\s+/).filter(w => w.length > 0);

    return {
      title,
      url: location.href,
      raw_content: markdown,
      chunks,
      codeBlocks,
      meta: {
        domain: location.hostname,
        contentType,
        tags: [],
        readabilityScore: 70,
        extractionMode: contentEl ? 'semantic' : 'fallback',
        language: document.documentElement.lang || 'en',
        content_length: markdown.length,
        word_count: words.length,
        code_block_count: codeBlocks.length,
        chunk_count: chunks.length,
        truncated: truncated || undefined,
      },
    };
  }

})();
