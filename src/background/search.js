/**
 * Search Scanner for ContextBridge
 * Performs full-text search across stored Content_Records.
 * Uses tokenized matching with case-insensitive comparison.
 */

import { getAllRecords } from './db.js';

/**
 * Tokenizes text by splitting on whitespace and punctuation,
 * normalizing to lowercase, and filtering empty tokens.
 * @param {string} text - Input text to tokenize
 * @returns {string[]} Array of lowercase tokens
 */
export function tokenize(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }
  return text
    .split(/[\s\p{P}]+/u)
    .map(token => token.toLowerCase())
    .filter(token => token.length > 0);
}

/**
 * Checks if a record matches all query tokens.
 * Tokenizes the record's title + rawContent + tags, then checks
 * if every query token appears in the record's token set.
 * Returns match status and ~150 char snippets around the first match
 * with <mark> tags highlighting the matched term.
 *
 * @param {object} record - A Content_Record object
 * @param {string[]} queryTokens - Pre-tokenized query tokens
 * @returns {{ matches: boolean, snippets: string[] }}
 */
export function matchesQuery(record, queryTokens) {
  if (!queryTokens || queryTokens.length === 0) {
    return { matches: false, snippets: [] };
  }

  const title = record.title || '';
  const rawContent = record.rawContent || '';
  const tags = Array.isArray(record.tags) ? record.tags.join(' ') : '';
  const fullText = `${title} ${rawContent} ${tags}`;

  const recordTokens = tokenize(fullText);
  const recordTokenSet = new Set(recordTokens);

  const allMatch = queryTokens.every(qt => recordTokenSet.has(qt));

  if (!allMatch) {
    return { matches: false, snippets: [] };
  }

  // Generate snippets: ~150 char excerpts around the first occurrence of each query token
  const snippets = [];
  const fullTextLower = fullText.toLowerCase();

  for (const qt of queryTokens) {
    const idx = fullTextLower.indexOf(qt);
    if (idx === -1) continue;

    // Extract ~150 chars centered around the match
    const snippetRadius = 75;
    const start = Math.max(0, idx - snippetRadius);
    const end = Math.min(fullText.length, idx + qt.length + snippetRadius);

    let snippet = fullText.slice(start, end).trim();

    // Add ellipsis if we're not at the boundaries
    if (start > 0) snippet = '...' + snippet;
    if (end < fullText.length) snippet = snippet + '...';

    // Highlight the matched token with <mark> tags (case-insensitive replacement)
    const regex = new RegExp(`(${escapeRegExp(qt)})`, 'gi');
    snippet = snippet.replace(regex, '<mark>$1</mark>');

    snippets.push(snippet);
  }

  return { matches: true, snippets };
}

/**
 * Searches all stored records for the given query.
 * Tokenizes the query, filters records using matchesQuery,
 * and returns results sorted by matchCount descending.
 *
 * @param {string} query - The search query string
 * @returns {Promise<Array<{ id, title, url, domain, wordCount, snippet, matchCount }>>}
 */
export async function searchRecords(query) {
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return [];
  }

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return [];
  }

  const records = await getAllRecords();
  const results = [];

  for (const record of records) {
    const { matches, snippets } = matchesQuery(record, queryTokens);
    if (matches) {
      // Count how many times query tokens appear in the record's text
      const fullText = `${record.title || ''} ${record.rawContent || ''} ${Array.isArray(record.tags) ? record.tags.join(' ') : ''}`;
      const recordTokens = tokenize(fullText);
      let matchCount = 0;
      for (const token of recordTokens) {
        if (queryTokens.includes(token)) {
          matchCount++;
        }
      }

      results.push({
        id: record.id,
        title: record.title || '',
        url: record.url || '',
        domain: record.domain || '',
        wordCount: record.wordCount || 0,
        snippet: snippets.length > 0 ? snippets[0] : '',
        matchCount,
      });
    }
  }

  // Sort by matchCount descending
  results.sort((a, b) => b.matchCount - a.matchCount);

  return results;
}

/**
 * Escapes special regex characters in a string.
 * @param {string} str
 * @returns {string}
 */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
