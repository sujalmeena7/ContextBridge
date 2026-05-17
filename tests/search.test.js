import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tokenize, matchesQuery, searchRecords } from '../src/background/search.js';

// Mock the db module
vi.mock('../src/background/db.js', () => ({
  getAllRecords: vi.fn(),
}));

import { getAllRecords } from '../src/background/db.js';

describe('tokenize', () => {
  it('splits on whitespace and normalizes to lowercase', () => {
    const result = tokenize('Hello World');
    expect(result).toEqual(['hello', 'world']);
  });

  it('splits on punctuation', () => {
    const result = tokenize('foo,bar.baz!qux');
    expect(result).toEqual(['foo', 'bar', 'baz', 'qux']);
  });

  it('handles mixed whitespace and punctuation', () => {
    const result = tokenize('Hello, World! How are you?');
    expect(result).toEqual(['hello', 'world', 'how', 'are', 'you']);
  });

  it('filters empty tokens', () => {
    const result = tokenize('  hello   world  ');
    expect(result).toEqual(['hello', 'world']);
  });

  it('returns empty array for null/undefined/empty input', () => {
    expect(tokenize(null)).toEqual([]);
    expect(tokenize(undefined)).toEqual([]);
    expect(tokenize('')).toEqual([]);
  });

  it('handles unicode punctuation', () => {
    const result = tokenize('café—latte');
    expect(result).toEqual(['café', 'latte']);
  });
});

describe('matchesQuery', () => {
  const record = {
    title: 'JavaScript Tutorial',
    rawContent: 'Learn JavaScript programming with examples and exercises.',
    tags: ['javascript', 'tutorial', 'beginner'],
  };

  it('returns matches:true when all query tokens are found', () => {
    const queryTokens = tokenize('javascript tutorial');
    const result = matchesQuery(record, queryTokens);
    expect(result.matches).toBe(true);
  });

  it('returns matches:false when not all query tokens are found', () => {
    const queryTokens = tokenize('python tutorial');
    const result = matchesQuery(record, queryTokens);
    expect(result.matches).toBe(false);
  });

  it('returns snippets with <mark> tags around matched terms', () => {
    const queryTokens = tokenize('javascript');
    const result = matchesQuery(record, queryTokens);
    expect(result.matches).toBe(true);
    expect(result.snippets.length).toBeGreaterThan(0);
    expect(result.snippets[0]).toContain('<mark>');
    expect(result.snippets[0]).toContain('</mark>');
  });

  it('is case-insensitive', () => {
    const queryTokens = tokenize('JAVASCRIPT');
    const result = matchesQuery(record, queryTokens);
    expect(result.matches).toBe(true);
  });

  it('matches tokens in tags', () => {
    const queryTokens = tokenize('beginner');
    const result = matchesQuery(record, queryTokens);
    expect(result.matches).toBe(true);
  });

  it('returns matches:false for empty query tokens', () => {
    const result = matchesQuery(record, []);
    expect(result.matches).toBe(false);
  });

  it('returns matches:false for null query tokens', () => {
    const result = matchesQuery(record, null);
    expect(result.matches).toBe(false);
  });

  it('generates snippets of approximately 150 chars', () => {
    const longRecord = {
      title: 'Test',
      rawContent: 'a '.repeat(200) + 'targetword ' + 'b '.repeat(200),
      tags: [],
    };
    const queryTokens = tokenize('targetword');
    const result = matchesQuery(longRecord, queryTokens);
    expect(result.matches).toBe(true);
    // Snippet should be roughly 150 chars (plus mark tags and ellipsis)
    const plainSnippet = result.snippets[0].replace(/<\/?mark>/g, '').replace(/\.\.\./g, '');
    expect(plainSnippet.length).toBeLessThanOrEqual(200);
  });
});

describe('searchRecords', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns matching records sorted by matchCount descending', async () => {
    getAllRecords.mockResolvedValue([
      {
        id: '1',
        title: 'JavaScript Guide',
        url: 'https://example.com/js',
        domain: 'example.com',
        rawContent: 'JavaScript is a programming language. JavaScript is versatile.',
        tags: ['javascript'],
        wordCount: 10,
      },
      {
        id: '2',
        title: 'Python Guide',
        url: 'https://example.com/py',
        domain: 'example.com',
        rawContent: 'Python is a programming language.',
        tags: ['python'],
        wordCount: 6,
      },
      {
        id: '3',
        title: 'CSS Basics',
        url: 'https://example.com/css',
        domain: 'example.com',
        rawContent: 'CSS is used for styling web pages.',
        tags: ['css'],
        wordCount: 7,
      },
    ]);

    const results = await searchRecords('javascript');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('1');
    expect(results[0].title).toBe('JavaScript Guide');
    expect(results[0].snippet).toContain('<mark>');
  });

  it('returns empty array for empty query', async () => {
    const results = await searchRecords('');
    expect(results).toEqual([]);
  });

  it('returns empty array for null query', async () => {
    const results = await searchRecords(null);
    expect(results).toEqual([]);
  });

  it('returns results with correct shape', async () => {
    getAllRecords.mockResolvedValue([
      {
        id: 'abc123',
        title: 'Test Page',
        url: 'https://test.com/page',
        domain: 'test.com',
        rawContent: 'This is test content for searching.',
        tags: ['test'],
        wordCount: 42,
      },
    ]);

    const results = await searchRecords('test');
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveProperty('id', 'abc123');
    expect(results[0]).toHaveProperty('title', 'Test Page');
    expect(results[0]).toHaveProperty('url', 'https://test.com/page');
    expect(results[0]).toHaveProperty('domain', 'test.com');
    expect(results[0]).toHaveProperty('wordCount', 42);
    expect(results[0]).toHaveProperty('snippet');
    expect(results[0]).toHaveProperty('matchCount');
    expect(results[0].matchCount).toBeGreaterThan(0);
  });

  it('sorts results by matchCount descending', async () => {
    getAllRecords.mockResolvedValue([
      {
        id: '1',
        title: 'One mention of code',
        url: 'https://a.com',
        domain: 'a.com',
        rawContent: 'This has code once.',
        tags: [],
        wordCount: 5,
      },
      {
        id: '2',
        title: 'Code code code',
        url: 'https://b.com',
        domain: 'b.com',
        rawContent: 'Code is great. Code is everywhere. Code is life.',
        tags: ['code'],
        wordCount: 12,
      },
    ]);

    const results = await searchRecords('code');
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('2'); // more matches
    expect(results[1].id).toBe('1');
    expect(results[0].matchCount).toBeGreaterThan(results[1].matchCount);
  });
});
