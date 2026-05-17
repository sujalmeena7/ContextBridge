/**
 * Property-based tests for Search Scanner
 * Feature: local-storage-search
 * Tests Properties 6 and 7 from the design document.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { tokenize, matchesQuery, searchRecords } from '../src/background/search.js';

// Mock the db module
vi.mock('../src/background/db.js', () => ({
  getAllRecords: vi.fn(),
}));

import { getAllRecords } from '../src/background/db.js';

/**
 * Arbitrary for generating a valid Content_Record.
 * Generates records with non-empty title, rawContent, and tags
 * to ensure meaningful search scenarios.
 */
const contentRecordArb = fc.record({
  id: fc.hexaString({ minLength: 16, maxLength: 16 }),
  url: fc.webUrl(),
  title: fc.string({ minLength: 1, maxLength: 200 }).filter(s => /[a-zA-Z]/.test(s)),
  domain: fc.domain(),
  rawContent: fc.string({ minLength: 1, maxLength: 2000 }).filter(s => /[a-zA-Z]/.test(s)),
  tags: fc.array(fc.string({ minLength: 1, maxLength: 30 }).filter(s => /^[a-zA-Z][a-zA-Z0-9-]*$/.test(s)), { minLength: 0, maxLength: 5 }),
  wordCount: fc.nat({ max: 100000 }),
  contentType: fc.constantFrom('blog_post', 'api_docs', 'github_issue', 'documentation'),
  indexedAt: fc.date().map(d => d.toISOString()),
  updatedAt: fc.date().map(d => d.toISOString()),
});

/**
 * Helper: extract a word-like substring from a text field that will
 * survive tokenization (i.e., it's a single token after tokenize).
 * We pick a random token from the tokenized output of the field.
 */
function pickTokenFromField(fieldValue) {
  const tokens = tokenize(fieldValue);
  if (tokens.length === 0) return null;
  return tokens[Math.floor(Math.random() * tokens.length)];
}

describe('Feature: local-storage-search, Property 6: Search correctness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('searchRecords returns a record when queried with a token from its title', async () => {
    await fc.assert(
      fc.asyncProperty(contentRecordArb, async (record) => {
        // Pick a token from the record's title
        const tokens = tokenize(record.title);
        fc.pre(tokens.length > 0);
        const queryToken = tokens[0];

        getAllRecords.mockResolvedValue([record]);

        const results = await searchRecords(queryToken);

        // The record should appear in results
        const found = results.find(r => r.id === record.id);
        expect(found).toBeDefined();

        // Result should include required fields
        expect(found).toHaveProperty('title', record.title);
        expect(found).toHaveProperty('domain', record.domain);
        expect(found).toHaveProperty('wordCount', record.wordCount);
        expect(found).toHaveProperty('snippet');
        expect(found.snippet.length).toBeGreaterThan(0);

        // Snippet should contain the matched term (case-insensitive, inside <mark> tags)
        const snippetLower = found.snippet.toLowerCase();
        expect(snippetLower).toContain(queryToken.toLowerCase());
      }),
      { numRuns: 100 }
    );
  });

  it('searchRecords returns a record when queried with a token from its rawContent', async () => {
    await fc.assert(
      fc.asyncProperty(contentRecordArb, async (record) => {
        // Pick a token from the record's rawContent
        const tokens = tokenize(record.rawContent);
        fc.pre(tokens.length > 0);
        const queryToken = tokens[0];

        getAllRecords.mockResolvedValue([record]);

        const results = await searchRecords(queryToken);

        // The record should appear in results
        const found = results.find(r => r.id === record.id);
        expect(found).toBeDefined();

        // Result should include required fields
        expect(found).toHaveProperty('title', record.title);
        expect(found).toHaveProperty('domain', record.domain);
        expect(found).toHaveProperty('wordCount', record.wordCount);
        expect(found).toHaveProperty('snippet');
        expect(found.snippet.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('searchRecords returns a record when queried with a token from its tags', async () => {
    await fc.assert(
      fc.asyncProperty(contentRecordArb, async (record) => {
        // Pick a token from the record's tags
        fc.pre(record.tags.length > 0);
        const allTagText = record.tags.join(' ');
        const tokens = tokenize(allTagText);
        fc.pre(tokens.length > 0);
        const queryToken = tokens[0];

        getAllRecords.mockResolvedValue([record]);

        const results = await searchRecords(queryToken);

        // The record should appear in results
        const found = results.find(r => r.id === record.id);
        expect(found).toBeDefined();

        // Result should include required fields
        expect(found).toHaveProperty('title', record.title);
        expect(found).toHaveProperty('domain', record.domain);
        expect(found).toHaveProperty('wordCount', record.wordCount);
        expect(found).toHaveProperty('snippet');
      }),
      { numRuns: 100 }
    );
  });

  it('each search result includes page title, domain, wordCount, and a snippet with the matched term', async () => {
    await fc.assert(
      fc.asyncProperty(contentRecordArb, async (record) => {
        // Pick a token from any field
        const fullText = `${record.title} ${record.rawContent} ${record.tags.join(' ')}`;
        const tokens = tokenize(fullText);
        fc.pre(tokens.length > 0);
        const queryToken = tokens[0];

        getAllRecords.mockResolvedValue([record]);

        const results = await searchRecords(queryToken);
        const found = results.find(r => r.id === record.id);
        expect(found).toBeDefined();

        // Validate result shape
        expect(typeof found.title).toBe('string');
        expect(typeof found.domain).toBe('string');
        expect(typeof found.wordCount).toBe('number');
        expect(typeof found.snippet).toBe('string');

        // Snippet should contain the query token (possibly inside <mark> tags)
        const plainSnippet = found.snippet.replace(/<\/?mark>/g, '').toLowerCase();
        expect(plainSnippet).toContain(queryToken.toLowerCase());
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: local-storage-search, Property 7: Tokenizer normalization', () => {
  it('all tokens are lowercase', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 500 }), (input) => {
        const tokens = tokenize(input);
        for (const token of tokens) {
          expect(token).toBe(token.toLowerCase());
        }
      }),
      { numRuns: 100 }
    );
  });

  it('no token contains whitespace', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 500 }), (input) => {
        const tokens = tokenize(input);
        for (const token of tokens) {
          expect(token).not.toMatch(/\s/);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('no token is punctuation-only', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 500 }), (input) => {
        const tokens = tokenize(input);
        for (const token of tokens) {
          // A punctuation-only token would match /^\p{P}+$/u
          expect(token).not.toMatch(/^[\p{P}]+$/u);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('tokenizing the same string twice produces identical results (idempotency)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 500 }), (input) => {
        const first = tokenize(input);
        const second = tokenize(input);
        expect(first).toEqual(second);
      }),
      { numRuns: 100 }
    );
  });
});
