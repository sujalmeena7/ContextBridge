/**
 * ContextBridge — Shared Constants
 */

export const DEFAULT_SETTINGS = {
  endpoint:    'http://localhost:8000/v1/context',
  apiKey:      '',
  timeoutMs:   8000,
  dedupMode:   'warn',       // 'warn' | 'skip' | 'allow'
  chunkSize:   1200,         // words per chunk for RAG
  chunkOverlap: 150,
  autoIndex:   false,
  notifications: true,
  theme:       'light',
  storageMode: 'local-only', // 'local-only' | 'endpoint-only' | 'both'
};

export const CONTENT_TYPES = {
  API_DOCS:   'api_docs',
  TUTORIAL:   'tutorial',
  GITHUB_ISSUE: 'github_issue',
  GITHUB_PR:  'github_pr',
  GITHUB_README: 'github_readme',
  STACK_OVERFLOW: 'stack_overflow',
  ARXIV_PAPER: 'arxiv_paper',
  BLOG_POST:  'blog_post',
  HN_THREAD:  'hn_thread',
  GENERIC:    'generic',
};

export const VERSION = '1.0.0';
