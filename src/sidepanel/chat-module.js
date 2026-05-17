/**
 * ChatModule — Core chat logic for the Chat with Page feature.
 * Orchestrates conversation state, context loading, and provider calls.
 */

import { getProvider, getDefaultModel } from './providers/index.js';

/** Maximum characters of page content to include in the system prompt */
const MAX_CONTENT_LENGTH = 80_000;

/**
 * System prompt template with placeholders for page context.
 */
const SYSTEM_PROMPT_TEMPLATE = `You are a helpful assistant that answers questions about a specific web page. 
You MUST answer based ONLY on the provided page content below unless the user explicitly asks for general knowledge.

Page Title: {{title}}
Page URL: {{url}}
Content Type: {{contentType}}
Word Count: {{wordCount}}
Indexed At: {{indexedAt}}

--- PAGE CONTENT ---
{{content}}
--- END PAGE CONTENT ---

Rules:
- Answer strictly from the page content above
- If the answer is not in the page content, say so clearly
- Quote relevant sections when appropriate
- If the user asks for general knowledge explicitly, you may use your training data

Formatting rules (IMPORTANT):
- Always use proper markdown formatting in your responses
- Use ## headings to separate major sections
- Use bullet points (- ) for lists of items
- Use **bold** for labels and key terms
- Use line breaks between distinct pieces of information — never run them together on one line
- When presenting structured data (fees, specs, configs), use a clear breakdown with one item per line
- For tabular data, use markdown tables with | separators
- Keep paragraphs short and scannable — max 2-3 sentences each
- Use numbered lists (1. 2. 3.) for sequential steps`;

export class ChatModule {
  /**
   * @param {object} chatUI - ChatUI instance with rendering methods
   * @param {object} providerFactory - Provider factory with getProvider/getDefaultModel
   */
  constructor(chatUI, providerFactory) {
    this.chatUI = chatUI;
    this.providerFactory = providerFactory;
    this.conversationHistory = [];
    this.currentRecord = null;
    this.activeAbortController = null;
  }

  /**
   * Load context for the given URL from IndexedDB via the background worker.
   * @param {string} url - The URL to look up
   * @returns {Promise<{success: boolean, record?: object}>}
   */
  async loadContext(url) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_RECORD_BY_URL',
        url
      });

      if (response?.success && response.record) {
        this.currentRecord = response.record;
        return { success: true, record: response.record };
      }

      this.currentRecord = null;
      return { success: true, record: null };
    } catch (error) {
      this.currentRecord = null;
      return { success: false };
    }
  }

  /**
   * Build the system prompt from a Content_Record.
   * Injects title, URL, contentType, wordCount, indexedAt, and rawContent
   * (sliced to 80,000 chars max) into the template.
   * @param {object} record - A Content_Record from IndexedDB
   * @returns {string} The constructed system prompt
   */
  buildSystemPrompt(record) {
    const content = (record.rawContent || '').slice(0, MAX_CONTENT_LENGTH);

    return SYSTEM_PROMPT_TEMPLATE
      .replace('{{title}}', record.title || '')
      .replace('{{url}}', record.url || '')
      .replace('{{contentType}}', record.contentType || '')
      .replace('{{wordCount}}', String(record.wordCount || 0))
      .replace('{{indexedAt}}', record.indexedAt || '')
      .replace('{{content}}', content);
  }

  /**
   * Build the messages array for the AI provider.
   * Returns conversation history with the new user message appended.
   * @param {string} userMessage - The new user message to include
   * @returns {Array<{role: string, content: string}>}
   */
  buildMessages(userMessage) {
    const messages = this.conversationHistory.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    messages.push({ role: 'user', content: userMessage });

    return messages;
  }

  /**
   * Get current provider configuration from chrome.storage.local.
   * Reads chatProvider, chatApiKey, and chatModel.
   * @returns {Promise<{provider: string, apiKey: string, model: string}>}
   */
  async getProviderConfig() {
    const result = await chrome.storage.local.get(['chatProvider', 'chatApiKey', 'chatModel']);

    const provider = result.chatProvider || 'claude';
    const apiKey = result.chatApiKey || '';
    const model = result.chatModel || getDefaultModel(provider);

    return { provider, apiKey, model };
  }

  /**
   * Clear conversation history and reset state.
   */
  clearConversation() {
    this.conversationHistory = [];
  }

  /**
   * Send a user message and stream the response from the AI provider.
   * @param {string} text - The user's message text
   */
  async sendMessage(text) {
    if (!text || !text.trim()) return;

    const trimmedText = text.trim();

    // Append user message to conversation history
    this.conversationHistory.push({
      role: 'user',
      content: trimmedText,
      timestamp: new Date().toISOString()
    });

    // Update UI
    this.chatUI.appendUserMessage(trimmedText);
    this.chatUI.setInputEnabled(false);

    // Abort any in-progress stream
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }

    try {
      // Get provider config
      const { provider, apiKey, model } = await this.getProviderConfig();

      if (!apiKey) {
        this.chatUI.showError('No API key configured. Add your API key in Settings.');
        this.chatUI.setInputEnabled(true);
        return;
      }

      if (!this.currentRecord) {
        this.chatUI.showError('No page context loaded. Index the current page first.');
        this.chatUI.setInputEnabled(true);
        return;
      }

      // Build system prompt and messages
      const systemPrompt = this.buildSystemPrompt(this.currentRecord);
      const messages = this.buildMessages(trimmedText);

      // Remove the last user message from buildMessages since we already added it to history
      // buildMessages includes it, so we pass the history without the latest + the new message
      // Actually buildMessages already handles this correctly by reading from history + appending

      // Get the stream function
      const streamChat = this.providerFactory.getProvider(provider);

      // Create assistant bubble for streaming
      const bubble = this.chatUI.createAssistantBubble();
      let fullResponse = '';

      // Start streaming
      this.activeAbortController = streamChat(
        {
          apiKey,
          model,
          systemPrompt,
          messages: this.conversationHistory.map(msg => ({
            role: msg.role,
            content: msg.content
          }))
        },
        {
          onToken: (token) => {
            fullResponse += token;
            bubble.appendToken(token);
          },
          onComplete: () => {
            bubble.finalize();
            this.conversationHistory.push({
              role: 'assistant',
              content: fullResponse,
              timestamp: new Date().toISOString()
            });
            this.chatUI.setInputEnabled(true);
            this.activeAbortController = null;
          },
          onError: (error) => {
            if (fullResponse) {
              // Preserve partial response
              bubble.finalize();
              this.conversationHistory.push({
                role: 'assistant',
                content: fullResponse,
                timestamp: new Date().toISOString()
              });
            }
            this.chatUI.showError(error.message || 'An error occurred while generating the response.');
            this.chatUI.setInputEnabled(true);
            this.activeAbortController = null;
          }
        }
      );
    } catch (error) {
      this.chatUI.showError(error.message || 'Failed to send message.');
      this.chatUI.setInputEnabled(true);
      this.activeAbortController = null;
    }
  }
}
