/**
 * ContextBridge — Side Panel Controller
 * Manages: UI state, history rendering, settings, tabs, toasts, search, export
 */

import { DEFAULT_SETTINGS } from '../shared/constants.js';
import { ChatUI } from './chat.js';
import { ChatModule } from './chat-module.js';
import { getProvider, getDefaultModel } from './providers/index.js';

// ─── DOM references ───────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const els = {
  indexBtn:         $('indexBtn'),
  indexBtnLabel:    $('indexBtnLabel'),
  indexBtnIcon:     $('indexBtnIcon'),
  statusPill:       $('statusPill'),
  statusDot:        $('statusDot'),
  statusText:       $('statusText'),
  logEntry:         $('logEntry'),
  logText:          $('logText'),
  pageTitle:        $('pageTitle'),
  pageUrl:          $('pageUrl'),
  pageFavicon:      $('pageFavicon'),
  contentTypeBadge: $('contentTypeBadge'),
  dedupBanner:      $('dedupBanner'),
  dedupText:        $('dedupText'),
  dedupReindexBtn:  $('dedupReindexBtn'),
  historyList:      $('historyList'),
  historyEmpty:     $('historyEmpty'),
  historyCount:     $('historyCount'),
  queueList:        $('queueList'),
  queueEmpty:       $('queueEmpty'),
  queueCount:       $('queueCount'),
  queueBadge:       $('queueBadge'),
  clearHistoryBtn:  $('clearHistoryBtn'),
  exportMarkdownBtn:$('exportMarkdownBtn'),
  flushQueueBtn:    $('flushQueueBtn'),
  settingsBtn:      $('settingsBtn'),
  closeSettingsBtn: $('closeSettingsBtn'),
  settingsDrawer:   $('settingsDrawer'),
  settingsOverlay:  $('settingsOverlay'),
  saveSettingsBtn:  $('saveSettingsBtn'),
  testEndpointBtn:  $('testEndpointBtn'),
  toastContainer:   $('toastContainer'),
  // settings fields
  settingEndpoint:     $('settingEndpoint'),
  settingApiKey:       $('settingApiKey'),
  settingTimeout:      $('settingTimeout'),
  settingDedup:        $('settingDedup'),
  settingChunkSize:    $('settingChunkSize'),
  settingNotifications:$('settingNotifications'),
  settingStorageMode:  $('settingStorageMode'),
  // endpoint settings groups (for conditional visibility)
  endpointSettingsGroup: $('endpointSettingsGroup'),
  endpointApiKeyGroup:   $('endpointApiKeyGroup'),
  // stats
  statTotal:   $('statTotal'),
  statToday:   $('statToday'),
  statWords:   $('statWords'),
  statQueued:  $('statQueued'),
  statDbRecords: $('statDbRecords'),
  statDbSize:    $('statDbSize'),
  domainList:  $('domainList'),
  tagList:     $('tagList'),
  // search
  searchInput:       $('searchInput'),
  searchResultCount: $('searchResultCount'),
  searchResults:     $('searchResults'),
  searchEmpty:       $('searchEmpty'),
  searchNoResults:   $('searchNoResults'),
  // clear local DB
  clearLocalDbBtn:   $('clearLocalDbBtn'),
  // chat
  chatContainer:     $('chatContainer'),
  chatInput:         $('chatInput'),
  chatSendBtn:       $('chatSendBtn'),
  clearChatBtn:      $('clearChatBtn'),
  chatContextLabel:  $('chatContextLabel'),
  chatProvider:      $('chatProvider'),
  chatApiKeyGroup:   $('chatApiKeyGroup'),
  chatApiKey:        $('chatApiKey'),
  ollamaHostGroup:   $('ollamaHostGroup'),
  ollamaHost:        $('ollamaHost'),
  ollamaModelGroup:  $('ollamaModelGroup'),
  ollamaModel:       $('ollamaModel'),
};

let currentTabUrl = '';
let currentTabTitle = '';
let isIndexing = false;
let currentHistory = [];
let dedupPendingOverride = false;
let searchDebounceTimer = null;
let currentStorageMode = 'local-only';

// Chat state (lazily initialized)
let chatUI = null;
let chatModule = null;
let chatInitialized = false;

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  await loadCurrentTab();
  await loadSettings();
  await updateStatusPillForMode();
  await loadHistory();
  await loadQueue();
  await loadStorageStats();
  bindEvents();
  startStatusPolling();
}

// ─── Load active tab info ─────────────────────────────────────────────────────
async function loadCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    currentTabUrl   = tab.url || '';
    currentTabTitle = tab.title || '';

    els.pageTitle.textContent = currentTabTitle || 'Unknown page';
    els.pageUrl.textContent   = currentTabTitle ? truncateUrl(currentTabUrl) : '—';

    // Favicon
    if (tab.favIconUrl) {
      const img = document.createElement('img');
      img.src = tab.favIconUrl;
      img.width = 16; img.height = 16;
      img.onerror = () => {};
      els.pageFavicon.innerHTML = '';
      els.pageFavicon.appendChild(img);
    }

    // Content type badge from URL heuristic
    const badge = urlToContentTypeBadge(currentTabUrl);
    els.contentTypeBadge.textContent = badge;
  } catch (_) {}
}

function urlToContentTypeBadge(url) {
  if (!url) return '';
  if (url.includes('github.com')) {
    if (/\/issues\//.test(url)) return 'GH Issue';
    if (/\/pull\//.test(url)) return 'GH PR';
    return 'GitHub';
  }
  if (url.includes('stackoverflow.com')) return 'Stack Overflow';
  if (url.includes('arxiv.org')) return 'arXiv';
  if (url.includes('news.ycombinator.com')) return 'HN';
  if (url.includes('developer.mozilla.org')) return 'MDN';
  if (url.match(/\/docs?\//i)) return 'Docs';
  return '';
}

// ─── Index current page ───────────────────────────────────────────────────────
async function indexCurrentPage(forceReindex = false) {
  if (isIndexing) return;

  // Dedup check
  if (!forceReindex && !dedupPendingOverride) {
    const { settings } = await chrome.storage.local.get('settings');
    const cfg = settings || DEFAULT_SETTINGS;
    if (cfg.dedupMode !== 'allow') {
      const { history = [] } = await chrome.storage.local.get('history');
      const urlHash = await hashString(currentTabUrl);
      const duplicate = history.find(h => h.urlHash === urlHash);
      if (duplicate) {
        if (cfg.dedupMode === 'skip') {
          setLog('skipped', `Already indexed · ${duplicate.domain}`);
          return;
        }
        showDedupBanner(duplicate);
        return;
      }
    }
  }

  hideDedupBanner();
  dedupPendingOverride = false;
  isIndexing = true;
  setIndexBtnState('loading');
  setLog('loading', 'Extracting content…');

  try {
    const response = await chrome.runtime.sendMessage({ type: 'INDEX_CURRENT_PAGE' });

    if (!response?.success) throw new Error(response?.error || 'Unknown error');

    const result = response.result;

    if (result?.status === 'sent' || result?.status === 'stored_locally' || result?.status === 'stored_and_sent') {
      setIndexBtnState('success');
      const label = result.status === 'stored_locally' ? 'Stored' : result.status === 'stored_and_sent' ? 'Stored & Sent' : 'Sent';
      setLog('success', `${label} · ${fmtNumber(result.wordCount)} words · "${truncate(result.title, 40)}"`);
      showToast(`✓ Indexed: ${fmtNumber(result.wordCount)} words`, 'success');
      await loadHistory();
      await checkStorageSizeWarning();
    } else if (result?.status === 'queued') {
      setIndexBtnState('default');
      setLog('queued', `Queued · endpoint unreachable · will retry`);
      showToast('Queued — endpoint offline, will retry', 'warning');
      await loadQueue();
    } else if (result?.status === 'skipped') {
      setIndexBtnState('default');
      setLog('skipped', `Skipped · ${result.reason}`);
    } else if (result?.status === 'failed') {
      throw new Error('Storage failed — check console for details');
    } else {
      throw new Error('Unexpected response status: ' + (result?.status || 'none'));
    }
  } catch (err) {
    setIndexBtnState('error');
    setLog('error', err.message || 'Extraction failed');
    showToast(`✗ ${err.message}`, 'error');
    console.error('[ContextBridge Panel] Error:', err);
  } finally {
    isIndexing = false;
    setTimeout(() => setIndexBtnState('default'), 2000);
  }
}

// ─── UI state helpers ─────────────────────────────────────────────────────────
function setIndexBtnState(state) {
  els.indexBtn.classList.remove('loading', 'success', 'error');

  switch (state) {
    case 'loading':
      els.indexBtn.classList.add('loading');
      els.indexBtnIcon.innerHTML = '<div class="spinner"></div>';
      els.indexBtnLabel.textContent = 'Indexing…';
      break;
    case 'success':
      els.indexBtn.classList.add('success');
      els.indexBtnIcon.innerHTML = successSVG();
      els.indexBtnLabel.textContent = 'Indexed!';
      break;
    case 'error':
      els.indexBtn.classList.add('error');
      els.indexBtnIcon.innerHTML = errorSVG();
      els.indexBtnLabel.textContent = 'Failed';
      break;
    default:
      els.indexBtnIcon.innerHTML = uploadSVG();
      els.indexBtnLabel.textContent = 'Index Current Page';
  }
}

function setLog(type, text) {
  const iconMap = { success: '●', error: '✗', loading: '◌', queued: '◐', skipped: '○', idle: '◦' };
  els.logEntry.className = `log-entry log-${type}`;
  els.logEntry.querySelector('.log-icon').textContent = iconMap[type] || '◦';
  els.logText.textContent = text;
}

// ─── Endpoint status ──────────────────────────────────────────────────────────
async function checkEndpointStatus() {
  setStatusPill('checking', 'Checking…');
  const response = await chrome.runtime.sendMessage({ type: 'HEALTH_CHECK' });
  const status = response?.status || 'offline';
  applyStatusPill(status);
}

function applyStatusPill(status) {
  if (status === 'online') {
    setStatusPill('online', 'Connected');
  } else if (status === 'offline') {
    setStatusPill('offline', 'Offline');
  }
}

function setStatusPill(cls, text) {
  els.statusPill.className = `status-pill ${cls}`;
  els.statusText.textContent = text;
}

// ─── Status pill behavior based on storage mode (Task 6.7) ────────────────────
async function updateStatusPillForMode() {
  const { settings } = await chrome.storage.local.get('settings');
  const cfg = { ...DEFAULT_SETTINGS, ...settings };
  currentStorageMode = cfg.storageMode || 'local-only';

  if (currentStorageMode === 'local-only') {
    setStatusPill('online', 'Local');
  } else {
    // endpoint-only or both: run health check
    await checkEndpointStatus();
  }
}

function startStatusPolling() {
  setInterval(async () => {
    if (currentStorageMode === 'local-only') {
      setStatusPill('online', 'Local');
    } else {
      const { endpointStatus } = await chrome.storage.local.get('endpointStatus');
      applyStatusPill(endpointStatus || 'offline');
    }
  }, 30_000);
}

// ─── History ──────────────────────────────────────────────────────────────────
async function loadHistory() {
  const { history = [] } = await chrome.storage.local.get('history');
  currentHistory = history;
  renderHistory(history);
  updateStats(history);
}

function renderHistory(history) {
  const count = history.length;
  els.historyCount.textContent = `${count} page${count !== 1 ? 's' : ''} indexed`;

  if (!count) {
    els.historyEmpty.classList.remove('hidden');
    Array.from(els.historyList.children).forEach(c => {
      if (!c.id) c.remove();
    });
    return;
  }

  els.historyEmpty.classList.add('hidden');

  // Re-render efficiently
  const existingItems = new Map(
    Array.from(els.historyList.querySelectorAll('.history-item')).map(el => [el.dataset.id, el])
  );

  history.slice(0, 30).forEach(item => {
    if (existingItems.has(item.id)) {
      existingItems.delete(item.id);
      return;
    }
    const el = createHistoryItem(item);
    els.historyList.insertBefore(el, els.historyEmpty);
  });

  // Remove stale items
  existingItems.forEach(el => el.remove());
}

function createHistoryItem(item) {
  const div = document.createElement('div');
  div.className = 'history-item';
  div.dataset.id = item.id;

  const isQueued = item.status === 'sent_from_queue';
  const timeStr  = formatRelativeTime(item.timestamp);
  const badgeText = formatContentType(item.contentType);

  div.innerHTML = `
    <div class="hi-top">
      <span class="hi-title" title="${escapeHtml(item.title)}">${escapeHtml(truncate(item.title, 50))}</span>
      ${badgeText ? `<span class="hi-badge ${isQueued ? 'queued' : ''}">${badgeText}</span>` : ''}
    </div>
    <div class="hi-meta">
      <span class="hi-domain">${item.domain || ''}</span>
      <span class="hi-sep">·</span>
      <span class="hi-time">${timeStr}</span>
      ${item.wordCount ? `<span class="hi-sep">·</span><span>${fmtNumber(item.wordCount)} words</span>` : ''}
    </div>
    <div class="hi-actions">
      <button class="hi-action-btn" data-action="open" title="Open URL">Open ↗</button>
      <button class="hi-action-btn" data-action="download" title="Download as Markdown">↓ MD</button>
      <button class="hi-action-btn" data-action="resend" title="Re-send">Re-send</button>
      <button class="hi-action-btn hi-delete-btn" data-action="delete" title="Delete record">Delete</button>
    </div>
  `;

  div.querySelector('[data-action="open"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.tabs.create({ url: item.url });
  });

  div.querySelector('[data-action="download"]')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      const response = await chrome.runtime.sendMessage({ type: 'EXPORT_MARKDOWN', ids: [item.id] });
      if (response?.dataUrl && response?.filename) {
        const a = document.createElement('a');
        a.href = response.dataUrl;
        a.download = response.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast(`✓ Downloaded: ${response.filename}`, 'success');
      } else {
        showToast('Download failed', 'error');
      }
    } catch (err) {
      showToast('Download failed', 'error');
    }
  });

  div.querySelector('[data-action="resend"]')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    showToast('Re-indexing…', 'info');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url !== item.url) {
      await chrome.tabs.update(tab.id, { url: item.url });
      setTimeout(() => indexCurrentPage(true), 2000);
    } else {
      await indexCurrentPage(true);
    }
  });

  div.querySelector('[data-action="delete"]')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await chrome.runtime.sendMessage({ type: 'DELETE_RECORD', id: item.id });
    div.remove();
    // Also remove from local history in chrome.storage
    const { history = [] } = await chrome.storage.local.get('history');
    const updated = history.filter(h => h.id !== item.id);
    await chrome.storage.local.set({ history: updated });
    currentHistory = updated;
    renderHistory(updated);
    updateStats(updated);
    await loadStorageStats();
    showToast('Record deleted', 'info');
  });

  return div;
}

// ─── Queue ─────────────────────────────────────────────────────────────────────
async function loadQueue() {
  const { queue = [] } = await chrome.storage.local.get('queue');
  renderQueue(queue);
}

function renderQueue(queue) {
  const count = queue.length;
  els.queueCount.textContent = `${count} item${count !== 1 ? 's' : ''} pending`;

  if (count > 0) {
    els.queueBadge.textContent = count;
    els.queueBadge.classList.remove('hidden');
  } else {
    els.queueBadge.classList.add('hidden');
  }

  if (!count) {
    els.queueEmpty.classList.remove('hidden');
    Array.from(els.queueList.children).forEach(c => { if (!c.id) c.remove(); });
    return;
  }
  els.queueEmpty.classList.add('hidden');
  els.queueList.innerHTML = '';

  queue.slice(0, 20).forEach(item => {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `
      <div class="hi-top">
        <span class="hi-title">${escapeHtml(truncate(item.title, 50))}</span>
        <span class="hi-badge queued">Queued</span>
      </div>
      <div class="hi-meta">
        <span class="hi-domain">${item.meta?.domain || ''}</span>
        <span class="hi-sep">·</span>
        <span>Retry ${item._retries || 0}/3</span>
      </div>
    `;
    els.queueList.appendChild(div);
  });
}

// ─── Stats ────────────────────────────────────────────────────────────────────
async function updateStats(history) {
  const today = new Date().toDateString();
  const todayItems = history.filter(h => new Date(h.timestamp).toDateString() === today);
  const totalWords = history.reduce((acc, h) => acc + (h.wordCount || 0), 0);
  const { queue = [] } = await chrome.storage.local.get('queue');

  animateNumber(els.statTotal, history.length);
  animateNumber(els.statToday, todayItems.length);
  animateNumber(els.statWords, totalWords);
  animateNumber(els.statQueued, queue.length);

  // Domain breakdown
  const domainCounts = {};
  history.forEach(h => {
    if (h.domain) domainCounts[h.domain] = (domainCounts[h.domain] || 0) + 1;
  });
  const sorted = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = sorted[0]?.[1] || 1;
  els.domainList.innerHTML = sorted.map(([domain, count]) => `
    <div class="domain-row">
      <span class="domain-name">${domain}</span>
      <div class="domain-bar-wrap">
        <div class="domain-bar" style="width:${(count/max*100).toFixed(0)}%"></div>
      </div>
      <span class="domain-count">${count}</span>
    </div>
  `).join('');

  // Tag cloud
  const tagCounts = {};
  history.forEach(h => (h.tags || []).forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
  const tagsSorted = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 16);
  els.tagList.innerHTML = `<div class="tag-list">${tagsSorted.map(([tag]) =>
    `<span class="tag-chip">${tag}</span>`
  ).join('')}</div>`;
}

// ─── Storage Stats (Task 6.5) ─────────────────────────────────────────────────
async function loadStorageStats() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STORAGE_INFO' });
    if (response) {
      els.statDbRecords.textContent = response.count || 0;
      const sizeMB = response.sizeMB != null ? response.sizeMB : ((response.sizeBytes || 0) / (1024 * 1024)).toFixed(1);
      els.statDbSize.textContent = typeof sizeMB === 'number' ? sizeMB.toFixed(1) : sizeMB;
    }
  } catch (_) {
    els.statDbRecords.textContent = '—';
    els.statDbSize.textContent = '—';
  }
}

// ─── Storage Size Warning (Task 6.6) ─────────────────────────────────────────
async function checkStorageSizeWarning() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STORAGE_INFO' });
    if (response) {
      const sizeMB = response.sizeMB != null ? response.sizeMB : ((response.sizeBytes || 0) / (1024 * 1024));
      if (sizeMB > 500) {
        showToast('⚠️ Local storage exceeds 500MB. Consider exporting and clearing old content.', 'warning', 6000);
      }
    }
  } catch (_) {}
}

// ─── Search (Task 6.2) ───────────────────────────────────────────────────────
function handleSearchInput() {
  const query = els.searchInput.value.trim();

  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }

  if (!query) {
    clearSearchResults();
    return;
  }

  searchDebounceTimer = setTimeout(async () => {
    await performSearch(query);
  }, 300);
}

async function performSearch(query) {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'SEARCH_QUERY', query });
    const results = response?.results || [];
    renderSearchResults(results);
  } catch (err) {
    console.error('[ContextBridge] Search error:', err);
    showToast('Search failed', 'error');
  }
}

function renderSearchResults(results) {
  // Clear existing result items (not the empty states)
  els.searchResults.querySelectorAll('.search-result-item').forEach(el => el.remove());

  if (results.length === 0) {
    els.searchEmpty.classList.add('hidden');
    els.searchNoResults.classList.remove('hidden');
    els.searchResultCount.classList.add('hidden');
    return;
  }

  els.searchEmpty.classList.add('hidden');
  els.searchNoResults.classList.add('hidden');
  els.searchResultCount.textContent = `${results.length} result${results.length !== 1 ? 's' : ''}`;
  els.searchResultCount.classList.remove('hidden');

  results.forEach(result => {
    const div = document.createElement('div');
    div.className = 'search-result-item';
    div.innerHTML = `
      <div class="sr-title">${escapeHtml(result.title || 'Untitled')}</div>
      <div class="sr-meta">
        <span class="sr-domain">${escapeHtml(result.domain || '')}</span>
        ${result.wordCount ? `<span class="sr-sep">·</span><span>${fmtNumber(result.wordCount)} words</span>` : ''}
      </div>
      ${result.snippet ? `<div class="sr-snippet">${result.snippet}</div>` : ''}
    `;
    div.addEventListener('click', () => {
      chrome.tabs.create({ url: result.url });
    });
    els.searchResults.appendChild(div);
  });
}

function clearSearchResults() {
  els.searchResults.querySelectorAll('.search-result-item').forEach(el => el.remove());
  els.searchEmpty.classList.remove('hidden');
  els.searchNoResults.classList.add('hidden');
  els.searchResultCount.classList.add('hidden');
}

// ─── Export (Task 6.3) ────────────────────────────────────────────────────────
async function handleExportMarkdown() {
  try {
    showToast('Exporting…', 'info');
    const response = await chrome.runtime.sendMessage({ type: 'EXPORT_MARKDOWN', ids: null });

    if (!response || response.error) {
      showToast(response?.error || 'Export failed', 'error');
      return;
    }

    // The background returns a dataUrl for download
    if (response.dataUrl && response.filename) {
      const a = document.createElement('a');
      a.href = response.dataUrl;
      a.download = response.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast(`✓ Exported: ${response.filename}`, 'success');
    } else if (response.blob && response.filename) {
      // Fallback: blob URL approach
      const url = URL.createObjectURL(response.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = response.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`✓ Exported: ${response.filename}`, 'success');
    } else {
      showToast('Nothing to export', 'warning');
    }
  } catch (err) {
    console.error('[ContextBridge] Export error:', err);
    showToast('Export failed', 'error');
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const cfg = { ...DEFAULT_SETTINGS, ...settings };

  els.settingEndpoint.value     = cfg.endpoint;
  els.settingApiKey.value       = cfg.apiKey || '';
  els.settingTimeout.value      = cfg.timeoutMs;
  els.settingDedup.value        = cfg.dedupMode;
  els.settingChunkSize.value    = cfg.chunkSize;
  els.settingNotifications.checked = cfg.notifications !== false;
  els.settingStorageMode.value  = cfg.storageMode || 'local-only';

  currentStorageMode = cfg.storageMode || 'local-only';
  updateEndpointSettingsVisibility(currentStorageMode);

  // Load chat provider settings
  const chatSettings = await chrome.storage.local.get(['chatProvider', 'chatApiKey', 'chatModel', 'ollamaHost']);
  if (els.chatProvider) {
    els.chatProvider.value = chatSettings.chatProvider || 'claude';
  }
  if (els.chatApiKey) {
    els.chatApiKey.value = chatSettings.chatApiKey || '';
  }
  if (els.ollamaHost) {
    els.ollamaHost.value = chatSettings.ollamaHost || 'http://localhost:11434';
  }
  if (els.ollamaModel) {
    els.ollamaModel.value = chatSettings.chatModel || 'llama3';
  }
  updateChatProviderSettingsVisibility(chatSettings.chatProvider || 'claude');
}

async function saveSettings() {
  const storageMode = els.settingStorageMode.value;
  const settings = {
    endpoint:      els.settingEndpoint.value.trim() || DEFAULT_SETTINGS.endpoint,
    apiKey:        els.settingApiKey.value.trim(),
    timeoutMs:     parseInt(els.settingTimeout.value) || DEFAULT_SETTINGS.timeoutMs,
    dedupMode:     els.settingDedup.value,
    chunkSize:     parseInt(els.settingChunkSize.value) || DEFAULT_SETTINGS.chunkSize,
    notifications: els.settingNotifications.checked,
    storageMode:   storageMode,
  };

  // Save chat provider settings alongside existing settings
  const chatProvider = els.chatProvider ? els.chatProvider.value : 'claude';
  const chatApiKeyValue = els.chatApiKey ? els.chatApiKey.value.trim() : '';
  const ollamaHostValue = els.ollamaHost ? els.ollamaHost.value.trim() : 'http://localhost:11434';
  const ollamaModelValue = els.ollamaModel ? els.ollamaModel.value.trim() : 'llama3';

  await chrome.storage.local.set({
    settings,
    chatProvider,
    chatApiKey: chatApiKeyValue,
    chatModel: ollamaModelValue,
    ollamaHost: ollamaHostValue,
  });

  currentStorageMode = storageMode;
  closeSettings();
  showToast('Settings saved', 'success');
  await updateStatusPillForMode();
}

function updateChatProviderSettingsVisibility(provider) {
  if (els.ollamaHostGroup && els.ollamaModelGroup && els.chatApiKeyGroup) {
    const isOllama = provider === 'ollama';
    els.ollamaHostGroup.classList.toggle('hidden', !isOllama);
    els.ollamaModelGroup.classList.toggle('hidden', !isOllama);
    els.chatApiKeyGroup.classList.toggle('hidden', isOllama);
  }
}

function updateEndpointSettingsVisibility(mode) {
  const showEndpoint = (mode === 'endpoint-only' || mode === 'both');
  if (els.endpointSettingsGroup) {
    els.endpointSettingsGroup.classList.toggle('hidden', !showEndpoint);
  }
  if (els.endpointApiKeyGroup) {
    els.endpointApiKeyGroup.classList.toggle('hidden', !showEndpoint);
  }
}

function openSettings()  {
  els.settingsDrawer.classList.remove('hidden');
  els.settingsOverlay.classList.remove('hidden');
}
function closeSettings() {
  els.settingsDrawer.classList.add('hidden');
  els.settingsOverlay.classList.add('hidden');
}

// ─── Dedup banner ─────────────────────────────────────────────────────────────
function showDedupBanner(duplicate) {
  els.dedupBanner.classList.remove('hidden');
  els.dedupText.textContent = `Already indexed ${formatRelativeTime(duplicate.timestamp)} — re-index?`;
}
function hideDedupBanner() {
  els.dedupBanner.classList.add('hidden');
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function bindTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panelId = 'panel' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1);
      document.getElementById(panelId)?.classList.add('active');

      if (tab.dataset.tab === 'stats') {
        updateStats(currentHistory);
        loadStorageStats();
      }

      if (tab.dataset.tab === 'chat') {
        activateChatTab();
      }
    });
  });
}

// ─── Event binding ─────────────────────────────────────────────────────────────
function bindEvents() {
  els.indexBtn.addEventListener('click', () => indexCurrentPage());

  els.dedupReindexBtn.addEventListener('click', () => {
    dedupPendingOverride = true;
    hideDedupBanner();
    indexCurrentPage(true);
  });

  els.settingsBtn.addEventListener('click', openSettings);
  els.closeSettingsBtn.addEventListener('click', closeSettings);
  els.settingsOverlay.addEventListener('click', closeSettings);
  els.saveSettingsBtn.addEventListener('click', saveSettings);

  // Storage mode change → update endpoint visibility
  els.settingStorageMode.addEventListener('change', () => {
    updateEndpointSettingsVisibility(els.settingStorageMode.value);
  });

  // Chat provider change → update ollama/apikey visibility
  if (els.chatProvider) {
    els.chatProvider.addEventListener('change', () => {
      updateChatProviderSettingsVisibility(els.chatProvider.value);
    });
  }

  els.testEndpointBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    showToast('Testing connection…', 'info');
    const response = await chrome.runtime.sendMessage({ type: 'HEALTH_CHECK' });
    if (response?.status === 'online') {
      showToast('✓ Endpoint reachable', 'success');
    } else {
      showToast('✗ Endpoint unreachable', 'error');
    }
    applyStatusPill(response?.status || 'offline');
  });

  els.clearHistoryBtn.addEventListener('click', async () => {
    if (!confirm('Clear all indexing history?')) return;
    await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
    await loadHistory();
    showToast('History cleared', 'info');
  });

  els.flushQueueBtn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'FLUSH_QUEUE' });
    showToast('Flushing queue…', 'info');
    setTimeout(loadQueue, 1500);
  });

  // Export button (Task 6.3)
  els.exportMarkdownBtn.addEventListener('click', handleExportMarkdown);

  // Search input (Task 6.2)
  els.searchInput.addEventListener('keyup', handleSearchInput);
  els.searchInput.addEventListener('input', handleSearchInput);

  // Clear local DB (Task 6.5)
  els.clearLocalDbBtn.addEventListener('click', async () => {
    if (!confirm('Delete all locally stored content records? This cannot be undone.')) return;
    await chrome.runtime.sendMessage({ type: 'CLEAR_LOCAL_DB' });
    await loadStorageStats();
    showToast('Local storage cleared', 'success');
  });

  bindTabs();

  // Listen for background messages
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'HEALTH_STATUS')    applyStatusPill(message.status);
    if (message.type === 'INDEXED_SUCCESS')  { loadHistory(); loadStorageStats(); }
    if (message.type === 'QUEUE_FLUSHED')   { loadQueue(); loadHistory(); }
    if (message.type === 'QUEUED')           loadQueue();
  });

  // Tab change → refresh page info and update chat context
  chrome.tabs.onActivated.addListener(() => {
    setTimeout(async () => {
      await loadCurrentTab();
      await updateChatContextForActiveTab();
    }, 100);
  });
  chrome.tabs.onUpdated.addListener((_id, change) => {
    if (change.status === 'complete') setTimeout(async () => {
      await loadCurrentTab();
      await updateChatContextForActiveTab();
    }, 100);
  });
}

// ─── Chat Tab (Task 6.3) ──────────────────────────────────────────────────────

/**
 * Initialize ChatUI and ChatModule lazily on first Chat tab activation.
 */
function initChat() {
  if (chatInitialized) return;

  chatUI = new ChatUI(els.chatContainer);
  // The HTML already has input area outside chatContainer, so remove the one ChatUI created
  // and point ChatUI's input references to the HTML elements
  if (chatUI.inputArea && chatUI.inputArea.parentNode) {
    chatUI.inputArea.remove();
  }
  chatUI.inputEl = els.chatInput;
  chatUI.sendBtn = els.chatSendBtn;

  const providerFactory = { getProvider, getDefaultModel };
  chatModule = new ChatModule(chatUI, providerFactory);
  chatInitialized = true;

  // Wire send button
  els.chatSendBtn.addEventListener('click', handleChatSend);

  // Wire Enter key on chat input
  els.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChatSend();
    }
  });

  // Wire clear chat button
  els.clearChatBtn.addEventListener('click', () => {
    // Abort any active stream
    if (chatModule.activeAbortController) {
      chatModule.activeAbortController.abort();
      chatModule.activeAbortController = null;
    }
    chatModule.clearConversation();
    chatUI.clearMessages();
    els.chatContextLabel.textContent = 'No page loaded';
  });
}

/**
 * Handle sending a chat message from the input.
 */
async function handleChatSend() {
  const text = els.chatInput.value.trim();
  if (!text) return;
  els.chatInput.value = '';
  await chatModule.sendMessage(text);
}

/**
 * Activate the Chat tab — initialize if needed, then load context.
 */
async function activateChatTab() {
  initChat();
  await loadChatContext();
}

/**
 * Load chat context for the current browser tab URL.
 * Handles "no record" and "no API key" states.
 */
async function loadChatContext() {
  if (!chatModule || !chatUI) return;

  // Check for API key first
  const { chatApiKey: apiKey } = await chrome.storage.local.get('chatApiKey');
  if (!apiKey) {
    chatUI.clearMessages();
    chatUI.showApiKeyPrompt();
    els.chatContextLabel.textContent = 'No API key';
    return;
  }

  // Load context for current tab URL
  const result = await chatModule.loadContext(currentTabUrl);

  if (result.success && result.record) {
    // Context loaded — show context pill
    const domain = extractDomain(currentTabUrl);
    chatUI.clearMessages();
    chatUI.renderContextPill(result.record.title || 'Untitled', domain);
    els.chatContextLabel.textContent = truncate(result.record.title || domain, 30);
  } else {
    // No record — show index prompt
    chatUI.clearMessages();
    chatUI.showIndexPrompt(async () => {
      await indexCurrentPage(true);
      // After indexing, try loading context again
      setTimeout(() => loadChatContext(), 1500);
    });
    els.chatContextLabel.textContent = 'Page not indexed';
  }
}

/**
 * Update chat context when the active browser tab changes.
 * Only updates if the Chat tab is currently visible.
 */
async function updateChatContextForActiveTab() {
  // Only update if chat tab is active
  const chatTabActive = document.querySelector('.tab[data-tab="chat"]')?.classList.contains('active');
  if (!chatTabActive || !chatInitialized) return;

  // Abort any active stream before switching context
  if (chatModule && chatModule.activeAbortController) {
    chatModule.activeAbortController.abort();
    chatModule.activeAbortController = null;
  }

  // Clear conversation when context changes
  if (chatModule) {
    chatModule.clearConversation();
  }

  await loadChatContext();
}

/**
 * Extract domain from a URL string.
 */
function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// ─── Toast ────────────────────────────────────────────────────────────────────
async function showToast(message, type = 'info', duration = 3000) {
  const { settings } = await chrome.storage.local.get('settings');
  if (settings && settings.notifications === false) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  els.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toast-out 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '…' : str;
}

function truncateUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + u.pathname.slice(0, 40);
  } catch { return url; }
}

function escapeHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtNumber(n) {
  if (!n && n !== 0) return '0';
  return n.toLocaleString();
}

function formatContentType(type) {
  const map = {
    api_docs: 'Docs', tutorial: 'Tutorial', github_issue: 'GH Issue',
    github_pr: 'PR', github_readme: 'README', stack_overflow: 'SO',
    arxiv_paper: 'arXiv', blog_post: 'Blog', hn_thread: 'HN', generic: '',
  };
  return map[type] || '';
}

function formatRelativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function animateNumber(el, target) {
  const start = parseInt(el.textContent) || 0;
  if (start === target) return;
  const duration = 400;
  const startTime = performance.now();
  function update(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const value = Math.round(start + (target - start) * easeOut(progress));
    el.textContent = fmtNumber(value);
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

async function hashString(str) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

function uploadSVG() {
  return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M12 5v14M5 12l7-7 7 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
function successSVG() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
function errorSVG() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2.5"/>
    <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2.5"/>
  </svg>`;
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
