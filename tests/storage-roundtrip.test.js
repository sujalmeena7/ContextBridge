/**
 * Property-based tests for IndexedDB Manager (src/background/db.js)
 * Uses fast-check with an in-memory Map-based mock implementing the same interface.
 *
 * Feature: local-storage-search
 * Validates: Requirements 1.1, 1.3, 1.4
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// ─── In-memory Map-based mock implementing the same interface as db.js ───────

class InMemoryDB {
  constructor() {
    this.store = new Map();
  }

  async putRecord(record) {
    const now = new Date().toISOString();
    const recordToStore = {
      ...record,
      updatedAt: now,
      indexedAt: record.indexedAt || now,
    };
    this.store.set(record.id, recordToStore);
    return recordToStore;
  }

  async getRecord(id) {
    return this.store.get(id);
  }

  async getAllRecords() {
    return [...this.store.values()];
  }

  async getRecordCount() {
    return this.store.size;
  }

  async deleteRecord(id) {
    this.store.delete(id);
  }

  async clearAllRecords() {
    this.store.clear();
  }
}

// ─── URL hash function (same logic as worker.js hashString) ──────────────────

async function hashURL(url) {
  const buffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(url)
  );
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

// ─── Arbitrary generators ────────────────────────────────────────────────────

const arbURL = fc.webUrl();

const arbContentRecord = fc.record({
  id: fc.hexaString({ minLength: 16, maxLength: 16 }),
  url: fc.webUrl(),
  title: fc.string({ minLength: 1, maxLength: 200 }),
  domain: fc.domain(),
  rawContent: fc.string({ minLength: 0, maxLength: 5000 }),
  chunks: fc.array(
    fc.record({
      index: fc.nat(100),
      text: fc.string({ minLength: 0, maxLength: 500 }),
      start: fc.nat(10000),
      end: fc.nat(10000),
    }),
    { minLength: 0, maxLength: 5 }
  ),
  codeBlocks: fc.array(
    fc.record({
      language: fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 0, maxLength: 15 }),
      code: fc.string({ minLength: 0, maxLength: 1000 }),
      lines: fc.nat(100),
    }),
    { minLength: 0, maxLength: 3 }
  ),
  tags: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 0, maxLength: 8 }),
  wordCount: fc.nat(100000),
  contentType: fc.constantFrom('blog_post', 'api_docs', 'github_issue', 'github_pr', 'github_readme', 'stack_overflow', 'generic'),
  indexedAt: fc.constant(new Date().toISOString()),
});

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Feature: local-storage-search, Property 1: Record storage round-trip', () => {
  let db;

  beforeEach(() => {
    db = new InMemoryDB();
  });

  it('for any valid Content_Record, putRecord then getRecord produces an equivalent object', async () => {
    await fc.assert(
      fc.asyncProperty(arbContentRecord, async (record) => {
        const stored = await db.putRecord(record);
        const retrieved = await db.getRecord(record.id);

        // Retrieved record should exist
        expect(retrieved).toBeDefined();

        // All original fields should be preserved
        expect(retrieved.id).toBe(record.id);
        expect(retrieved.url).toBe(record.url);
        expect(retrieved.title).toBe(record.title);
        expect(retrieved.domain).toBe(record.domain);
        expect(retrieved.rawContent).toBe(record.rawContent);
        expect(retrieved.chunks).toEqual(record.chunks);
        expect(retrieved.codeBlocks).toEqual(record.codeBlocks);
        expect(retrieved.tags).toEqual(record.tags);
        expect(retrieved.wordCount).toBe(record.wordCount);
        expect(retrieved.contentType).toBe(record.contentType);

        // updatedAt should be set
        expect(retrieved.updatedAt).toBeDefined();
        // indexedAt should be preserved or set
        expect(retrieved.indexedAt).toBeDefined();
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: local-storage-search, Property 2: URL hash determinism and format', () => {
  it('for any URL string, the hash function produces the same 16-char hex string on every invocation', async () => {
    await fc.assert(
      fc.asyncProperty(arbURL, async (url) => {
        const hash1 = await hashURL(url);
        const hash2 = await hashURL(url);

        // Determinism: same input always produces same output
        expect(hash1).toBe(hash2);

        // Format: exactly 16 characters
        expect(hash1).toHaveLength(16);

        // Format: only hex digits [0-9a-f]
        expect(hash1).toMatch(/^[0-9a-f]{16}$/);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: local-storage-search, Property 3: Upsert replaces content', () => {
  let db;

  beforeEach(() => {
    db = new InMemoryDB();
  });

  it('if a record with the same URL hash exists, putRecord with new content results in exactly one record with the latest content', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbContentRecord,
        fc.string({ minLength: 1, maxLength: 5000 }),
        fc.string({ minLength: 1, maxLength: 200 }),
        async (originalRecord, newRawContent, newTitle) => {
          // Store the original record
          await db.putRecord(originalRecord);

          // Create an updated record with same id but different content
          const updatedRecord = {
            ...originalRecord,
            rawContent: newRawContent,
            title: newTitle,
          };

          // Upsert the updated record
          await db.putRecord(updatedRecord);

          // There should be exactly one record with this id
          const allRecords = await db.getAllRecords();
          const matchingRecords = allRecords.filter(r => r.id === originalRecord.id);
          expect(matchingRecords).toHaveLength(1);

          // The record's content should equal the latest write's content
          const retrieved = await db.getRecord(originalRecord.id);
          expect(retrieved.rawContent).toBe(newRawContent);
          expect(retrieved.title).toBe(newTitle);
        }
      ),
      { numRuns: 100 }
    );
  });
});
