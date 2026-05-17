/**
 * Integration tests for the full index pipeline (handleExtractedContent).
 * Tests storage mode routing: local-only, endpoint-only, both, and error isolation.
 *
 * Validates: Requirements 2.2, 2.3, 2.4, 7.2, 7.3
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Set up chrome & crypto globals before worker.js module loads ─────────────
const mockStorageData = {};

vi.hoisted(() => {
  const storageData = {};

  globalThis.__testStorageData = storageData;

  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const result = {};
          const keyList = Array.isArray(keys) ? keys : [keys];
          for (const key of keyList) {
            if (storageData[key] !== undefined) {
              result[key] = storageData[key];
            }
          }
          return result;
        },
        set: async (data) => {
          Object.assign(storageData, data);
        },
      },
    },
    runtime: {
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      onMessage: { addListener: () => {} },
      sendMessage: () => Promise.reject(new Error('no listener')),
    },
    alarms: {
      create: () => {},
      onAlarm: { addListener: () => {} },
    },
    commands: {
      onCommand: { addListener: () => {} },
    },
    action: {
      onClicked: { addListener: () => {} },
    },
    sidePanel: {
      open: () => {},
    },
    tabs: {
      query: async () => [{ id: 1, url: 'https://example.com' }],
    },
    scripting: {
      executeScript: async () => {},
    },
  };

  // Mock crypto.subtle for hashString
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      subtle: {
        digest: async (algo, data) => {
          const bytes = new Uint8Array(data);
          const hash = new Uint8Array(32);
          for (let i = 0; i < bytes.length; i++) {
            hash[i % 32] = (hash[i % 32] + bytes[i]) % 256;
          }
          return hash.buffer;
        },
      },
      randomUUID: () => 'mock-uuid-1234',
    },
    writable: true,
    configurable: true,
  });

  // Mock fetch — use a holder object so tests can swap the implementation
  globalThis.__mockFetchImpl = async () => ({ ok: true, json: async () => ({}) });
  globalThis.fetch = (...args) => globalThis.__mockFetchImpl(...args);
});

// Mock db.js
vi.mock('../src/background/db.js', () => ({
  putRecord: vi.fn().mockResolvedValue({}),
  deleteRecord: vi.fn().mockResolvedValue(),
  clearAllRecords: vi.fn().mockResolvedValue(),
  getStorageEstimate: vi.fn().mockResolvedValue({ count: 5, sizeBytes: 1024 }),
  openDB: vi.fn().mockResolvedValue({}),
}));

// Mock search.js
vi.mock('../src/background/search.js', () => ({
  searchRecords: vi.fn().mockResolvedValue([]),
}));

// Mock exporter.js
vi.mock('../src/background/exporter.js', () => ({
  exportRecords: vi.fn().mockResolvedValue({ blob: new Blob(['test']), filename: 'test.md' }),
}));

import { handleExtractedContent } from '../src/background/worker.js';
import { putRecord } from '../src/background/db.js';

// Reference to the shared storage data object
const storageData = globalThis.__testStorageData;

// Helper: create a valid extracted content payload
function makePayload(overrides = {}) {
  return {
    title: 'Test Page',
    url: 'https://example.com/test-page',
    raw_content: 'This is a test page with enough words to pass the quality gate. ' +
      'We need at least fifty words in the content to avoid being rejected as low signal. ' +
      'Adding more words here to ensure we pass the minimum threshold for indexing content. ' +
      'Some additional filler text to make sure we are well above the fifty word minimum.',
    chunks: [{ index: 0, text: 'chunk text', start: 0, end: 10 }],
    codeBlocks: [{ language: 'javascript', code: 'const x = 1;', lines: 1 }],
    meta: {
      domain: 'example.com',
      contentType: 'blog_post',
      tags: ['javascript'],
      readabilityScore: 75,
      extractionMode: 'safe',
      language: 'en',
      content_length: 200,
      word_count: 60,
      code_block_count: 1,
      chunk_count: 1,
    },
    ...overrides,
  };
}

// Track fetch calls manually
let fetchCalls = [];

describe('Pipeline Integration: handleExtractedContent', () => {
  beforeEach(() => {
    // Clear vi mocks (putRecord, etc.)
    vi.clearAllMocks();

    // Reset storage data
    Object.keys(storageData).forEach(key => delete storageData[key]);

    // Default settings: local-only mode
    storageData.settings = {
      endpoint: 'http://localhost:8000/v1/context',
      apiKey: '',
      timeoutMs: 8000,
      dedupMode: 'warn',
      chunkSize: 1200,
      chunkOverlap: 150,
      autoIndex: false,
      notifications: true,
      theme: 'light',
      storageMode: 'local-only',
    };
    storageData.history = [];
    storageData.queue = [];

    // Reset fetch tracking
    fetchCalls = [];
    globalThis.__mockFetchImpl = async (...args) => {
      fetchCalls.push(args);
      return { ok: true, json: async () => ({ success: true }) };
    };
  });

  describe('storageMode: "local-only"', () => {
    /**
     * Validates: Requirement 2.2
     * WHEN Storage_Mode is "local-only", store content exclusively in IndexedDB
     * and skip endpoint transmission.
     */
    it('should write to IndexedDB and NOT call fetch', async () => {
      storageData.settings.storageMode = 'local-only';

      const result = await handleExtractedContent(makePayload());

      // putRecord should have been called with a content record
      expect(putRecord).toHaveBeenCalledTimes(1);
      const storedRecord = putRecord.mock.calls[0][0];
      expect(storedRecord.url).toBe('https://example.com/test-page');
      expect(storedRecord.title).toBe('Test Page');
      expect(storedRecord.domain).toBe('example.com');
      expect(storedRecord.rawContent).toBeDefined();
      expect(storedRecord.chunks).toBeDefined();
      expect(storedRecord.tags).toEqual(['javascript']);

      // fetch should NOT have been called
      expect(fetchCalls).toHaveLength(0);

      // Result should indicate local storage
      expect(result.status).toBe('stored_locally');
      expect(result.source).toBe('local-only');
    });

    it('should add a history entry with source "local-only"', async () => {
      storageData.settings.storageMode = 'local-only';

      await handleExtractedContent(makePayload());

      // History should have been updated in storageData
      expect(storageData.history).toBeDefined();
      expect(storageData.history.length).toBeGreaterThan(0);
      expect(storageData.history[0].source).toBe('local-only');
      expect(storageData.history[0].status).toBe('stored_locally');
    });
  });

  describe('storageMode: "endpoint-only"', () => {
    /**
     * Validates: Requirement 2.3
     * WHEN Storage_Mode is "endpoint-only", send content to the configured endpoint
     * and skip local IndexedDB storage.
     */
    it('should call fetch and NOT write to IndexedDB', async () => {
      storageData.settings.storageMode = 'endpoint-only';

      const result = await handleExtractedContent(makePayload());

      // putRecord should NOT have been called
      expect(putRecord).not.toHaveBeenCalled();

      // fetch should have been called with the endpoint
      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0][0]).toBe('http://localhost:8000/v1/context');
      expect(fetchCalls[0][1].method).toBe('POST');
      expect(fetchCalls[0][1].headers['Content-Type']).toBe('application/json');

      // Result should indicate sent
      expect(result.status).toBe('sent');
      expect(result.source).toBe('endpoint-only');
    });

    /**
     * Validates: Requirement 7.3
     * WHEN the configured endpoint is unreachable, queue the content for retry.
     */
    it('should queue content when endpoint fails', async () => {
      storageData.settings.storageMode = 'endpoint-only';
      globalThis.__mockFetchImpl = async () => { throw new Error('Network error'); };

      const result = await handleExtractedContent(makePayload());

      // putRecord should NOT have been called
      expect(putRecord).not.toHaveBeenCalled();

      // Result should indicate queued
      expect(result.status).toBe('queued');

      // Queue should have an entry
      expect(storageData.queue.length).toBe(1);
      expect(storageData.queue[0]._retries).toBe(0);
    });
  });

  describe('storageMode: "both"', () => {
    /**
     * Validates: Requirement 2.4
     * WHEN Storage_Mode is "both", initiate IndexedDB write and endpoint POST
     * as independent operations.
     */
    it('should write to IndexedDB AND call fetch', async () => {
      storageData.settings.storageMode = 'both';

      const result = await handleExtractedContent(makePayload());

      // Both paths should execute
      expect(putRecord).toHaveBeenCalledTimes(1);
      expect(fetchCalls).toHaveLength(1);

      // Result should indicate both succeeded
      expect(result.status).toBe('stored_and_sent');
      expect(result.source).toBe('both');
    });

    /**
     * Validates: Requirements 2.4, 2.7 (error isolation)
     * IF the IndexedDB write fails while Storage_Mode is "both",
     * the endpoint POST SHALL still be attempted.
     */
    it('should still call endpoint when IndexedDB write fails', async () => {
      storageData.settings.storageMode = 'both';
      putRecord.mockRejectedValueOnce(new Error('IndexedDB write failed'));

      const result = await handleExtractedContent(makePayload());

      // Both paths should have been attempted
      expect(putRecord).toHaveBeenCalledTimes(1);
      expect(fetchCalls).toHaveLength(1);

      // Result should indicate endpoint succeeded despite local failure
      expect(result.status).toBe('sent');
    });

    /**
     * Validates: Requirements 2.4, 2.8 (error isolation)
     * IF the endpoint POST fails while Storage_Mode is "both",
     * the IndexedDB write SHALL still succeed.
     */
    it('should still write to IndexedDB when endpoint fails', async () => {
      storageData.settings.storageMode = 'both';
      globalThis.__mockFetchImpl = async () => { throw new Error('Network error'); };

      const result = await handleExtractedContent(makePayload());

      // Both paths should have been attempted
      expect(putRecord).toHaveBeenCalledTimes(1);

      // Result should indicate local storage succeeded despite endpoint failure
      expect(result.status).toBe('stored_locally');
    });

    it('should queue endpoint retry when endpoint fails in "both" mode', async () => {
      storageData.settings.storageMode = 'both';
      globalThis.__mockFetchImpl = async () => { throw new Error('Network error'); };

      await handleExtractedContent(makePayload());

      // Queue should have an entry for endpoint retry
      expect(storageData.queue.length).toBe(1);
      expect(storageData.queue[0]._retries).toBe(0);
    });

    it('should report "failed" when both paths fail', async () => {
      storageData.settings.storageMode = 'both';
      putRecord.mockRejectedValueOnce(new Error('IndexedDB write failed'));
      globalThis.__mockFetchImpl = async () => { throw new Error('Network error'); };

      const result = await handleExtractedContent(makePayload());

      expect(result.status).toBe('failed');
    });
  });

  describe('endpoint settings preserved (Requirement 7.2)', () => {
    /**
     * Validates: Requirement 7.2
     * WHEN Storage_Mode is "endpoint-only" or "both", send extracted content
     * to the configured endpoint using the existing POST format.
     */
    it('should use configured endpoint URL', async () => {
      storageData.settings.storageMode = 'endpoint-only';
      storageData.settings.endpoint = 'http://custom-server:9000/api/ingest';

      await handleExtractedContent(makePayload());

      expect(fetchCalls[0][0]).toBe('http://custom-server:9000/api/ingest');
    });

    it('should include API key in Authorization header when configured', async () => {
      storageData.settings.storageMode = 'endpoint-only';
      storageData.settings.apiKey = 'my-secret-key';

      await handleExtractedContent(makePayload());

      expect(fetchCalls[0][1].headers.Authorization).toBe('Bearer my-secret-key');
    });

    it('should send POST body with correct schema', async () => {
      storageData.settings.storageMode = 'endpoint-only';

      await handleExtractedContent(makePayload());

      const body = JSON.parse(fetchCalls[0][1].body);

      expect(body).toHaveProperty('id');
      expect(body).toHaveProperty('title', 'Test Page');
      expect(body).toHaveProperty('url', 'https://example.com/test-page');
      expect(body).toHaveProperty('timestamp');
      expect(body).toHaveProperty('tags');
      expect(body).toHaveProperty('metrics');
      expect(body).toHaveProperty('chunks');
      expect(body).toHaveProperty('code_blocks');
      expect(body).toHaveProperty('raw_content_backup');
      expect(body).toHaveProperty('meta');
      expect(body.meta).toHaveProperty('domain', 'example.com');
      expect(body.meta).toHaveProperty('content_type', 'blog_post');
    });
  });

  describe('quality gate and dedup', () => {
    it('should skip content with fewer than 50 words', async () => {
      const result = await handleExtractedContent(makePayload({
        raw_content: 'Too short content here.',
      }));

      expect(result.status).toBe('skipped');
      expect(result.reason).toBe('low_signal');
      expect(putRecord).not.toHaveBeenCalled();
      expect(fetchCalls).toHaveLength(0);
    });

    it('should skip duplicate URLs when dedupMode is "skip"', async () => {
      storageData.settings.dedupMode = 'skip';

      // First call — should succeed and add to history
      await handleExtractedContent(makePayload());

      // Reset putRecord tracking but keep storage state (history persisted)
      putRecord.mockClear();
      fetchCalls = [];

      // Second call with same URL — should be skipped
      const result = await handleExtractedContent(makePayload());

      expect(result.status).toBe('skipped');
      expect(result.reason).toBe('duplicate');
    });
  });
});
