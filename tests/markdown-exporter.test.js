/**
 * Property-based tests for the Markdown Exporter module.
 * Feature: local-storage-search
 *
 * Properties tested:
 *   8: Export selection filtering
 *   9: Filename sanitization
 *  10: Markdown export metadata round-trip
 *  11: Content structure preservation
 *  12: Markdown special character escaping
 *
 * Validates: Requirements 5.3, 5.5, 5.8, 6.1, 6.2, 6.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { sanitizeFilename, recordToMarkdown, exportRecords } from '../src/background/exporter.js';

// Mock db.js for exportRecords tests
vi.mock('../src/background/db.js', () => ({
  getAllRecords: vi.fn(),
  getRecord: vi.fn(),
}));

import { getAllRecords, getRecord } from '../src/background/db.js';

// --- Generators ---

/**
 * Generates a valid Content_Record for testing.
 */
function arbContentRecord() {
  return fc.record({
    id: fc.hexaString({ minLength: 16, maxLength: 16 }),
    url: fc.webUrl(),
    title: fc.string({ minLength: 1, maxLength: 80 }).filter(s => s.trim().length > 0),
    domain: fc.domain(),
    rawContent: fc.string({ minLength: 0, maxLength: 500 }),
    chunks: fc.constant([]),
    codeBlocks: fc.constant([]),
    tags: fc.array(fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 1, maxLength: 15 }), { minLength: 0, maxLength: 5 }),
    wordCount: fc.nat({ max: 100000 }),
    contentType: fc.constantFrom('api_docs', 'blog_post', 'github_issue', 'documentation', 'tutorial'),
    indexedAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map(d => d.toISOString()),
    updatedAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map(d => d.toISOString()),
  });
}

/**
 * Generates a Content_Record with headings and code blocks in rawContent.
 */
function arbRecordWithStructure() {
  const arbHeading = fc.tuple(
    fc.constantFrom('# ', '## ', '### ', '#### '),
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')), { minLength: 1, maxLength: 30 })
  ).map(([prefix, text]) => prefix + text.trim());

  const arbCodeBlock = fc.tuple(
    fc.constantFrom('javascript', 'python', 'rust', 'go', 'typescript', 'java'),
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 =(){};\n'.split('')), { minLength: 1, maxLength: 60 })
  ).map(([lang, code]) => '```' + lang + '\n' + code.replace(/`{3,}/g, '') + '\n```');

  const arbParagraph = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!? '.split('')),
    { minLength: 5, maxLength: 80 }
  );

  return fc.tuple(
    fc.array(arbHeading, { minLength: 1, maxLength: 4 }),
    fc.array(arbCodeBlock, { minLength: 1, maxLength: 3 }),
    fc.array(arbParagraph, { minLength: 1, maxLength: 3 }),
    arbContentRecord()
  ).map(([headings, codeBlocks, paragraphs, baseRecord]) => {
    // Interleave headings, paragraphs, and code blocks
    const sections = [];
    for (let i = 0; i < Math.max(headings.length, codeBlocks.length, paragraphs.length); i++) {
      if (i < headings.length) sections.push(headings[i]);
      if (i < paragraphs.length) sections.push(paragraphs[i]);
      if (i < codeBlocks.length) sections.push(codeBlocks[i]);
    }
    return {
      ...baseRecord,
      rawContent: sections.join('\n\n'),
    };
  });
}

/**
 * Generates a string containing markdown special characters for escaping tests.
 */
function arbTextWithSpecialChars() {
  return fc.stringOf(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''),
      '*', '_', '#', '[', ']', '`'
    ),
    { minLength: 1, maxLength: 100 }
  );
}

// --- Simple YAML frontmatter parser ---

/**
 * Parses YAML frontmatter from a markdown string.
 * Returns an object with the parsed key-value pairs.
 */
function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const yaml = match[1];
  const result = {};

  for (const line of yaml.split('\n')) {
    const kvMatch = line.match(/^(\w+):\s*(.*)$/);
    if (!kvMatch) continue;

    const [, key, rawValue] = kvMatch;

    if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
      // Quoted string — unescape
      result[key] = rawValue.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      // Array
      const inner = rawValue.slice(1, -1).trim();
      result[key] = inner.length === 0 ? [] : inner.split(',').map(s => s.trim());
    } else if (/^\d+$/.test(rawValue)) {
      result[key] = parseInt(rawValue, 10);
    } else {
      result[key] = rawValue;
    }
  }

  return result;
}

// --- Property Tests ---

describe('Feature: local-storage-search, Property 8: Export selection filtering', () => {
  /**
   * Validates: Requirements 5.3
   *
   * For any set of Content_Records in IndexedDB and any subset of their IDs
   * passed to exportRecords, the exported output SHALL contain exactly the
   * records whose IDs were specified — no more, no fewer.
   */
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exported output contains exactly the records whose IDs were specified', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbContentRecord(), { minLength: 2, maxLength: 8 }).chain(records => {
          // Ensure unique IDs
          const uniqueRecords = [];
          const seenIds = new Set();
          for (const r of records) {
            const id = r.id + uniqueRecords.length;
            if (!seenIds.has(id)) {
              seenIds.add(id);
              uniqueRecords.push({ ...r, id });
            }
          }
          // Pick a non-empty subset of IDs
          return fc.tuple(
            fc.constant(uniqueRecords),
            fc.subarray(uniqueRecords.map(r => r.id), { minLength: 1 })
          );
        }),
        async ([records, selectedIds]) => {
          // Setup mock: getRecord returns the matching record
          getRecord.mockImplementation(async (id) => {
            return records.find(r => r.id === id) || undefined;
          });

          const result = await exportRecords(selectedIds);
          const content = await result.blob.text();

          // Each selected record's title should appear in the output
          const selectedRecords = records.filter(r => selectedIds.includes(r.id));
          const nonSelectedRecords = records.filter(r => !selectedIds.includes(r.id));

          for (const rec of selectedRecords) {
            // The frontmatter should contain the record's URL (unique per record)
            expect(content).toContain(rec.url);
          }

          for (const rec of nonSelectedRecords) {
            // Non-selected records should NOT appear
            expect(content).not.toContain(rec.url);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: local-storage-search, Property 9: Filename sanitization', () => {
  /**
   * Validates: Requirements 5.8
   *
   * For any page title string, the sanitizeFilename function SHALL produce a string that:
   * (a) contains no characters invalid in Windows/Mac/Linux file systems
   * (b) has a length of at most 100 characters
   * (c) ends with .md
   */
  it('produces a filename with no invalid chars, at most 100 chars, ending with .md', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 300 }),
        (title) => {
          const filename = sanitizeFilename(title);

          // (a) No invalid filesystem characters and no control characters
          const invalidChars = /[<>:"/\\|?*\x00-\x1f]/;
          expect(filename).not.toMatch(invalidChars);

          // (b) At most 100 characters
          expect(filename.length).toBeLessThanOrEqual(100);

          // (c) Ends with .md
          expect(filename).toMatch(/\.md$/);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: local-storage-search, Property 10: Markdown export metadata round-trip', () => {
  /**
   * Validates: Requirements 6.1
   *
   * For any valid Content_Record, exporting it to markdown via recordToMarkdown
   * and then parsing the resulting YAML frontmatter SHALL produce metadata
   * (title, url, domain, tags, content_type, word_count, indexed_at) equivalent
   * to the original record's metadata.
   */
  it('frontmatter round-trips metadata correctly', () => {
    fc.assert(
      fc.property(
        arbContentRecord(),
        (record) => {
          const markdown = recordToMarkdown(record);
          const parsed = parseFrontmatter(markdown);

          expect(parsed).not.toBeNull();
          expect(parsed.title).toBe(record.title);
          expect(parsed.url).toBe(record.url);
          expect(parsed.domain).toBe(record.domain);
          expect(parsed.tags).toEqual(record.tags);
          expect(parsed.content_type).toBe(record.contentType);
          expect(parsed.word_count).toBe(record.wordCount);
          expect(parsed.indexed_at).toBe(record.indexedAt);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: local-storage-search, Property 11: Content structure preservation', () => {
  /**
   * Validates: Requirements 5.5, 6.2
   *
   * For any Content_Record whose rawContent contains headings and code blocks,
   * the exported markdown SHALL contain all headings in their original order,
   * all code blocks with their original language annotations in fenced syntax,
   * and no sections shall be omitted or reordered.
   */
  it('preserves headings in order and code blocks with language annotations', () => {
    fc.assert(
      fc.property(
        arbRecordWithStructure(),
        (record) => {
          const markdown = recordToMarkdown(record);

          // Extract headings from original rawContent
          const originalHeadings = record.rawContent
            .split('\n')
            .filter(line => /^#{1,6}\s/.test(line.trimStart()));

          // Extract headings from exported markdown (after frontmatter)
          const bodyStart = markdown.indexOf('---\n', 4);
          const body = markdown.slice(bodyStart + 4);
          const exportedHeadings = body
            .split('\n')
            .filter(line => /^#{1,6}\s/.test(line.trimStart()));

          // All original headings should be present in order
          expect(exportedHeadings.length).toBe(originalHeadings.length);
          for (let i = 0; i < originalHeadings.length; i++) {
            expect(exportedHeadings[i]).toBe(originalHeadings[i]);
          }

          // Extract code block language annotations from original
          const originalCodeFences = record.rawContent
            .split('\n')
            .filter(line => /^```\w+/.test(line.trimStart()));

          // Extract code block language annotations from export
          const exportedCodeFences = body
            .split('\n')
            .filter(line => /^```\w+/.test(line.trimStart()));

          // All code fences with language annotations should be preserved
          expect(exportedCodeFences.length).toBe(originalCodeFences.length);
          for (let i = 0; i < originalCodeFences.length; i++) {
            expect(exportedCodeFences[i]).toBe(originalCodeFences[i]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: local-storage-search, Property 12: Markdown special character escaping', () => {
  /**
   * Validates: Requirements 6.3
   *
   * For any plain text segment within a Content_Record's rawContent that contains
   * markdown special characters (*, _, #, [, ], `), the exported markdown SHALL
   * escape those characters so they are not misinterpreted as formatting.
   */
  it('escapes markdown special characters in plain text segments', () => {
    fc.assert(
      fc.property(
        fc.tuple(arbContentRecord(), arbTextWithSpecialChars()),
        ([baseRecord, specialText]) => {
          // Create a record with the special text as plain content (no headings/code blocks)
          const record = {
            ...baseRecord,
            rawContent: specialText,
          };

          const markdown = recordToMarkdown(record);

          // Get the body (after frontmatter)
          const bodyStart = markdown.indexOf('---\n', 4);
          const body = markdown.slice(bodyStart + 4);

          // In the body, every special character that was in the original plain text
          // should be escaped (preceded by backslash), UNLESS it's inside inline code.
          // Since our input has no code blocks or headings, the entire body is plain text.
          const specialChars = ['*', '_', '#', '[', ']', '`'];

          for (const char of specialChars) {
            if (specialText.includes(char)) {
              // Count occurrences of the unescaped char in the original
              const originalCount = (specialText.match(new RegExp(`\\${char}`, 'g')) || []).length;

              // Count occurrences of the escaped char in the body
              const escapedPattern = new RegExp(`\\\\\\${char}`, 'g');
              const escapedCount = (body.match(escapedPattern) || []).length;

              // Every occurrence should be escaped
              expect(escapedCount).toBe(originalCount);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
