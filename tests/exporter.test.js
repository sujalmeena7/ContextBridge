/**
 * Unit tests for the Markdown Exporter module.
 * Tests sanitizeFilename, escapeMarkdown, recordToMarkdown, and exportRecords.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sanitizeFilename, escapeMarkdown, recordToMarkdown, exportRecords } from '../src/background/exporter.js';

// Mock db.js
vi.mock('../src/background/db.js', () => ({
  getAllRecords: vi.fn(),
  getRecord: vi.fn(),
}));

// No JSZip mock needed — we use concatenated markdown for multi-file export

import { getAllRecords, getRecord } from '../src/background/db.js';

function makeRecord(overrides = {}) {
  return {
    id: 'abc123',
    title: 'Test Page Title',
    url: 'https://example.com/page',
    domain: 'example.com',
    rawContent: '# Heading\n\nSome paragraph text.\n\n```javascript\nconst x = 1;\n```\n',
    chunks: [],
    codeBlocks: [{ language: 'javascript', code: 'const x = 1;', lines: 1 }],
    tags: ['javascript', 'api'],
    wordCount: 42,
    contentType: 'api_docs',
    indexedAt: '2024-01-15T10:30:00.000Z',
    updatedAt: '2024-01-15T10:30:00.000Z',
    ...overrides,
  };
}

describe('sanitizeFilename', () => {
  it('should produce a valid filename from a normal title', () => {
    const result = sanitizeFilename('My Page Title');
    expect(result).toBe('My-Page-Title.md');
  });

  it('should remove invalid filesystem characters', () => {
    const result = sanitizeFilename('File: "test" <page> | data?');
    expect(result).toBe('File-test-page-data.md');
  });

  it('should replace spaces with hyphens', () => {
    const result = sanitizeFilename('hello world foo');
    expect(result).toBe('hello-world-foo.md');
  });

  it('should truncate to 96 chars + .md extension', () => {
    const longTitle = 'a'.repeat(200);
    const result = sanitizeFilename(longTitle);
    // 96 chars + '.md' = 99 chars total
    expect(result.length).toBeLessThanOrEqual(99);
    expect(result).toMatch(/\.md$/);
  });

  it('should handle empty/null title', () => {
    expect(sanitizeFilename('')).toBe('untitled.md');
    expect(sanitizeFilename(null)).toBe('untitled.md');
    expect(sanitizeFilename(undefined)).toBe('untitled.md');
  });

  it('should handle title with only invalid characters', () => {
    expect(sanitizeFilename('???***')).toBe('untitled.md');
  });

  it('should remove control characters', () => {
    const result = sanitizeFilename('hello\x00world\x1f');
    expect(result).toBe('helloworld.md');
  });

  it('should not contain invalid chars in result', () => {
    const result = sanitizeFilename('a<b>c:d"e/f\\g|h?i*j');
    expect(result).not.toMatch(/[<>:"/\\|?*]/);
    expect(result).toMatch(/\.md$/);
  });
});

describe('escapeMarkdown', () => {
  it('should escape special characters in plain text', () => {
    const result = escapeMarkdown('Use *bold* and _italic_');
    expect(result).toBe('Use \\*bold\\* and \\_italic\\_');
  });

  it('should escape # in plain text', () => {
    const result = escapeMarkdown('C# programming');
    expect(result).toBe('C\\# programming');
  });

  it('should escape [ and ]', () => {
    const result = escapeMarkdown('array[0] and [link]');
    expect(result).toBe('array\\[0\\] and \\[link\\]');
  });

  it('should NOT escape content inside fenced code blocks', () => {
    const input = 'text *bold*\n```\ncode *not escaped*\n```\nmore *text*';
    const result = escapeMarkdown(input);
    expect(result).toContain('code *not escaped*');
    expect(result).toContain('text \\*bold\\*');
    expect(result).toContain('more \\*text\\*');
  });

  it('should NOT escape content inside inline code', () => {
    const input = 'Use `*bold*` for emphasis';
    const result = escapeMarkdown(input);
    expect(result).toBe('Use `*bold*` for emphasis');
  });

  it('should handle empty input', () => {
    expect(escapeMarkdown('')).toBe('');
    expect(escapeMarkdown(null)).toBe('');
  });
});

describe('recordToMarkdown', () => {
  it('should produce valid YAML frontmatter', () => {
    const record = makeRecord();
    const result = recordToMarkdown(record);

    expect(result).toContain('---');
    expect(result).toContain('title: "Test Page Title"');
    expect(result).toContain('url: "https://example.com/page"');
    expect(result).toContain('domain: "example.com"');
    expect(result).toContain('tags: [javascript, api]');
    expect(result).toContain('content_type: "api_docs"');
    expect(result).toContain('word_count: 42');
    expect(result).toContain('indexed_at: "2024-01-15T10:30:00.000Z"');
  });

  it('should preserve headings in the body', () => {
    const record = makeRecord({ rawContent: '# Main Heading\n\nParagraph\n\n## Sub Heading\n' });
    const result = recordToMarkdown(record);

    expect(result).toContain('# Main Heading');
    expect(result).toContain('## Sub Heading');
  });

  it('should preserve code blocks with language annotations', () => {
    const record = makeRecord({
      rawContent: 'Text before\n\n```python\ndef hello():\n    pass\n```\n\nText after',
    });
    const result = recordToMarkdown(record);

    expect(result).toContain('```python');
    expect(result).toContain('def hello():');
    expect(result).toContain('    pass');
    expect(result).toContain('```');
  });

  it('should escape markdown chars in plain text but not in code blocks', () => {
    const record = makeRecord({
      rawContent: 'Use *asterisks* here\n\n```\n*not escaped*\n```\n',
    });
    const result = recordToMarkdown(record);

    expect(result).toContain('Use \\*asterisks\\* here');
    expect(result).toContain('*not escaped*');
  });

  it('should handle null record', () => {
    expect(recordToMarkdown(null)).toBe('');
  });

  it('should handle record with empty tags', () => {
    const record = makeRecord({ tags: [] });
    const result = recordToMarkdown(record);
    expect(result).toContain('tags: []');
  });

  it('should escape quotes in YAML values', () => {
    const record = makeRecord({ title: 'He said "hello"' });
    const result = recordToMarkdown(record);
    expect(result).toContain('title: "He said \\"hello\\""');
  });
});

describe('exportRecords', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should export all records when recordIds is null', async () => {
    const records = [makeRecord(), makeRecord({ id: 'def456', title: 'Second Page' })];
    getAllRecords.mockResolvedValue(records);

    const result = await exportRecords(null);

    expect(getAllRecords).toHaveBeenCalled();
    expect(result.filename).toBe('contextbridge-export.md');
    expect(result.blob).toBeInstanceOf(Blob);
  });

  it('should export all records when recordIds is empty array', async () => {
    const records = [makeRecord()];
    getAllRecords.mockResolvedValue(records);

    const result = await exportRecords([]);

    expect(getAllRecords).toHaveBeenCalled();
    // Single record — no ZIP
    expect(result.filename).toBe('Test-Page-Title.md');
    expect(result.blob).toBeInstanceOf(Blob);
  });

  it('should return single markdown file for one record', async () => {
    const record = makeRecord();
    getRecord.mockResolvedValue(record);

    const result = await exportRecords(['abc123']);

    expect(getRecord).toHaveBeenCalledWith('abc123');
    expect(result.filename).toBe('Test-Page-Title.md');
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.type).toBe('text/markdown;charset=utf-8');
  });

  it('should return ZIP for multiple records', async () => {
    const record1 = makeRecord();
    const record2 = makeRecord({ id: 'def456', title: 'Second Page' });
    getRecord.mockImplementation(async (id) => {
      if (id === 'abc123') return record1;
      if (id === 'def456') return record2;
      return undefined;
    });

    const result = await exportRecords(['abc123', 'def456']);

    expect(result.filename).toBe('contextbridge-export.md');
    expect(result.blob).toBeInstanceOf(Blob);
  });

  it('should throw when no records to export', async () => {
    getAllRecords.mockResolvedValue([]);

    await expect(exportRecords(null)).rejects.toThrow('No records to export');
  });

  it('should skip records that are not found', async () => {
    const record = makeRecord();
    getRecord.mockImplementation(async (id) => {
      if (id === 'abc123') return record;
      return undefined;
    });

    const result = await exportRecords(['abc123', 'nonexistent']);

    // Only one record found, so single file export
    expect(result.filename).toBe('Test-Page-Title.md');
  });
});
