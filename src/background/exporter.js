/**
 * Markdown Exporter for ContextBridge
 *
 * Converts Content_Records to well-formatted markdown files with YAML frontmatter.
 * For multiple files, concatenates them into a single markdown with separators.
 * (ZIP packaging removed — JSZip is not compatible with Chrome extension ES modules without a bundler)
 */

import { getAllRecords, getRecord } from './db.js';

/**
 * Characters invalid in Windows/Mac/Linux file systems.
 */
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

/**
 * Sanitizes a page title into a valid filename.
 * - Removes invalid filesystem characters (<>:"/\|?* and control chars)
 * - Replaces spaces with hyphens
 * - Truncates to 96 characters
 * - Appends .md extension
 *
 * @param {string} title - The page title to sanitize
 * @returns {string} A filesystem-safe filename ending in .md
 */
export function sanitizeFilename(title) {
  if (!title || typeof title !== 'string') {
    return 'untitled.md';
  }

  let sanitized = title
    .replace(INVALID_FILENAME_CHARS, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!sanitized) {
    return 'untitled.md';
  }

  if (sanitized.length > 96) {
    sanitized = sanitized.slice(0, 96);
  }

  // Remove trailing hyphens after truncation
  sanitized = sanitized.replace(/-+$/, '');

  return sanitized + '.md';
}

/**
 * Escapes markdown special characters in plain text segments.
 * Characters escaped: * _ # [ ] `
 * Does NOT escape content inside code blocks (fenced or inline).
 *
 * @param {string} text - The text to escape
 * @returns {string} Text with markdown special characters escaped
 */
export function escapeMarkdown(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  const lines = text.split('\n');
  const result = [];
  let inCodeBlock = false;

  for (const line of lines) {
    // Check for fenced code block delimiters
    if (/^```/.test(line.trimStart())) {
      inCodeBlock = !inCodeBlock;
      result.push(line);
      continue;
    }

    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    // Escape special characters in plain text (outside inline code)
    result.push(escapeLineOutsideInlineCode(line));
  }

  return result.join('\n');
}

/**
 * Escapes markdown special characters in a single line,
 * preserving inline code spans (backtick-delimited).
 *
 * @param {string} line - A single line of text
 * @returns {string} The line with special chars escaped outside inline code
 */
function escapeLineOutsideInlineCode(line) {
  // Split by inline code spans (single backtick)
  const parts = line.split(/(`[^`]*`)/);
  return parts.map((part, index) => {
    // Odd-indexed parts are inline code spans — leave them alone
    if (index % 2 === 1) {
      return part;
    }
    // Escape special markdown characters in plain text
    return part.replace(/([*_#\[\]`])/g, '\\$1');
  }).join('');
}

/**
 * Converts a Content_Record to a markdown string with YAML frontmatter.
 *
 * Frontmatter includes: title, url, domain, tags, content_type, word_count, indexed_at
 * Body preserves headings and code blocks in fenced syntax with language annotations.
 *
 * @param {object} record - A Content_Record object
 * @returns {string} The formatted markdown string
 */
export function recordToMarkdown(record) {
  if (!record) {
    return '';
  }

  const frontmatter = buildFrontmatter(record);
  const body = buildBody(record);

  return frontmatter + '\n' + body;
}

/**
 * Builds YAML frontmatter from a Content_Record.
 */
function buildFrontmatter(record) {
  const tags = Array.isArray(record.tags) ? record.tags : [];
  const tagsStr = tags.length > 0
    ? `[${tags.join(', ')}]`
    : '[]';

  const lines = [
    '---',
    `title: "${escapeYamlString(record.title || '')}"`,
    `url: "${escapeYamlString(record.url || '')}"`,
    `domain: "${escapeYamlString(record.domain || '')}"`,
    `tags: ${tagsStr}`,
    `content_type: "${escapeYamlString(record.contentType || '')}"`,
    `word_count: ${record.wordCount || 0}`,
    `indexed_at: "${escapeYamlString(record.indexedAt || '')}"`,
    '---',
  ];

  return lines.join('\n');
}

/**
 * Escapes characters that would break YAML double-quoted strings.
 */
function escapeYamlString(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Builds the markdown body from a Content_Record.
 * Preserves headings and code blocks with language annotations.
 */
function buildBody(record) {
  const rawContent = record.rawContent || '';

  if (!rawContent) {
    return '';
  }

  // Process the raw content to preserve structure
  const lines = rawContent.split('\n');
  const result = [];
  let inCodeBlock = false;

  for (const line of lines) {
    // Detect fenced code block boundaries
    const trimmed = line.trimStart();
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      result.push(line);
      continue;
    }

    if (inCodeBlock) {
      // Inside code blocks, preserve content as-is
      result.push(line);
      continue;
    }

    // Preserve headings as-is
    if (/^#{1,6}\s/.test(trimmed)) {
      result.push(line);
      continue;
    }

    // Escape markdown special characters in plain text
    result.push(escapeLineOutsideInlineCode(line));
  }

  return result.join('\n');
}

/**
 * Exports Content_Records as markdown files.
 *
 * - If recordIds is null/empty, exports all records from IndexedDB.
 * - If one record, returns { blob: markdownBlob, filename }.
 * - If multiple records, creates a ZIP with JSZip containing all .md files,
 *   returns { blob: zipBlob, filename: 'contextbridge-export.zip' }.
 *
 * @param {string[]|null} recordIds - Array of record IDs to export, or null/empty for all
 * @returns {Promise<{blob: Blob, filename: string}>} The export result
 */
export async function exportRecords(recordIds) {
  let records;

  if (!recordIds || recordIds.length === 0) {
    records = await getAllRecords();
  } else {
    records = [];
    for (const id of recordIds) {
      const record = await getRecord(id);
      if (record) {
        records.push(record);
      }
    }
  }

  if (records.length === 0) {
    throw new Error('No records to export');
  }

  if (records.length === 1) {
    const markdown = recordToMarkdown(records[0]);
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const filename = sanitizeFilename(records[0].title);
    return { blob, filename };
  }

  // Multiple records — concatenate into a single markdown file with separators
  const parts = records.map(record => {
    return recordToMarkdown(record);
  });

  const combined = parts.join('\n\n---\n\n');
  const blob = new Blob([combined], { type: 'text/markdown;charset=utf-8' });
  return { blob, filename: 'contextbridge-export.md' };
}
