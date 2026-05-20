/**
 * Ollama provider adapter for streaming chat.
 * Conforms to the provider interface: streamChat(config, callbacks) → AbortController
 */

/**
 * Sends a streaming chat request to the local Ollama API.
 *
 * @param {Object} config
 * @param {string} config.ollamaHost - Local Ollama URL (e.g. 'http://localhost:11434')
 * @param {string} config.model - Model identifier (e.g. 'llama3')
 * @param {string} config.systemPrompt - System prompt with page context
 * @param {Array<{role: string, content: string}>} config.messages - Conversation messages
 * @param {Object} callbacks
 * @param {(token: string) => void} callbacks.onToken - Called for each text delta
 * @param {() => void} callbacks.onComplete - Called when stream finishes
 * @param {(error: Error) => void} callbacks.onError - Called on error
 * @returns {AbortController} Controller to cancel the stream
 */
export function streamChat(config, callbacks) {
  const { ollamaHost, model, messages, systemPrompt } = config;
  const { onToken, onComplete, onError } = callbacks;

  const controller = new AbortController();
  
  // Clean up host URL to ensure no trailing slash
  const hostUrl = (ollamaHost || 'http://localhost:11434').replace(/\/$/, '');
  const url = `${hostUrl}/api/chat`;

  const ollamaMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map(msg => ({ role: msg.role, content: msg.content }))
  ];

  const body = {
    model: model || 'llama3',
    messages: ollamaMessages,
    stream: true
  };

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal
  })
    .then(response => {
      if (!response.ok) {
        onError(new Error(`Ollama request failed with status ${response.status}. Ensure Ollama is running.`));
        return;
      }
      return readNDJSONStream(response.body, onToken, onComplete, onError);
    })
    .catch(err => {
      if (err.name === 'AbortError') return;
      onError(new Error('Cannot connect to Ollama. Make sure it is running locally and the host URL is correct.'));
    });

  return controller;
}

/**
 * Reads an NDJSON stream from the Ollama API and dispatches callbacks.
 */
async function readNDJSONStream(body, onToken, onComplete, onError) {
  const reader = body.getReader();
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
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const parsed = JSON.parse(line);
          if (parsed.message && parsed.message.content) {
            onToken(parsed.message.content);
          }
          if (parsed.done) {
            onComplete();
            return; // Stream is finished
          }
        } catch {
          // Malformed JSON — skip this line
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    onError(new Error('Connection to Ollama lost.'));
  }
}
