/**
 * ChatUI — Manages DOM rendering for the chat tab.
 * Vanilla JS class that manipulates the DOM directly.
 */
export class ChatUI {
  /**
   * @param {HTMLElement} containerEl - The container element (e.g. #panelChat)
   */
  constructor(containerEl) {
    this.container = containerEl;
    this._buildDOM();
  }

  /**
   * Build the internal DOM structure for the chat interface.
   */
  _buildDOM() {
    // Context pill area (shows loaded page info)
    this.contextPillEl = document.createElement('div');
    this.contextPillEl.className = 'context-pill';
    this.contextPillEl.style.display = 'none';
    this.container.appendChild(this.contextPillEl);

    // Chat messages area
    this.chatArea = document.createElement('div');
    this.chatArea.className = 'chat-area';
    this.container.appendChild(this.chatArea);

    // Chat input area
    this.inputArea = document.createElement('div');
    this.inputArea.className = 'chat-input-area';

    this.inputEl = document.createElement('input');
    this.inputEl.type = 'text';
    this.inputEl.className = 'chat-input';
    this.inputEl.placeholder = 'Ask about this page…';
    this.inputEl.autocomplete = 'off';

    this.sendBtn = document.createElement('button');
    this.sendBtn.className = 'chat-send-btn';
    this.sendBtn.setAttribute('aria-label', 'Send message');
    this.sendBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <line x1="22" y1="2" x2="11" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <polygon points="22 2 15 22 11 13 2 9 22 2" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    </svg>`;

    this.inputArea.appendChild(this.inputEl);
    this.inputArea.appendChild(this.sendBtn);
    this.container.appendChild(this.inputArea);
  }

  /**
   * Render the context pill showing loaded page info.
   * @param {string} title - Page title
   * @param {string} domain - Page domain
   */
  renderContextPill(title, domain) {
    this.contextPillEl.style.display = '';
    this.contextPillEl.textContent = '';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'context-pill-title';
    titleSpan.textContent = title;

    const domainSpan = document.createElement('span');
    domainSpan.className = 'context-pill-domain';
    domainSpan.textContent = domain;

    this.contextPillEl.appendChild(titleSpan);
    this.contextPillEl.appendChild(domainSpan);
  }

  /**
   * Append a user message bubble to the chat area.
   * @param {string} text - The user's message text
   * @returns {HTMLElement} The created bubble element
   */
  appendUserMessage(text) {
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble user';

    const content = document.createElement('div');
    content.className = 'chat-bubble-content';
    content.textContent = text;

    const time = document.createElement('div');
    time.className = 'chat-bubble-time';
    time.textContent = this._formatTime(new Date());

    bubble.appendChild(content);
    bubble.appendChild(time);
    this.chatArea.appendChild(bubble);
    this._scrollToBottom();
    return bubble;
  }

  /**
   * Create an empty assistant bubble and return a handle for streaming.
   * @returns {{ element: HTMLElement, appendToken: (token: string) => void, finalize: () => void }}
   */
  createAssistantBubble() {
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble assistant';

    const content = document.createElement('div');
    content.className = 'chat-bubble-content';

    const time = document.createElement('div');
    time.className = 'chat-bubble-time';

    bubble.appendChild(content);
    bubble.appendChild(time);
    this.chatArea.appendChild(bubble);
    this._scrollToBottom();

    let tokens = '';

    return {
      element: bubble,
      appendToken: (token) => {
        tokens += token;
        content.innerHTML = this._renderMarkdown(tokens);
        this._scrollToBottom();
      },
      finalize: () => {
        content.innerHTML = this._renderMarkdown(tokens);
        time.textContent = this._formatTime(new Date());
      }
    };
  }

  /**
   * Show a typing indicator in the chat area.
   */
  showTypingIndicator() {
    this.hideTypingIndicator(); // Remove any existing one first
    const indicator = document.createElement('div');
    indicator.className = 'typing-indicator';
    indicator.innerHTML = '<span></span><span></span><span></span>';
    this.chatArea.appendChild(indicator);
    this._scrollToBottom();
  }

  /**
   * Hide the typing indicator.
   */
  hideTypingIndicator() {
    const existing = this.chatArea.querySelector('.typing-indicator');
    if (existing) {
      existing.remove();
    }
  }

  /**
   * Display an inline error message in the chat area.
   * @param {string} message - Error message text
   * @param {string} [type='error'] - Error type (for potential styling variants)
   */
  showError(message, type = 'error') {
    const errorEl = document.createElement('div');
    errorEl.className = 'chat-error';
    if (type) {
      errorEl.dataset.errorType = type;
    }
    errorEl.textContent = message;
    this.chatArea.appendChild(errorEl);
    this._scrollToBottom();
  }

  /**
   * Show "Index this page" prompt when no record exists.
   * @param {Function} onClickHandler - Handler called when the button is clicked
   */
  showIndexPrompt(onClickHandler) {
    const prompt = document.createElement('div');
    prompt.className = 'chat-index-prompt';

    const text = document.createElement('p');
    text.textContent = 'This page hasn\u2019t been indexed yet. Index it to start chatting.';

    const btn = document.createElement('button');
    btn.className = 'chat-index-btn';
    btn.textContent = 'Index this page';
    btn.addEventListener('click', onClickHandler);

    prompt.appendChild(text);
    prompt.appendChild(btn);
    this.chatArea.appendChild(prompt);
  }

  /**
   * Show inline message prompting user to add API key in settings.
   */
  showApiKeyPrompt() {
    const prompt = document.createElement('div');
    prompt.className = 'chat-apikey-prompt';
    prompt.textContent = 'Add your API key in Settings to start chatting.';
    this.chatArea.appendChild(prompt);
  }

  /**
   * Remove all message elements from the chat area.
   */
  clearMessages() {
    this.chatArea.innerHTML = '';
  }

  /**
   * Enable or disable the text input and send button.
   * @param {boolean} enabled - Whether input should be enabled
   */
  setInputEnabled(enabled) {
    this.inputEl.disabled = !enabled;
    this.sendBtn.disabled = !enabled;
  }

  /**
   * Get the current input value, clear it, and return the text.
   * @returns {string} The input text
   */
  consumeInput() {
    const value = this.inputEl.value.trim();
    this.inputEl.value = '';
    return value;
  }

  /**
   * Format a Date as a short time string (e.g. "2:30 PM").
   * @param {Date} date
   * @returns {string}
   */
  _formatTime(date) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  /**
   * Scroll the chat area to the bottom.
   */
  _scrollToBottom() {
    this.chatArea.scrollTop = this.chatArea.scrollHeight;
  }

  /**
   * Render basic markdown to HTML for assistant responses.
   * Handles: bold, italic, inline code, code blocks, bullet lists, headings, line breaks.
   * @param {string} text - Raw markdown text
   * @returns {string} HTML string
   */
  _renderMarkdown(text) {
    if (!text) return '';

    // Escape HTML entities first
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Code blocks (```lang\n...\n```)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code class="lang-${lang || 'text'}">${code.trim()}</code></pre>`;
    });

    // Inline code (`...`)
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold (**...**)
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic (*...*)
    html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

    // Headings (### ... at start of line)
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');

    // Bullet lists (- or * at start of line)
    html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

    // Numbered lists (1. 2. etc.)
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Markdown tables (| col | col |)
    html = html.replace(/((?:^\|.+\|$\n?)+)/gm, (tableBlock) => {
      const rows = tableBlock.trim().split('\n').filter(r => r.trim());
      if (rows.length < 2) return tableBlock;
      
      let table = '<table>';
      rows.forEach((row, i) => {
        // Skip separator row (|---|---|)
        if (/^\|[\s\-:]+\|$/.test(row.trim())) return;
        const cells = row.split('|').filter((c, idx, arr) => idx > 0 && idx < arr.length - 1);
        const tag = i === 0 ? 'th' : 'td';
        table += '<tr>' + cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('') + '</tr>';
      });
      table += '</table>';
      return table;
    });

    // Paragraphs — convert double newlines to paragraph breaks
    html = html.replace(/\n\n+/g, '</p><p>');

    // Single newlines to <br> (but not inside <pre> or <ul>)
    html = html.replace(/(?<!<\/li>|<\/pre>|<\/ul>|<\/table>|<\/tr>|<\/h[234]>|<\/p>)\n(?!<)/g, '<br>');

    // Wrap in paragraph
    html = '<p>' + html + '</p>';

    // Clean up empty paragraphs
    html = html.replace(/<p>\s*<\/p>/g, '');
    html = html.replace(/<p>\s*(<(?:pre|ul|h[234]|table))/g, '$1');
    html = html.replace(/(<\/(?:pre|ul|h[234]|table)>)\s*<\/p>/g, '$1');

    return html;
  }
}
