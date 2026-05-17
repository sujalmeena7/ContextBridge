/**
 * Unit tests for src/background/db.js — IndexedDB Manager
 * Uses fake-indexeddb to simulate IndexedDB in Node.js
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  openDB,
  putRecord,
  getRecord,
  getRecordByUrl,
  getAllRecords,
  deleteRecord,
  clearAllRecords,
  getRecordCount,
  getStorageEstimate,
} from '../src/background/db.js';

// Reset the DB instance between tests by clearing the module cache
// fake-indexeddb/auto sets up global indexedDB automatically

function makeRecord(overrides = {}) {
  return {
    id: 'abc123def456gh78',
    url: 'https://example.com/page',
    title: 'Example Page',
    domain: 'example.com',
    rawContent: 'This is the full text content of the page.',
    chunks: [{ index: 0, text: 'chunk one', start: 0, end: 9 }],
    codeBlocks: [{ language: 'javascript', code: 'console.log("hi")', lines: 1 }],
    tags: ['javascript', 'tutorial'],
    wordCount: 42,
    contentType: 'blog_post',
    indexedAt: '2024-01-15T10:30:00.000Z',
    ...overrides,
  };
}

describe('IndexedDB Manager', () => {
  beforeEach(async () => {
    // Clear all records before each test
    try {
      await clearAllRecords();
    } catch {
      // DB might not be open yet on first test, that's fine
    }
  });

  describe('openDB', () => {
    it('should open the database successfully', async () => {
      const db = await openDB();
      expect(db).toBeDefined();
      expect(db.name).toBe('contextbridge_db');
      expect(db.version).toBe(1);
    });

    it('should create the content_records object store', async () => {
      const db = await openDB();
      expect(db.objectStoreNames.contains('content_records')).toBe(true);
    });

    it('should return the same instance on subsequent calls', async () => {
      const db1 = await openDB();
      const db2 = await openDB();
      expect(db1).toBe(db2);
    });
  });

  describe('putRecord', () => {
    it('should store a record and return it with updatedAt set', async () => {
      const record = makeRecord();
      const stored = await putRecord(record);

      expect(stored.id).toBe(record.id);
      expect(stored.url).toBe(record.url);
      expect(stored.title).toBe(record.title);
      expect(stored.updatedAt).toBeDefined();
      expect(new Date(stored.updatedAt).toISOString()).toBe(stored.updatedAt);
    });

    it('should preserve existing indexedAt timestamp', async () => {
      const record = makeRecord({ indexedAt: '2024-01-01T00:00:00.000Z' });
      const stored = await putRecord(record);

      expect(stored.indexedAt).toBe('2024-01-01T00:00:00.000Z');
    });

    it('should set indexedAt if not provided', async () => {
      const record = makeRecord();
      delete record.indexedAt;
      const stored = await putRecord(record);

      expect(stored.indexedAt).toBeDefined();
      expect(new Date(stored.indexedAt).toISOString()).toBe(stored.indexedAt);
    });

    it('should upsert — update existing record with same id', async () => {
      const record = makeRecord();
      await putRecord(record);

      const updated = makeRecord({ title: 'Updated Title' });
      const stored = await putRecord(updated);

      expect(stored.title).toBe('Updated Title');

      const count = await getRecordCount();
      expect(count).toBe(1);
    });
  });

  describe('getRecord', () => {
    it('should retrieve a stored record by id', async () => {
      const record = makeRecord();
      await putRecord(record);

      const retrieved = await getRecord(record.id);
      expect(retrieved).toBeDefined();
      expect(retrieved.id).toBe(record.id);
      expect(retrieved.url).toBe(record.url);
      expect(retrieved.title).toBe(record.title);
    });

    it('should return undefined for non-existent id', async () => {
      const retrieved = await getRecord('nonexistent_id_00');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('getRecordByUrl', () => {
    it('should retrieve a stored record by URL using the url index', async () => {
      const record = makeRecord();
      await putRecord(record);

      const retrieved = await getRecordByUrl('https://example.com/page');
      expect(retrieved).toBeDefined();
      expect(retrieved.id).toBe(record.id);
      expect(retrieved.url).toBe(record.url);
      expect(retrieved.title).toBe(record.title);
    });

    it('should return null for non-existent URL', async () => {
      const retrieved = await getRecordByUrl('https://nonexistent.com/page');
      expect(retrieved).toBeNull();
    });

    it('should return null when store is empty', async () => {
      const retrieved = await getRecordByUrl('https://example.com/page');
      expect(retrieved).toBeNull();
    });

    it('should find the correct record among multiple records', async () => {
      await putRecord(makeRecord({ id: 'id_001', url: 'https://a.com/page1', title: 'Page A' }));
      await putRecord(makeRecord({ id: 'id_002', url: 'https://b.com/page2', title: 'Page B' }));
      await putRecord(makeRecord({ id: 'id_003', url: 'https://c.com/page3', title: 'Page C' }));

      const retrieved = await getRecordByUrl('https://b.com/page2');
      expect(retrieved).toBeDefined();
      expect(retrieved.id).toBe('id_002');
      expect(retrieved.title).toBe('Page B');
    });
  });

  describe('getAllRecords', () => {
    it('should return all stored records', async () => {
      await putRecord(makeRecord({ id: 'id_001', url: 'https://a.com' }));
      await putRecord(makeRecord({ id: 'id_002', url: 'https://b.com' }));
      await putRecord(makeRecord({ id: 'id_003', url: 'https://c.com' }));

      const all = await getAllRecords();
      expect(all).toHaveLength(3);
    });

    it('should return empty array when no records exist', async () => {
      const all = await getAllRecords();
      expect(all).toHaveLength(0);
    });
  });

  describe('deleteRecord', () => {
    it('should remove a record by id', async () => {
      await putRecord(makeRecord());
      await deleteRecord('abc123def456gh78');

      const retrieved = await getRecord('abc123def456gh78');
      expect(retrieved).toBeUndefined();
    });

    it('should not throw when deleting non-existent id', async () => {
      await expect(deleteRecord('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('clearAllRecords', () => {
    it('should remove all records', async () => {
      await putRecord(makeRecord({ id: 'id_001', url: 'https://a.com' }));
      await putRecord(makeRecord({ id: 'id_002', url: 'https://b.com' }));

      await clearAllRecords();

      const all = await getAllRecords();
      expect(all).toHaveLength(0);
    });
  });

  describe('getRecordCount', () => {
    it('should return 0 for empty store', async () => {
      const count = await getRecordCount();
      expect(count).toBe(0);
    });

    it('should return correct count after inserts', async () => {
      await putRecord(makeRecord({ id: 'id_001', url: 'https://a.com' }));
      await putRecord(makeRecord({ id: 'id_002', url: 'https://b.com' }));

      const count = await getRecordCount();
      expect(count).toBe(2);
    });
  });

  describe('getStorageEstimate', () => {
    it('should return count and sizeBytes', async () => {
      vi.stubGlobal('navigator', {
        storage: {
          estimate: vi.fn().mockResolvedValue({ usage: 1024, quota: 1000000 }),
        },
      });

      await putRecord(makeRecord({ id: 'id_001', url: 'https://a.com' }));

      const estimate = await getStorageEstimate();
      expect(estimate.count).toBe(1);
      expect(estimate.sizeBytes).toBe(1024);

      vi.unstubAllGlobals();
    });

    it('should return 0 sizeBytes when navigator.storage is unavailable', async () => {
      vi.stubGlobal('navigator', {});

      const estimate = await getStorageEstimate();
      expect(estimate.sizeBytes).toBe(0);

      vi.unstubAllGlobals();
    });
  });
});
