/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ChatUI } from '../src/sidepanel/chat.js';

describe('ChatUI', () => {
  let container;
  let chatUI;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'panelChat';
    document.body.appendChild(container);
    chatUI = new ChatUI(container);
  });

  describe('constructor', () => {
    it('creates chat-area element inside container', () => {
      const chatArea = container.querySelector('.chat-area');
      expect(chatArea).not.toBeNull();
    });

    it('creates chat-input-area with input and send button', () => {
      const inputArea = container.querySelector('.chat-input-area');
      expect(inputArea).not.toBeNull();
      expect(inputArea.querySelector('.chat-input')).not.toBeNull();
      expect(inputArea.querySelector('.chat-send-btn')).not.toBeNull();
    });

    it('creates context-pill element (hidden by default)', () => {
      const pill = container.querySelector('.context-pill');
      expect(pill).not.toBeNull();
      expect(pill.style.display).toBe('none');
    });
  });

  describe('renderContextPill', () => {
    it('displays page title and domain', () => {
      chatUI.renderContextPill('My Page Title', 'example.com');
      const pill = container.querySelector('.context-pill');
      expect(pill.style.display).toBe('');
      expect(pill.querySelector('.context-pill-title').textContent).toBe('My Page Title');
      expect(pill.querySelector('.context-pill-domain').textContent).toBe('example.com');
    });

    it('replaces previous pill content on re-render', () => {
      chatUI.renderContextPill('First', 'first.com');
      chatUI.renderContextPill('Second', 'second.com');
      const pill = container.querySelector('.context-pill');
      expect(pill.querySelector('.context-pill-title').textContent).toBe('Second');
      expect(pill.querySelector('.context-pill-domain').textContent).toBe('second.com');
    });
  });

  describe('appendUserMessage', () => {
    it('creates a right-aligned user bubble with text', () => {
      chatUI.appendUserMessage('Hello world');
      const bubble = container.querySelector('.chat-bubble.user');
      expect(bubble).not.toBeNull();
      expect(bubble.querySelector('.chat-bubble-content').textContent).toBe('Hello world');
    });

    it('includes a timestamp', () => {
      chatUI.appendUserMessage('Test');
      const time = container.querySelector('.chat-bubble.user .chat-bubble-time');
      expect(time).not.toBeNull();
      expect(time.textContent).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/i);
    });
  });

  describe('createAssistantBubble', () => {
    it('returns a handle with element, appendToken, and finalize', () => {
      const handle = chatUI.createAssistantBubble();
      expect(handle.element).toBeInstanceOf(HTMLElement);
      expect(typeof handle.appendToken).toBe('function');
      expect(typeof handle.finalize).toBe('function');
    });

    it('appendToken accumulates text in the bubble', () => {
      const handle = chatUI.createAssistantBubble();
      handle.appendToken('Hello');
      handle.appendToken(' world');
      const content = handle.element.querySelector('.chat-bubble-content');
      expect(content.textContent).toBe('Hello world');
    });

    it('finalize adds a timestamp', () => {
      const handle = chatUI.createAssistantBubble();
      handle.appendToken('Done');
      handle.finalize();
      const time = handle.element.querySelector('.chat-bubble-time');
      expect(time.textContent).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/i);
    });

    it('creates an assistant-classed bubble', () => {
      const handle = chatUI.createAssistantBubble();
      expect(handle.element.classList.contains('assistant')).toBe(true);
      expect(handle.element.classList.contains('chat-bubble')).toBe(true);
    });
  });

  describe('showTypingIndicator / hideTypingIndicator', () => {
    it('shows animated dots indicator', () => {
      chatUI.showTypingIndicator();
      const indicator = container.querySelector('.typing-indicator');
      expect(indicator).not.toBeNull();
      expect(indicator.querySelectorAll('span').length).toBe(3);
    });

    it('hideTypingIndicator removes the indicator', () => {
      chatUI.showTypingIndicator();
      chatUI.hideTypingIndicator();
      expect(container.querySelector('.typing-indicator')).toBeNull();
    });

    it('showTypingIndicator removes existing indicator before adding new one', () => {
      chatUI.showTypingIndicator();
      chatUI.showTypingIndicator();
      const indicators = container.querySelectorAll('.typing-indicator');
      expect(indicators.length).toBe(1);
    });
  });

  describe('showError', () => {
    it('creates an inline error bubble with .chat-error class', () => {
      chatUI.showError('Something went wrong');
      const errorEl = container.querySelector('.chat-error');
      expect(errorEl).not.toBeNull();
      expect(errorEl.textContent).toBe('Something went wrong');
    });

    it('sets data-error-type attribute', () => {
      chatUI.showError('Rate limited', 'rate-limit');
      const errorEl = container.querySelector('.chat-error');
      expect(errorEl.dataset.errorType).toBe('rate-limit');
    });
  });

  describe('showIndexPrompt', () => {
    it('shows "Index this page" button', () => {
      chatUI.showIndexPrompt(() => {});
      const prompt = container.querySelector('.chat-index-prompt');
      expect(prompt).not.toBeNull();
      expect(prompt.querySelector('.chat-index-btn').textContent).toBe('Index this page');
    });

    it('calls onClickHandler when button is clicked', () => {
      let clicked = false;
      chatUI.showIndexPrompt(() => { clicked = true; });
      container.querySelector('.chat-index-btn').click();
      expect(clicked).toBe(true);
    });
  });

  describe('showApiKeyPrompt', () => {
    it('shows inline message prompting user to add API key', () => {
      chatUI.showApiKeyPrompt();
      const prompt = container.querySelector('.chat-apikey-prompt');
      expect(prompt).not.toBeNull();
      expect(prompt.textContent).toContain('API key');
      expect(prompt.textContent).toContain('Settings');
    });
  });

  describe('clearMessages', () => {
    it('removes all message elements from chat area', () => {
      chatUI.appendUserMessage('msg1');
      chatUI.appendUserMessage('msg2');
      chatUI.showError('err');
      chatUI.clearMessages();
      expect(container.querySelector('.chat-area').children.length).toBe(0);
    });
  });

  describe('setInputEnabled', () => {
    it('disables input and send button when false', () => {
      chatUI.setInputEnabled(false);
      expect(chatUI.inputEl.disabled).toBe(true);
      expect(chatUI.sendBtn.disabled).toBe(true);
    });

    it('enables input and send button when true', () => {
      chatUI.setInputEnabled(false);
      chatUI.setInputEnabled(true);
      expect(chatUI.inputEl.disabled).toBe(false);
      expect(chatUI.sendBtn.disabled).toBe(false);
    });
  });

  describe('consumeInput', () => {
    it('returns trimmed input value and clears the field', () => {
      chatUI.inputEl.value = '  Hello world  ';
      const result = chatUI.consumeInput();
      expect(result).toBe('Hello world');
      expect(chatUI.inputEl.value).toBe('');
    });

    it('returns empty string when input is empty', () => {
      chatUI.inputEl.value = '';
      expect(chatUI.consumeInput()).toBe('');
    });
  });
});
