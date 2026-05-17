/**
 * Claude (Anthropic) provider adapter for streaming chat.
 * Conforms to the provider interface: streamChat(config, callbacks) → AbortController
 */

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Sends a streaming chat request to the Claude API.
 *
 * @param {Object} config
 * @param {string} config.apiKey - Anthropic API key
 * @param {string} config.model - Model identifier (e.g. 'claude-sonnet-4-20250514')
 * @param {string} config.systemPrompt - System prompt with page context
 * @param {Array<{role: string, content: string}>} config.messages - Conversation messages
 * @param {Object} callbacks
 * @param {(token: string) => void} callbacks.onToken - Called for each text delta
 * @param {() => void} callbacks.onComplete - Called when stream finishes
 * @param {(error: Error) => void} callbacks.onError - Called on error
 * @returns {AbortController} Controller to cancel the stream
 */
export function streamChat(config, callbacks) {
  const { apiKey, model, messages, systemPrompt } = config;
  const { onToken, onComplete, onError } = callbacks;

  const controller = new AbortController();

  const body = {
    model,
    max_tokens: 4096,
    stream: true,
    system: systemPrompt,
    messages: messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }))
  };

  fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION
    },
    body: JSON.stringify(body),
    signal: controller.signal
  })
    .then(response => {
      if (!response.ok) {
        const error = buildHttpError(response.status);
        onError(error);
        return;
      }
      return readSSEStream(response.body, onToken, onComplete, onError);
    })
    .catch(err => {
      if (err.name === 'AbortError') {
        return;
      }
      onError(new Error('Network error — check your connection and try again.'));
    });

  return controller;
}

/**
 * Builds a user-friendly error from an HTTP status code.
 */
function buildHttpError(status) {
  if (status === 401 || status === 403) {
    return new Error('API key is invalid or expired. Update it in Settings →');
  }
  if (status === 429) {
    return new Error('Rate limited — please wait a moment before sending another message.');
  }
  if (status >= 500) {
    return new Error('The AI service is temporarily unavailable. Try again in a moment.');
  }
  return new Error(`Request failed with status ${status}.`);
}

/**
 * Reads an SSE stream from the Claude API and dispatches callbacks.
 * Parses `event: content_block_delta` for text deltas and `event: message_stop` for completion.
 */
async function readSSEStream(body, onToken, onComplete, onError) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        onComplete();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          const data = line.slice(5).trim();
          if (!data) continue;

          try {
            const parsed = JSON.parse(data);
            handleSSEEvent(currentEvent, parsed, onToken, onComplete);
          } catch {
            // Malformed JSON — skip this event, continue processing
          }
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      return;
    }
    onError(new Error('Connection lost — partial response shown.'));
  }
}

/**
 * Handles a parsed SSE event from the Claude stream.
 */
function handleSSEEvent(eventType, data, onToken, onComplete) {
  if (eventType === 'content_block_delta') {
    if (data.delta && data.delta.type === 'text_delta' && data.delta.text) {
      onToken(data.delta.text);
    }
  } else if (eventType === 'message_stop') {
    onComplete();
  }
}
