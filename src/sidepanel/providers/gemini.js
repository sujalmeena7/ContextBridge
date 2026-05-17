/**
 * Gemini (Google) provider adapter for streaming chat.
 * Conforms to the shared provider interface: streamChat(config, callbacks) → AbortController
 */

/**
 * Sends a streaming chat request to the Gemini API.
 *
 * @param {Object} config
 * @param {string} config.apiKey - Gemini API key
 * @param {string} config.model - Model identifier (e.g. 'gemini-2.5-flash')
 * @param {string} config.systemPrompt - System prompt with page context
 * @param {Array<{role: string, content: string}>} config.messages - Conversation messages
 * @param {Object} callbacks
 * @param {(token: string) => void} callbacks.onToken - Called for each token
 * @param {() => void} callbacks.onComplete - Called when stream finishes
 * @param {(error: Error) => void} callbacks.onError - Called on error
 * @returns {AbortController} Controller to cancel the stream
 */
export function streamChat(config, callbacks) {
  const { apiKey, model, messages, systemPrompt } = config;
  const { onToken, onComplete, onError } = callbacks;

  const controller = new AbortController();

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;

  // Convert messages from generic format to Gemini's format
  // Gemini uses: contents: [{ role: 'user'|'model', parts: [{ text }] }]
  const contents = messages.map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));

  const body = {
    contents,
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
  };

  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const status = response.status;
        let message;

        if (status === 401 || status === 403) {
          message =
            'API key is invalid or expired. Update it in Settings →';
        } else if (status === 429) {
          message =
            'Rate limited — please wait a moment before sending another message';
        } else if (status >= 500) {
          message =
            'The AI service is temporarily unavailable. Try again in a moment.';
        } else {
          message = `Gemini API error (${status}). Please try again.`;
        }

        onError(new Error(message));
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            // Process any remaining buffer
            if (buffer.trim()) {
              processSSEBuffer(buffer, onToken);
            }
            onComplete();
            return;
          }

          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE lines
          const lines = buffer.split('\n');
          // Keep the last potentially incomplete line in the buffer
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (!data) continue;

              try {
                const parsed = JSON.parse(data);
                const text =
                  parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) {
                  onToken(text);
                }
              } catch (e) {
                // Malformed SSE data — log and continue processing
                console.warn('Gemini SSE parse error:', e);
              }
            }
          }
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          // Stream was intentionally cancelled — not an error
          return;
        }
        onError(
          new Error('⚠ Connection lost — partial response shown')
        );
      }
    })
    .catch((err) => {
      if (err.name === 'AbortError') {
        // Stream was intentionally cancelled
        return;
      }
      onError(new Error('⚠ Connection lost — partial response shown'));
    });

  return controller;
}

/**
 * Process remaining SSE buffer content for any data lines.
 * @param {string} buffer
 * @param {(token: string) => void} onToken
 */
function processSSEBuffer(buffer, onToken) {
  const lines = buffer.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6).trim();
      if (!data) continue;
      try {
        const parsed = JSON.parse(data);
        const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          onToken(text);
        }
      } catch (e) {
        console.warn('Gemini SSE parse error:', e);
      }
    }
  }
}
