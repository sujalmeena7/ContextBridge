/**
 * Property-based tests for storage mode routing (Properties 4 & 5).
 * Feature: local-storage-search
 *
 * Tests verify that handleExtractedContent routes correctly based on storageMode,
 * and that failures in one path do not prevent execution of the other.
 *
 * Validates: Requirements 2.2, 2.3, 2.4, 2.7, 2.8
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';

// ─── Track calls to putRecord and fetch ──────────────────────────────────────

let putRecordCalls = [];
let putRecordShouldFail = false;
let fetchCalls = [];
let fetchShouldFail = false;

// Mock db.js — track putRecord calls
vi.mock('../src/background/db.js', () => ({
  putRecord: vi.fn(async (record) => {
    putRecordCalls.push(record);
    if (putRecordShouldFail) {
      throw new Error('IndexedDB write failed');
    }
    return record;
  }),
  deleteRecord: vi.fn().mockResolvedValue(undefined),
  clearAllRecords: vi.fn().mockResolvedValue(undefined),
  getStorageEstimate: vi.fn().mockResolvedValue({ count: 0, sizeBytes: 0 }),
  openDB: vi.fn().mockResolvedValue({}),
  getRecord: vi.fn().mockResolvedValue(undefined),
  getAllRecords: vi.fn().mockResolvedValue([]),
}));

// Mock search.js
vi.mock('../src/background/search.js', () => ({
  searchRecords: vi.fn().mockResolvedValue([]),
}));

// Mock exporter.js
vi.mock('../src/background/exporter.js', () => ({
  exportRecords: vi.fn().mockResolvedValue({ blob: new Blob(), filename: 'test.md' }),
}));

// ─── Chrome API mock setup ───────────────────────────────────────────────────

let messageListener = null;
let storedData = {};

function setupChromeMock(storageMode) {
  storedData = {
    settings: {
      endpoint: 'http://localhost:8000/v1/context',
      apiKey: '',
      timeoutMs: 8000,
      dedupMode: 'warn',
      chunkSize: 1200,
      chunkOverlap: 150,
      autoIndex: false,
      notifications: true,
      theme: 'light',
      storageMode,
    },
    history: [],
    queue: [],
  };

  const chromeMock = {
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      onMessage: {
        addListener: vi.fn((listener) => {
          messageListener = listener;
        }),
      },
      sendMessage: vi.fn().mockImplementation(() => Promise.resolve()),
    },
    storage: {
      local: {
        get: vi.fn((keys) => {
          if (typeof keys === 'string') {
            return Promise.resolve({ [keys]: storedData[keys] });
          }
          if (Array.isArray(keys)) {
            const result = {};
            keys.forEach((k) => { result[k] = storedData[k]; });
            return Promise.resolve(result);
          }
          return Promise.resolve(storedData);
        }),
        set: vi.fn((data) => {
          Object.assign(storedData, data);
          return Promise.resolve();
        }),
      },
    },
    alarms: {
      create: vi.fn(),
      onAlarm: { addListener: vi.fn() },
    },
    commands: {
      onCommand: { addListener: vi.fn() },
    },
    action: {
      onClicked: { addListener: vi.fn() },
    },
    sidePanel: {
      open: vi.fn().mockResolvedValue(undefined),
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]),
      create: vi.fn(),
    },
    scripting: {
      executeScript: vi.fn(),
    },
  };

  vi.stubGlobal('chrome', chromeMock);
}

function setupCryptoMock() {
  vi.stubGlobal('crypto', {
    subtle: {
      digest: vi.fn(async (algo, data) => {
        // Simple deterministic mock hash
        const bytes = new Uint8Array(data);
        const hash = new Uint8Array(32);
        for (let i = 0; i < bytes.length; i++) {
          hash[i % 32] = (hash[i % 32] + bytes[i]) & 0xff;
        }
        return hash.buffer;
      }),
    },
    randomUUID: vi.fn(() => 'test-uuid-1234'),
  });
}

function setupFetchMock() {
  const mockFetch = vi.fn(async () => {
    fetchCalls.push(true);
    if (fetchShouldFail) {
      throw new Error('Network error');
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({}),
    };
  });
  vi.stubGlobal('fetch', mockFetch);
  return mockFetch;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Sends a CONTENT_EXTRACTED message through the worker's message listener
 * and returns the response.
 */
function sendContentExtracted(payload) {
  return new Promise((resolve) => {
    messageListener(
      { type: 'CONTENT_EXTRACTED', payload },
      { tab: { id: 1 } },
      resolve
    );
  });
}

/**
 * Generates a word string with at least `minWords` words to pass the quality gate.
 */
function generateWordsArb(minWords = 60) {
  return fc.array(
    fc.stringOf(fc.char().filter(c => c !== ' ' && c !== '\n' && c !== '\t' && c.charCodeAt(0) > 32), { minLength: 3, maxLength: 12 }),
    { minLength: minWords, maxLength: minWords + 50 }
  ).map(words => words.join(' '));
}

/**
 * fast-check arbitrary for generating valid extracted content payloads
 * that will pass the quality gate (word count >= 50).
 */
const extractedPayloadArb = fc.record({
  title: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
  url: fc.webUrl(),
  raw_content: generateWordsArb(60),
  chunks: fc.constant([{ index: 0, text: 'chunk text here for testing', start: 0, end: 27 }]),
  codeBlocks: fc.constant([]),
  meta: fc.record({
    domain: fc.domain(),
    contentType: fc.constantFrom('blog_post', 'api_docs', 'github_issue', 'tutorial'),
    tags: fc.array(fc.stringOf(fc.char().filter(c => c.charCodeAt(0) > 32), { minLength: 2, maxLength: 10 }), { minLength: 0, maxLength: 3 }),
    readabilityScore: fc.integer({ min: 0, max: 100 }),
    extractionMode: fc.constant('safe'),
    language: fc.constant('en'),
    content_length: fc.integer({ min: 200, max: 1000 }),
    word_count: fc.integer({ min: 60, max: 200 }),
    code_block_count: fc.constant(0),
    chunk_count: fc.constant(1),
  }),
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Feature: local-storage-search, Property 4: Storage mode routing correctness', () => {
  beforeEach(async () => {
    vi.resetModules();
    putRecordCalls = [];
    fetchCalls = [];
    putRecordShouldFail = false;
    fetchShouldFail = false;
    messageListener = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('WHEN storageMode is "local-only", SHALL write to IndexedDB and SHALL NOT call the endpoint', async () => {
    setupChromeMock('local-only');
    setupCryptoMock();
    setupFetchMock();

    // Import worker to register the message listener
    await import('../src/background/worker.js');
    expect(messageListener).not.toBeNull();

    await fc.assert(
      fc.asyncProperty(extractedPayloadArb, async (payload) => {
        putRecordCalls = [];
        fetchCalls = [];

        await sendContentExtracted(payload);

        // SHALL write to IndexedDB
        expect(putRecordCalls.length).toBeGreaterThan(0);
        // SHALL NOT call the endpoint
        expect(fetchCalls.length).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  it('WHEN storageMode is "endpoint-only", SHALL call the endpoint and SHALL NOT write to IndexedDB', async () => {
    setupChromeMock('endpoint-only');
    setupCryptoMock();
    setupFetchMock();

    await import('../src/background/worker.js');
    expect(messageListener).not.toBeNull();

    await fc.assert(
      fc.asyncProperty(extractedPayloadArb, async (payload) => {
        putRecordCalls = [];
        fetchCalls = [];

        await sendContentExtracted(payload);

        // SHALL call the endpoint
        expect(fetchCalls.length).toBeGreaterThan(0);
        // SHALL NOT write to IndexedDB
        expect(putRecordCalls.length).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  it('WHEN storageMode is "both", SHALL both write to IndexedDB and call the endpoint', async () => {
    setupChromeMock('both');
    setupCryptoMock();
    setupFetchMock();

    await import('../src/background/worker.js');
    expect(messageListener).not.toBeNull();

    await fc.assert(
      fc.asyncProperty(extractedPayloadArb, async (payload) => {
        putRecordCalls = [];
        fetchCalls = [];

        await sendContentExtracted(payload);

        // SHALL write to IndexedDB
        expect(putRecordCalls.length).toBeGreaterThan(0);
        // SHALL call the endpoint
        expect(fetchCalls.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: local-storage-search, Property 5: Storage mode path independence', () => {
  beforeEach(async () => {
    vi.resetModules();
    putRecordCalls = [];
    fetchCalls = [];
    putRecordShouldFail = false;
    fetchShouldFail = false;
    messageListener = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('WHEN storageMode is "both" and IndexedDB write fails, the endpoint POST SHALL still be attempted', async () => {
    setupChromeMock('both');
    setupCryptoMock();
    setupFetchMock();
    putRecordShouldFail = true;

    await import('../src/background/worker.js');
    expect(messageListener).not.toBeNull();

    await fc.assert(
      fc.asyncProperty(extractedPayloadArb, async (payload) => {
        putRecordCalls = [];
        fetchCalls = [];

        await sendContentExtracted(payload);

        // IndexedDB was attempted (and failed)
        expect(putRecordCalls.length).toBeGreaterThan(0);
        // Endpoint SHALL still be attempted despite IndexedDB failure
        expect(fetchCalls.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('WHEN storageMode is "both" and endpoint POST fails, the IndexedDB write SHALL still be attempted', async () => {
    setupChromeMock('both');
    setupCryptoMock();
    setupFetchMock();
    fetchShouldFail = true;

    await import('../src/background/worker.js');
    expect(messageListener).not.toBeNull();

    await fc.assert(
      fc.asyncProperty(extractedPayloadArb, async (payload) => {
        putRecordCalls = [];
        fetchCalls = [];

        await sendContentExtracted(payload);

        // IndexedDB write SHALL still be attempted and succeed
        expect(putRecordCalls.length).toBeGreaterThan(0);
        // Endpoint was attempted (and failed)
        expect(fetchCalls.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });
});
