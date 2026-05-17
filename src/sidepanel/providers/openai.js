/**
 * OpenAI Chat Completions API provider adapter.
 * Streams responses via SSE from the OpenAI API.
 */

/**
 * Sends a streaming chat request to the OpenAI API.
 *
 * @param {Object} config
 * @param {string} config.apiKey - OpenAI API key
 * @param {string} config.model - Model identifier (e.g. 'gpt-4o-mini')
 * @param {string} config.systemPrompt - System prompt with page context
 * @param {Array<{role: string, content: string}>} config.messages - Conversation messages
 * @param {Object} callbacks
 * @param {(token: string) => void} callbacks.onToken - Called for each content delta
 * @param {() => void} callbacks.onComplete - Called when stream finishes
 * @param {(error: Error) => void} callbacks.onError - Called on error
 * @returns {AbortController} Controller to cancel the stream
 */
export function streamChat(config, callbacks) {
  const { apiKey, model, messages, systemPrompt } = config;
  const { onToken, onComplete, onError } = callbacks;

  const controller = new AbortController();

  const fullMessages = [
    { role: 'system', content: systemPrompt },
    ...messages
  ];

  const body = JSON.stringify({
    model,
    messages: fullMessages,
    stream: true
  });

  fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body,
    signal: controller.signal
  })
    .then(async (response) => {
      if (!response.ok) {
        const errorMessage = getErrorMessage(response.status);
        onError(new Error(errorMessage));
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            onComplete();
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // Keep the last potentially incomplete line in the buffer
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) {
              // Empty line or SSE comment, skip
              continue;
            }

            if (trimmed.startsWith('data: ')) {
              const data = trimmed.slice(6);

              if (data === '[DONE]') {
                onComplete();
                return;
              }

              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  onToken(content);
                }
              } catch (e) {
                // Malformed JSON line — log and continue processing
                console.warn('OpenAI SSE parse error:', e.message);
              }
            }
          }
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          // Stream was intentionally cancelled
          return;
        }
        onError(new Error('Connection lost — partial response shown'));
      }
    })
    .catch((err) => {
      if (err.name === 'AbortError') {
        // Stream was intentionally cancelled
        return;
      }
      onError(new Error('Connection lost — partial response shown'));
    });

  return controller;
}

/**
 * Maps HTTP status codes to user-friendly error messages.
 * @param {number} status - HTTP status code
 * @returns {string} User-friendly error message
 */
function getErrorMessage(status) {
  switch (status) {
    case 401:
    case 403:
      return 'API key is invalid or expired. Update it in Settings →';
    case 429:
      return 'Rate limited — please wait a moment before sending another message';
    case 500:
    case 502:
    case 503:
      return 'The AI service is temporarily unavailable. Try again in a moment.';
    default:
      return `Request failed with status ${status}. Please try again.`;
  }
}
