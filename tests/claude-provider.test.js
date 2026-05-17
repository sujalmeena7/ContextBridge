import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamChat } from '../src/sidepanel/providers/claude.js';

/**
 * Unit tests for the Claude provider adapter.
 * Validates: Requirements 8.1, 8.2, 6.4, 7.3, 7.5, 8.3
 */

// Helper to create a readable stream from SSE text
function createSSEStream(sseText) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseText));
      controller.close();
    }
  });
}

// Helper to create a mock fetch response
function mockFetchResponse(status, sseText) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    body: sseText ? createSSEStream(sseText) : null
  });
}

describe('Claude Provider - streamChat', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const baseConfig = {
    apiKey: 'test-api-key',
    model: 'claude-sonnet-4-20250514',
    systemPrompt: 'You are a helpful assistant.',
    messages: [{ role: 'user', content: 'Hello' }]
  };

  it('should return an AbortController', () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {}));
    const callbacks = { onToken: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };
    const controller = streamChat(baseConfig, callbacks);
    expect(controller).toBeInstanceOf(AbortController);
  });

  it('should send correct headers and body to Claude API', async () => {
    globalThis.fetch = vi.fn(() => mockFetchResponse(200, 'event: message_stop\ndata: {}\n\n'));
    const callbacks = { onToken: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };

    streamChat(baseConfig, callbacks);
    await new Promise(r => setTimeout(r, 50));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-api-key',
          'anthropic-version': '2023-06-01'
        }
      })
    );

    const callArgs = globalThis.fetch.mock.calls[0][1];
    const body = JSON.parse(callArgs.body);
    expect(body.stream).toBe(true);
    expect(body.model).toBe('claude-sonnet-4-20250514');
    expect(body.system).toBe('You are a helpful assistant.');
    expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('should call onToken for content_block_delta events', async () => {
    const sse = [
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}',
      '',
      'event: message_stop',
      'data: {}',
      ''
    ].join('\n');

    globalThis.fetch = vi.fn(() => mockFetchResponse(200, sse));
    const callbacks = { onToken: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };

    streamChat(baseConfig, callbacks);
    await new Promise(r => setTimeout(r, 50));

    expect(callbacks.onToken).toHaveBeenCalledWith('Hello');
    expect(callbacks.onToken).toHaveBeenCalledWith(' world');
  });

  it('should call onComplete on message_stop event', async () => {
    const sse = [
      'event: message_stop',
      'data: {}',
      ''
    ].join('\n');

    globalThis.fetch = vi.fn(() => mockFetchResponse(200, sse));
    const callbacks = { onToken: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };

    streamChat(baseConfig, callbacks);
    await new Promise(r => setTimeout(r, 50));

    expect(callbacks.onComplete).toHaveBeenCalled();
  });

  it('should call onError with user-friendly message on 401', async () => {
    globalThis.fetch = vi.fn(() => mockFetchResponse(401, null));
    const callbacks = { onToken: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };

    streamChat(baseConfig, callbacks);
    await new Promise(r => setTimeout(r, 50));

    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'API key is invalid or expired. Update it in Settings →' })
    );
  });

  it('should call onError with user-friendly message on 403', async () => {
    globalThis.fetch = vi.fn(() => mockFetchResponse(403, null));
    const callbacks = { onToken: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };

    streamChat(baseConfig, callbacks);
    await new Promise(r => setTimeout(r, 50));

    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'API key is invalid or expired. Update it in Settings →' })
    );
  });

  it('should call onError with rate limit message on 429', async () => {
    globalThis.fetch = vi.fn(() => mockFetchResponse(429, null));
    const callbacks = { onToken: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };

    streamChat(baseConfig, callbacks);
    await new Promise(r => setTimeout(r, 50));

    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Rate limited — please wait a moment before sending another message.' })
    );
  });

  it('should call onError with server error message on 500', async () => {
    globalThis.fetch = vi.fn(() => mockFetchResponse(500, null));
    const callbacks = { onToken: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };

    streamChat(baseConfig, callbacks);
    await new Promise(r => setTimeout(r, 50));

    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'The AI service is temporarily unavailable. Try again in a moment.' })
    );
  });

  it('should call onError with network error on fetch failure', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('Failed to fetch')));
    const callbacks = { onToken: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };

    streamChat(baseConfig, callbacks);
    await new Promise(r => setTimeout(r, 50));

    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Network error — check your connection and try again.' })
    );
  });

  it('should not call onError when aborted', async () => {
    globalThis.fetch = vi.fn(() => {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });
    const callbacks = { onToken: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };

    streamChat(baseConfig, callbacks);
    await new Promise(r => setTimeout(r, 50));

    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('should pass abort signal to fetch', () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {}));
    const callbacks = { onToken: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };

    const controller = streamChat(baseConfig, callbacks);

    const callArgs = globalThis.fetch.mock.calls[0][1];
    expect(callArgs.signal).toBe(controller.signal);
  });
});
