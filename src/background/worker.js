/**
 * ContextBridge — Service Worker (Manifest V3)
 * Handles: message routing, endpoint health checks, queue flush, dedup, notifications
 *
 * Design: All state lives in chrome.storage.local — never in-memory arrays —
 * because MV3 service workers can be terminated at any moment by Chrome.
 */

import { DEFAULT_SETTINGS } from '../shared/constants.js';
import { putRecord, deleteRecord, clearAllRecords, getStorageEstimate, getRecordByUrl } from './db.js';
import { searchRecords } from './search.js';
import { exportRecords } from './exporter.js';

// ─── Alarm names ─────────────────────────────────────────────────────────────
const ALARM_HEALTH_CHECK  = 'cb_health_check';
const ALARM_QUEUE_FLUSH   = 'cb_queue_flush';
const HEALTH_INTERVAL_MIN = 1;     // every 1 minute
const FLUSH_INTERVAL_MIN  = 0.5;   // every 30 seconds

// ─── Install / startup ───────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(['settings']);
  if (!existing.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS, history: [], queue: [] });
  }
  scheduleAlarms();
  console.log('[ContextBridge] Extension installed, alarms scheduled.');
});

chrome.runtime.onStartup.addListener(() => {
  scheduleAlarms();
});

function scheduleAlarms() {
  chrome.alarms.create(ALARM_HEALTH_CHECK, { periodInMinutes: HEALTH_INTERVAL_MIN });
  chrome.alarms.create(ALARM_QUEUE_FLUSH,  { periodInMinutes: FLUSH_INTERVAL_MIN  });
}

// ─── Alarm handler ───────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_HEALTH_CHECK) {
    await runHealthCheck();
  }
  if (alarm.name === ALARM_QUEUE_FLUSH) {
    await flushQueue();
  }
});

// ─── Keyboard command ────────────────────────────────────────────────────────
// NOTE: MV3 chrome.commands.onCommand only receives (command) — no tab arg.
// We must query the active tab ourselves.
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'index-page') {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      await runFullPipeline(tab);
    } catch (err) {
      console.error('[ContextBridge] Keyboard shortcut error:', err);
    }
  }
});

// ─── Action click → open side panel ─────────────────────────────────────────
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});

// ─── Message router ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case 'INDEX_CURRENT_PAGE': {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          const result = await runFullPipeline(tab);
          sendResponse({ success: true, result });
          break;
        }
        case 'CONTENT_EXTRACTED': {
          const result = await handleExtractedContent(message.payload);
          sendResponse({ success: true, result });
          break;
        }
        case 'HEALTH_CHECK': {
          const status = await runHealthCheck();
          sendResponse({ success: true, status });
          break;
        }
        case 'GET_HISTORY': {
          const { history = [] } = await chrome.storage.local.get('history');
          sendResponse({ success: true, history });
          break;
        }
        case 'GET_QUEUE': {
          const { queue = [] } = await chrome.storage.local.get('queue');
          sendResponse({ success: true, queue });
          break;
        }
        case 'CLEAR_HISTORY': {
          await chrome.storage.local.set({ history: [] });
          sendResponse({ success: true });
          break;
        }
        case 'FLUSH_QUEUE': {
          await flushQueue();
          sendResponse({ success: true });
          break;
        }
        case 'DELETE_RECORD': {
          await deleteRecord(message.id);
          sendResponse({ success: true });
          break;
        }
        case 'GET_STORAGE_INFO': {
          const info = await getStorageEstimate();
          sendResponse({ success: true, count: info.count, sizeMB: +(info.sizeBytes / (1024 * 1024)).toFixed(2) });
          break;
        }
        case 'CLEAR_LOCAL_DB': {
          await clearAllRecords();
          sendResponse({ success: true });
          break;
        }
        case 'EXPORT_MARKDOWN': {
          const { blob, filename } = await exportRecords(message.ids);
          // Convert blob to base64 data URL (Blobs aren't structured-cloneable in all contexts)
          const arrayBuffer = await blob.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64 = btoa(binary);
          const dataUrl = `data:${blob.type};base64,${base64}`;
          sendResponse({ success: true, dataUrl, filename });
          break;
        }
        case 'SEARCH_QUERY': {
          const results = await searchRecords(message.query);
          sendResponse({ success: true, results });
          break;
        }
        case 'GET_RECORD_BY_URL': {
          const record = await getRecordByUrl(message.url);
          sendResponse({ success: true, record });
          break;
        }
        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (err) {
      console.error('[ContextBridge Worker] Error:', err);
      sendResponse({ success: false, error: err.message });
    }
  })();
  return true; // keep message channel open for async response
});

// ─── Full pipeline: inject → extract → dedup → quality → post/queue ─────────
async function runFullPipeline(tab) {
  if (!tab?.id) throw new Error('No active tab found.');

  const blockedPrefixes = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'brave://'];
  if (blockedPrefixes.some(p => tab.url?.startsWith(p))) {
    throw new Error('Cannot index browser internal pages.');
  }

  // 1. Inject extraction function directly (no file loading, no message passing)
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        try {
          const title = document.title || 'Untitled';
          const url = location.href;
          const hostname = location.hostname;

          // Find a small content element — never process full body
          const selectors = [
            '#readme .markdown-body', '.markdown-body',
            'article.main-page-content', '.article-content',
            '.s-prose', '.post-text', '.comment-body',
            '.js-discussion', '[data-testid="issue-body"]',
            '[role="main"] article', 'article',
            '.prose', '[class*="post-content"]',
            '[class*="entry-content"]', '[class*="page-content"]',
            'main',
          ];

          let contentEl = null;
          for (const sel of selectors) {
            try {
              contentEl = document.querySelector(sel);
              if (contentEl) break;
            } catch (e) {}
          }

          let markdown = '';
          let truncated = false;
          const codeBlocks = [];

          if (contentEl) {
            // Read text from direct children only (max 100 children, max 100KB total)
            const children = contentEl.children;
            const limit = Math.min(children.length, 100);
            const parts = [];
            let charCount = 0;
            const MAX_CHARS = 100000;

            for (let i = 0; i < limit && charCount < MAX_CHARS; i++) {
              const child = children[i];
              const tag = (child.tagName || '').toLowerCase();

              // Skip noise
              if (['script', 'style', 'nav', 'footer', 'header', 'svg',
                   'noscript', 'iframe', 'aside'].includes(tag)) continue;

              // Skip hidden elements
              if (child.style && (child.style.display === 'none' || child.style.visibility === 'hidden')) continue;

              // Extract code blocks
              if (tag === 'pre') {
                const codeEl = child.querySelector('code');
                const code = (codeEl || child).textContent || '';
                if (code.length > 10 && code.length < 20000) {
                  const cls = (codeEl?.className || '') + ' ' + (child.className || '');
                  const langMatch = cls.match(/language-(\w+)|lang-(\w+)/);
                  const lang = langMatch ? (langMatch[1] || langMatch[2]) : '';
                  codeBlocks.push({ language: lang, code: code.trim(), lines: code.split('\n').length });
                  parts.push('```' + lang + '\n' + code.trim() + '\n```');
                  charCount += code.length;
                }
                continue;
              }

              // Format headings
              if (/^h[1-6]$/.test(tag)) {
                const level = tag[1];
                const text = (child.textContent || '').trim();
                if (text) {
                  const line = '#'.repeat(parseInt(level)) + ' ' + text;
                  parts.push(line);
                  charCount += line.length;
                }
                continue;
              }

              // Regular content — read textContent
              let text = '';
              try { text = (child.textContent || '').trim(); } catch (e) { continue; }

              // Cap individual element text to prevent huge strings
              if (text.length > 15000) {
                text = text.slice(0, 15000) + '...';
                truncated = true;
              }

              if (text.length > 0) {
                parts.push(text);
                charCount += text.length;
              }
            }

            markdown = parts.join('\n\n');
            if (children.length > limit || charCount >= MAX_CHARS) truncated = true;
          } else {
            markdown = title;
            truncated = true;
          }

          // Clean up whitespace
          markdown = markdown.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

          // Detect content type
          let contentType = 'blog_post';
          if (url.includes('github.com')) {
            if (/\/issues\/\d+/.test(url)) contentType = 'github_issue';
            else if (/\/pull\/\d+/.test(url)) contentType = 'github_pr';
            else contentType = 'github_readme';
          }
          else if (url.includes('stackoverflow.com')) contentType = 'stack_overflow';
          else if (url.includes('developer.mozilla.org')) contentType = 'api_docs';
          else if (url.match(/\/docs?\//i)) contentType = 'api_docs';

          // Auto-tag — use word boundaries to avoid false positives
          const tags = [];
          const lower = ' ' + markdown.toLowerCase() + ' ';
          // Helper: check if a word appears as a standalone term (not part of another word)
          const has = (word) => lower.includes(' ' + word + ' ') || lower.includes(' ' + word + '.') || lower.includes(' ' + word + ',') || lower.includes(' ' + word + '\n');
          
          if (has('python') || has('django') || has('flask') || has('fastapi')) tags.push('python');
          if (has('javascript') || has('typescript') || has('nodejs') || lower.includes('react.') || lower.includes('react ') || has('vue') || has('angular')) tags.push('javascript');
          if (has('rust') || has('cargo') || has('crate')) tags.push('rust');
          if (has('docker') || has('dockerfile') || has('kubernetes') || has('k8s')) tags.push('docker');
          if (has('golang') || lower.includes(' go ') && (lower.includes('func ') || lower.includes('goroutine'))) tags.push('go');
          if (lower.includes('css') && (lower.includes('stylesheet') || lower.includes('selector') || lower.includes('flexbox') || lower.includes('grid layout'))) tags.push('css');
          if (lower.includes('html') && (lower.includes('element') || lower.includes('tag') || lower.includes('dom'))) tags.push('html');
          if (has('api') && (has('endpoint') || has('rest') || has('graphql') || has('http'))) tags.push('api');
          if (has('machine learning') || has('neural') || has('llm') || has('gpt') || has('claude') || has('openai') || has('anthropic')) tags.push('ai');
          if (has('sql') || has('postgres') || has('mysql') || has('database') || has('mongodb')) tags.push('database');
          if (has('chrome extension') || has('manifest') && has('extension')) tags.push('chrome-extension');
          if (has('linux') || has('bash') || has('terminal') || has('shell')) tags.push('devops');

          // Build chunks
          const words = markdown.split(/\s+/).filter(Boolean);
          const chunks = [];
          let start = 0;
          while (start < words.length && chunks.length < 30) {
            const end = Math.min(start + 1200, words.length);
            chunks.push({ index: chunks.length, text: words.slice(start, end).join(' '), start, end });
            start = end - 150;
            if (start >= words.length) break;
          }

          return {
            title,
            url,
            raw_content: markdown,
            chunks,
            codeBlocks,
            meta: {
              domain: hostname,
              contentType,
              tags: tags.slice(0, 8),
              readabilityScore: 75,
              extractionMode: 'safe',
              language: document.documentElement?.lang || 'en',
              content_length: markdown.length,
              word_count: words.length,
              code_block_count: codeBlocks.length,
              chunk_count: chunks.length,
              truncated: truncated || undefined,
            },
          };
        } catch (err) {
          return { error: err.message || 'Extraction failed' };
        }
      },
    });
  } catch (injectErr) {
    const msg = injectErr.message || '';
    if (msg.includes('Cannot access') || msg.includes('permission')) {
      throw new Error('Cannot access this page. Try reloading the tab first, or check that the extension has permission for this site.');
    }
    throw new Error(`Script injection failed: ${msg}`);
  }

  // 2. Get the result from the injected function
  const payload = results?.[0]?.result;
  if (!payload || payload.error) {
    throw new Error(payload?.error || 'Content extraction returned empty.');
  }

  // 3. Run through handleExtractedContent (dedup, quality gate, POST/queue)
  return await handleExtractedContent(payload);
}

// ─── Core: handle extracted payload ─────────────────────────────────────────
export async function handleExtractedContent(payload) {
  const { settings, history = [], queue = [] } = await chrome.storage.local.get(['settings', 'history', 'queue']);
  const cfg = settings || DEFAULT_SETTINGS;
  const storageMode = cfg.storageMode || 'local-only';

  // Deduplication check using persistent hash index
  const urlHash = await hashString(payload.url);
  const alreadyIndexed = history.some(h => h.urlHash === urlHash);
  const dedupMode = cfg.dedupMode || 'warn';

  if (alreadyIndexed && dedupMode === 'skip') {
    return { status: 'skipped', reason: 'duplicate', url: payload.url };
  }

  // Quality gate — reject extremely low-signal pages
  const wordCount = countWords(payload.raw_content);
  if (wordCount < 50) {
    return { status: 'skipped', reason: 'low_signal', wordCount };
  }

  // Build canonical POST body (includes `id` field per extended schema)
  const body = buildPostBody(payload, urlHash);

  // Build Content_Record for IndexedDB storage
  const contentRecord = {
    id:          urlHash,
    url:         payload.url,
    title:       payload.title,
    domain:      payload.meta?.domain || new URL(payload.url).hostname,
    rawContent:  payload.raw_content,
    chunks:      (payload.chunks || []).map(c => ({ index: c.index, text: c.text, start: c.start, end: c.end })),
    codeBlocks:  payload.codeBlocks || [],
    tags:        payload.meta?.tags || [],
    wordCount,
    contentType: payload.meta?.contentType || 'generic',
    indexedAt:   new Date().toISOString(),
  };

  let localResult = null;
  let endpointResult = null;
  let source = storageMode;

  // Route based on storageMode
  if (storageMode === 'local-only' || storageMode === 'both') {
    try {
      await putRecord(contentRecord);
      localResult = { success: true };
    } catch (err) {
      localResult = { success: false, error: err.message };
      console.error('[ContextBridge] IndexedDB write failed:', err);
    }
  }

  if (storageMode === 'endpoint-only' || storageMode === 'both') {
    try {
      const endpoint = cfg.endpoint || DEFAULT_SETTINGS.endpoint;
      endpointResult = await sendToEndpoint(endpoint, body, cfg);
    } catch (err) {
      endpointResult = { success: false, error: err.message };
      console.error('[ContextBridge] Endpoint send failed:', err);
    }
  }

  // Determine overall status and build history entry
  let status;
  if (storageMode === 'local-only') {
    status = localResult?.success ? 'stored_locally' : 'failed';
  } else if (storageMode === 'endpoint-only') {
    status = endpointResult?.success ? 'sent' : 'queued';
  } else {
    // "both" mode — report combined status
    if (localResult?.success && endpointResult?.success) {
      status = 'stored_and_sent';
    } else if (localResult?.success) {
      status = 'stored_locally';
    } else if (endpointResult?.success) {
      status = 'sent';
    } else {
      status = 'failed';
    }
  }

  // Queue for endpoint retry if endpoint failed and mode includes endpoint
  if ((storageMode === 'endpoint-only' || storageMode === 'both') && !endpointResult?.success) {
    const queueEntry = { ...body, _queuedAt: new Date().toISOString(), _retries: 0 };
    const newQueue = [...queue, queueEntry].slice(0, 100);
    await chrome.storage.local.set({ queue: newQueue });
    chrome.runtime.sendMessage({ type: 'QUEUED', url: payload.url }).catch(() => {});
  }

  // Record history entry with source info
  const historyEntry = buildHistoryEntry(payload, body, urlHash, wordCount, status);
  historyEntry.source = source;
  const newHistory = [historyEntry, ...history].slice(0, 50);
  await chrome.storage.local.set({ history: newHistory });

  // Notify sidepanel (fire-and-forget)
  chrome.runtime.sendMessage({ type: 'INDEXED_SUCCESS', entry: historyEntry }).catch(() => {});

  return { status, wordCount, title: payload.title, source };
}

// ─── History entry builder ──────────────────────────────────────────────────
function buildHistoryEntry(payload, body, urlHash, wordCount, status) {
  return {
    id:          body.id,
    urlHash,
    url:         payload.url,
    title:       payload.title,
    domain:      payload.meta?.domain || '',
    contentType: payload.meta?.contentType || body.meta?.content_type || 'generic',
    wordCount,
    tags:        payload.meta?.tags || body.meta?.tags || [],
    timestamp:   body.timestamp,
    status,
  };
}

// ─── POST body builder (Extended Schema) ────────────────────────────────────
function buildPostBody(payload, urlHash) {
  const wordCount = countWords(payload.raw_content);
  return {
    id:              urlHash || crypto.randomUUID(),
    title:           payload.title,
    url:             payload.url,
    timestamp:       new Date().toISOString(),
    tags:            payload.meta?.tags || [],
    metrics: {
      readability_score: payload.meta?.readabilityScore || 0,
      total_chunks:      (payload.chunks || []).length,
      word_count:        wordCount,
      code_block_count:  (payload.codeBlocks || []).length,
    },
    chunks:          (payload.chunks || []).map(c => ({
      chunk_index: c.index,
      text:        c.text,
    })),
    code_blocks:     payload.codeBlocks || [],
    raw_content_backup: payload.raw_content,
    meta: {
      domain:          payload.meta?.domain || new URL(payload.url).hostname,
      content_length:  payload.raw_content?.length || 0,
      word_count:      wordCount,
      content_type:    payload.meta?.contentType || 'unknown',
      tags:            payload.meta?.tags || [],
      readability:     payload.meta?.readabilityScore || 0,
      extraction_mode: payload.meta?.extractionMode || 'generic',
      language:        payload.meta?.language || 'en',
    },
  };
}

// ─── Endpoint sender ─────────────────────────────────────────────────────────
async function sendToEndpoint(endpoint, body, cfg) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs || 8000);

    const response = await fetch(endpoint, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { 'Authorization': `Bearer ${cfg.apiKey}` } : {}),
      },
      body:   JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }
    return { success: true, data: await response.json().catch(() => ({})) };
  } catch (err) {
    return { success: false, error: err.name === 'AbortError' ? 'Request timed out' : err.message };
  }
}

// ─── Health check ────────────────────────────────────────────────────────────
async function runHealthCheck() {
  const { settings } = await chrome.storage.local.get('settings');
  const cfg = settings || DEFAULT_SETTINGS;
  const healthUrl = (cfg.endpoint || DEFAULT_SETTINGS.endpoint).replace(/\/[^/]+$/, '/health');

  try {
    const res = await fetch(healthUrl, { method: 'GET', signal: AbortSignal.timeout(3000) });
    const online = res.ok || res.status === 404; // 404 means server is up, just no /health route
    await chrome.storage.local.set({ endpointStatus: online ? 'online' : 'offline' });
    chrome.runtime.sendMessage({ type: 'HEALTH_STATUS', status: online ? 'online' : 'offline' }).catch(() => {});
    return online ? 'online' : 'offline';
  } catch {
    await chrome.storage.local.set({ endpointStatus: 'offline' });
    chrome.runtime.sendMessage({ type: 'HEALTH_STATUS', status: 'offline' }).catch(() => {});
    return 'offline';
  }
}

// ─── Queue flush ─────────────────────────────────────────────────────────────
async function flushQueue() {
  const { settings, queue = [], history = [], endpointStatus } = await chrome.storage.local.get(['settings', 'queue', 'history', 'endpointStatus']);
  if (!queue.length || endpointStatus !== 'online') return;

  const cfg = settings || DEFAULT_SETTINGS;
  const endpoint = cfg.endpoint || DEFAULT_SETTINGS.endpoint;

  const remaining = [];
  let flushedCount = 0;
  const updatedHistory = [...history];

  for (const item of queue) {
    if (item._retries >= 3) continue; // drop after 3 retries
    const result = await sendToEndpoint(endpoint, item, cfg);
    if (result.success) {
      flushedCount++;
      // Build full-fidelity history entry from queue item
      const entry = {
        id:          item.id || crypto.randomUUID(),
        urlHash:     item.id || '',
        url:         item.url,
        title:       item.title,
        domain:      item.meta?.domain || '',
        contentType: item.meta?.content_type || 'generic',
        wordCount:   item.meta?.word_count || item.metrics?.word_count || 0,
        tags:        item.tags || item.meta?.tags || [],
        timestamp:   item.timestamp,
        status:      'sent_from_queue',
      };
      updatedHistory.unshift(entry);
    } else {
      remaining.push({ ...item, _retries: (item._retries || 0) + 1 });
    }
  }

  await chrome.storage.local.set({ queue: remaining, history: updatedHistory.slice(0, 50) });

  if (flushedCount > 0) {
    chrome.runtime.sendMessage({ type: 'QUEUE_FLUSHED', count: flushedCount }).catch(() => {});
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────
function countWords(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function hashString(str) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
