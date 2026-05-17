import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatModule } from '../src/sidepanel/chat-module.js';

/**
 * Unit tests for ChatModule.
 * Validates: Requirements 2.1, 2.2, 4.1, 4.2, 4.3, 4.4, 8.4
 */

// Mock chrome.runtime.sendMessage and chrome.storage.local
const mockChrome = {
  runtime: {
    sendMessage: vi.fn()
  },
  storage: {
    local: {
      get: vi.fn()
    }
  }
};

// Set up global chrome mock
globalThis.chrome = mockChrome;

function createMockChatUI() {
  return {
    appendUserMessage: vi.fn(),
    createAssistantBubble: vi.fn(() => ({
      element: document.createElement('div'),
      appendToken: vi.fn(),
      finalize: vi.fn()
    })),
    showError: vi.fn(),
    setInputEnabled: vi.fn(),
    showTypingIndicator: vi.fn(),
    hideTypingIndicator: vi.fn(),
    clearMessages: vi.fn(),
    renderContextPill: vi.fn(),
    showIndexPrompt: vi.fn(),
    showApiKeyPrompt: vi.fn(),
    consumeInput: vi.fn()
  };
}

function createMockProviderFactory() {
  return {
    getProvider: vi.fn(() => vi.fn(() => ({ abort: vi.fn() }))),
    getDefaultModel: vi.fn(() => 'claude-sonnet-4-20250514')
  };
}

function createSampleRecord() {
  return {
    id: 'test-id-123',
    title: 'Test Page Title',
    url: 'https://example.com/test-page',
    domain: 'example.com',
    contentType: 'blog_post',
    wordCount: 1500,
    indexedAt: '2024-01-15T10:30:00.000Z',
    rawContent: 'This is the raw content of the test page. It contains information about testing.'
  };
}

describe('ChatModule - Constructor', () => {
  it('should initialize with empty conversation history', () => {
    const chatUI = createMockChatUI();
    const providerFactory = createMockProviderFactory();
    const module = new ChatModule(chatUI, providerFactory);

    expect(module.conversationHistory).toEqual([]);
    expect(module.currentRecord).toBeNull();
    expect(module.activeAbortController).toBeNull();
  });

  it('should store chatUI and providerFactory dependencies', () => {
    const chatUI = createMockChatUI();
    const providerFactory = createMockProviderFactory();
    const module = new ChatModule(chatUI, providerFactory);

    expect(module.chatUI).toBe(chatUI);
    expect(module.providerFactory).toBe(providerFactory);
  });
});

describe('ChatModule - loadContext', () => {
  let module;

  beforeEach(() => {
    vi.clearAllMocks();
    module = new ChatModule(createMockChatUI(), createMockProviderFactory());
  });

  it('should send GET_RECORD_BY_URL message to background worker', async () => {
    mockChrome.runtime.sendMessage.mockResolvedValue({ success: true, record: createSampleRecord() });

    await module.loadContext('https://example.com/test-page');

    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'GET_RECORD_BY_URL',
      url: 'https://example.com/test-page'
    });
  });

  it('should store the record when found', async () => {
    const record = createSampleRecord();
    mockChrome.runtime.sendMessage.mockResolvedValue({ success: true, record });

    const result = await module.loadContext('https://example.com/test-page');

    expect(result).toEqual({ success: true, record });
    expect(module.currentRecord).toBe(record);
  });

  it('should return null record when not found', async () => {
    mockChrome.runtime.sendMessage.mockResolvedValue({ success: true, record: null });

    const result = await module.loadContext('https://example.com/not-indexed');

    expect(result).toEqual({ success: true, record: null });
    expect(module.currentRecord).toBeNull();
  });

  it('should handle errors gracefully', async () => {
    mockChrome.runtime.sendMessage.mockRejectedValue(new Error('Connection failed'));

    const result = await module.loadContext('https://example.com/error');

    expect(result).toEqual({ success: false });
    expect(module.currentRecord).toBeNull();
  });
});

describe('ChatModule - buildSystemPrompt', () => {
  let module;

  beforeEach(() => {
    module = new ChatModule(createMockChatUI(), createMockProviderFactory());
  });

  it('should include title, URL, contentType, wordCount, and indexedAt in the prompt', () => {
    const record = createSampleRecord();
    const prompt = module.buildSystemPrompt(record);

    expect(prompt).toContain('Test Page Title');
    expect(prompt).toContain('https://example.com/test-page');
    expect(prompt).toContain('blog_post');
    expect(prompt).toContain('1500');
    expect(prompt).toContain('2024-01-15T10:30:00.000Z');
  });

  it('should include rawContent in the prompt', () => {
    const record = createSampleRecord();
    const prompt = module.buildSystemPrompt(record);

    expect(prompt).toContain('This is the raw content of the test page.');
  });

  it('should slice rawContent to 80,000 characters max', () => {
    const record = createSampleRecord();
    record.rawContent = 'x'.repeat(100_000);

    const prompt = module.buildSystemPrompt(record);

    // The content portion should be exactly 80,000 chars
    const contentStart = prompt.indexOf('--- PAGE CONTENT ---\n') + '--- PAGE CONTENT ---\n'.length;
    const contentEnd = prompt.indexOf('\n--- END PAGE CONTENT ---');
    const contentLength = contentEnd - contentStart;

    expect(contentLength).toBe(80_000);
  });

  it('should handle empty rawContent', () => {
    const record = createSampleRecord();
    record.rawContent = '';

    const prompt = module.buildSystemPrompt(record);

    expect(prompt).toContain('--- PAGE CONTENT ---');
    expect(prompt).toContain('--- END PAGE CONTENT ---');
  });

  it('should handle missing fields gracefully', () => {
    const record = { url: 'https://example.com' };
    const prompt = module.buildSystemPrompt(record);

    expect(prompt).toContain('https://example.com');
    expect(prompt).toContain('Word Count: 0');
  });
});

describe('ChatModule - buildMessages', () => {
  let module;

  beforeEach(() => {
    module = new ChatModule(createMockChatUI(), createMockProviderFactory());
  });

  it('should return array with just the user message when history is empty', () => {
    const messages = module.buildMessages('Hello');

    expect(messages).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('should include conversation history plus the new message', () => {
    module.conversationHistory = [
      { role: 'user', content: 'First question', timestamp: '2024-01-01T00:00:00Z' },
      { role: 'assistant', content: 'First answer', timestamp: '2024-01-01T00:00:01Z' }
    ];

    const messages = module.buildMessages('Second question');

    expect(messages).toEqual([
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Second question' }
    ]);
  });

  it('should not include timestamps in the output messages', () => {
    module.conversationHistory = [
      { role: 'user', content: 'Test', timestamp: '2024-01-01T00:00:00Z' }
    ];

    const messages = module.buildMessages('New message');

    messages.forEach(msg => {
      expect(msg).not.toHaveProperty('timestamp');
    });
  });
});

describe('ChatModule - getProviderConfig', () => {
  let module;

  beforeEach(() => {
    vi.clearAllMocks();
    module = new ChatModule(createMockChatUI(), createMockProviderFactory());
  });

  it('should return stored provider config', async () => {
    mockChrome.storage.local.get.mockResolvedValue({
      chatProvider: 'openai',
      chatApiKey: 'sk-test-key',
      chatModel: 'gpt-4'
    });

    const config = await module.getProviderConfig();

    expect(config).toEqual({
      provider: 'openai',
      apiKey: 'sk-test-key',
      model: 'gpt-4'
    });
  });

  it('should default to claude when no provider is set', async () => {
    mockChrome.storage.local.get.mockResolvedValue({});

    const config = await module.getProviderConfig();

    expect(config.provider).toBe('claude');
  });

  it('should use default model when chatModel is not set', async () => {
    mockChrome.storage.local.get.mockResolvedValue({
      chatProvider: 'claude',
      chatApiKey: 'test-key'
    });

    const config = await module.getProviderConfig();

    // Should use the default model from getDefaultModel
    expect(config.model).toBe('claude-sonnet-4-20250514');
  });

  it('should return empty string for apiKey when not configured', async () => {
    mockChrome.storage.local.get.mockResolvedValue({});

    const config = await module.getProviderConfig();

    expect(config.apiKey).toBe('');
  });
});

describe('ChatModule - clearConversation', () => {
  it('should reset conversation history to empty array', () => {
    const module = new ChatModule(createMockChatUI(), createMockProviderFactory());
    module.conversationHistory = [
      { role: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
      { role: 'assistant', content: 'Hi there', timestamp: '2024-01-01T00:00:01Z' }
    ];

    module.clearConversation();

    expect(module.conversationHistory).toEqual([]);
  });
});

/**
 * Unit tests for ChatModule.sendMessage
 * Validates: Requirements 5.6, 6.1, 6.2, 6.3, 7.3, 7.4
 */
describe('ChatModule - sendMessage', () => {
  let module;
  let chatUI;
  let providerFactory;
  let mockStreamChat;
  let mockBubble;

  beforeEach(() => {
    vi.clearAllMocks();

    mockBubble = {
      element: {},
      appendToken: vi.fn(),
      finalize: vi.fn()
    };

    chatUI = createMockChatUI();
    chatUI.createAssistantBubble.mockReturnValue(mockBubble);

    mockStreamChat = vi.fn();
    providerFactory = {
      getProvider: vi.fn(() => mockStreamChat),
      getDefaultModel: vi.fn(() => 'claude-sonnet-4-20250514')
    };

    module = new ChatModule(chatUI, providerFactory);
    module.currentRecord = createSampleRecord();

    // Default: provider config returns valid key
    mockChrome.storage.local.get.mockResolvedValue({
      chatProvider: 'claude',
      chatApiKey: 'test-api-key',
      chatModel: 'claude-sonnet-4-20250514'
    });
  });

  it('should do nothing for empty or whitespace-only text', async () => {
    await module.sendMessage('');
    await module.sendMessage('   ');

    expect(chatUI.appendUserMessage).not.toHaveBeenCalled();
    expect(module.conversationHistory).toEqual([]);
  });

  it('should append user message to conversation history with timestamp', async () => {
    mockStreamChat.mockReturnValue({ abort: vi.fn() });

    await module.sendMessage('Hello AI');

    expect(module.conversationHistory[0]).toMatchObject({
      role: 'user',
      content: 'Hello AI'
    });
    expect(module.conversationHistory[0].timestamp).toBeDefined();
  });

  it('should trim the message text before processing', async () => {
    mockStreamChat.mockReturnValue({ abort: vi.fn() });

    await module.sendMessage('  Hello AI  ');

    expect(module.conversationHistory[0].content).toBe('Hello AI');
    expect(chatUI.appendUserMessage).toHaveBeenCalledWith('Hello AI');
  });

  it('should call chatUI.appendUserMessage and disable input', async () => {
    mockStreamChat.mockReturnValue({ abort: vi.fn() });

    await module.sendMessage('Hello');

    expect(chatUI.appendUserMessage).toHaveBeenCalledWith('Hello');
    expect(chatUI.setInputEnabled).toHaveBeenCalledWith(false);
  });

  it('should show error and re-enable input when no API key is configured', async () => {
    mockChrome.storage.local.get.mockResolvedValue({
      chatProvider: 'claude',
      chatApiKey: '',
      chatModel: ''
    });

    await module.sendMessage('Hello');

    expect(chatUI.showError).toHaveBeenCalledWith(expect.stringContaining('API key'));
    expect(chatUI.setInputEnabled).toHaveBeenCalledWith(true);
    expect(mockStreamChat).not.toHaveBeenCalled();
  });

  it('should show error and re-enable input when no page context is loaded', async () => {
    module.currentRecord = null;

    await module.sendMessage('Hello');

    expect(chatUI.showError).toHaveBeenCalledWith(expect.stringContaining('page context'));
    expect(chatUI.setInputEnabled).toHaveBeenCalledWith(true);
    expect(mockStreamChat).not.toHaveBeenCalled();
  });

  it('should call provider streamChat with correct config and callbacks', async () => {
    mockStreamChat.mockReturnValue({ abort: vi.fn() });

    await module.sendMessage('What is this page about?');

    expect(providerFactory.getProvider).toHaveBeenCalledWith('claude');
    expect(mockStreamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'test-api-key',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: expect.stringContaining('Test Page Title'),
        messages: expect.any(Array)
      }),
      expect.objectContaining({
        onToken: expect.any(Function),
        onComplete: expect.any(Function),
        onError: expect.any(Function)
      })
    );
  });

  it('should create an assistant bubble for streaming', async () => {
    mockStreamChat.mockReturnValue({ abort: vi.fn() });

    await module.sendMessage('Hello');

    expect(chatUI.createAssistantBubble).toHaveBeenCalled();
  });

  it('should call bubble.appendToken on each token received', async () => {
    let capturedCallbacks;
    mockStreamChat.mockImplementation((config, callbacks) => {
      capturedCallbacks = callbacks;
      return { abort: vi.fn() };
    });

    await module.sendMessage('Hello');

    capturedCallbacks.onToken('Hello');
    capturedCallbacks.onToken(' world');

    expect(mockBubble.appendToken).toHaveBeenCalledWith('Hello');
    expect(mockBubble.appendToken).toHaveBeenCalledWith(' world');
  });

  it('should finalize bubble, append assistant message to history, and re-enable input on complete', async () => {
    let capturedCallbacks;
    mockStreamChat.mockImplementation((config, callbacks) => {
      capturedCallbacks = callbacks;
      return { abort: vi.fn() };
    });

    await module.sendMessage('Hello');

    capturedCallbacks.onToken('Response');
    capturedCallbacks.onToken(' text');
    capturedCallbacks.onComplete();

    expect(mockBubble.finalize).toHaveBeenCalled();
    expect(chatUI.setInputEnabled).toHaveBeenCalledWith(true);

    // Should have user message + assistant message in history
    expect(module.conversationHistory).toHaveLength(2);
    expect(module.conversationHistory[1]).toMatchObject({
      role: 'assistant',
      content: 'Response text'
    });
    expect(module.conversationHistory[1].timestamp).toBeDefined();
  });

  it('should show error and re-enable input on error with no partial response', async () => {
    let capturedCallbacks;
    mockStreamChat.mockImplementation((config, callbacks) => {
      capturedCallbacks = callbacks;
      return { abort: vi.fn() };
    });

    await module.sendMessage('Hello');

    capturedCallbacks.onError(new Error('Rate limited'));

    expect(chatUI.showError).toHaveBeenCalledWith('Rate limited');
    expect(chatUI.setInputEnabled).toHaveBeenCalledWith(true);
    // No assistant message should be in history since no tokens were received
    expect(module.conversationHistory).toHaveLength(1);
    expect(module.conversationHistory[0].role).toBe('user');
  });

  it('should preserve partial response when error occurs after tokens received', async () => {
    let capturedCallbacks;
    mockStreamChat.mockImplementation((config, callbacks) => {
      capturedCallbacks = callbacks;
      return { abort: vi.fn() };
    });

    await module.sendMessage('Hello');

    // Simulate partial tokens then error
    capturedCallbacks.onToken('Partial');
    capturedCallbacks.onToken(' response');
    capturedCallbacks.onError(new Error('Connection lost'));

    // Should finalize the bubble with partial content
    expect(mockBubble.finalize).toHaveBeenCalled();
    // Should append partial assistant message to history
    expect(module.conversationHistory).toHaveLength(2);
    expect(module.conversationHistory[1]).toMatchObject({
      role: 'assistant',
      content: 'Partial response'
    });
    // Should still show the error
    expect(chatUI.showError).toHaveBeenCalledWith('Connection lost');
    expect(chatUI.setInputEnabled).toHaveBeenCalledWith(true);
  });

  it('should abort in-progress stream before starting a new one', async () => {
    const mockAbort = vi.fn();
    const firstAbortController = { abort: mockAbort };

    mockStreamChat.mockReturnValueOnce(firstAbortController);
    mockStreamChat.mockReturnValueOnce({ abort: vi.fn() });

    await module.sendMessage('First message');

    // activeAbortController should be set
    expect(module.activeAbortController).toBe(firstAbortController);

    // Send another message while first is "in progress"
    await module.sendMessage('Second message');

    // First stream should have been aborted
    expect(mockAbort).toHaveBeenCalled();
  });

  it('should clear activeAbortController on complete', async () => {
    let capturedCallbacks;
    mockStreamChat.mockImplementation((config, callbacks) => {
      capturedCallbacks = callbacks;
      return { abort: vi.fn() };
    });

    await module.sendMessage('Hello');

    expect(module.activeAbortController).not.toBeNull();

    capturedCallbacks.onToken('Done');
    capturedCallbacks.onComplete();

    expect(module.activeAbortController).toBeNull();
  });

  it('should clear activeAbortController on error', async () => {
    let capturedCallbacks;
    mockStreamChat.mockImplementation((config, callbacks) => {
      capturedCallbacks = callbacks;
      return { abort: vi.fn() };
    });

    await module.sendMessage('Hello');

    expect(module.activeAbortController).not.toBeNull();

    capturedCallbacks.onError(new Error('Failed'));

    expect(module.activeAbortController).toBeNull();
  });

  it('should handle exception thrown by getProviderConfig gracefully', async () => {
    mockChrome.storage.local.get.mockRejectedValue(new Error('Storage error'));

    await module.sendMessage('Hello');

    expect(chatUI.showError).toHaveBeenCalledWith('Storage error');
    expect(chatUI.setInputEnabled).toHaveBeenCalledWith(true);
  });

  it('should handle exception thrown by provider getProvider gracefully', async () => {
    providerFactory.getProvider.mockImplementation(() => {
      throw new Error('Unknown provider');
    });

    await module.sendMessage('Hello');

    expect(chatUI.showError).toHaveBeenCalledWith('Unknown provider');
    expect(chatUI.setInputEnabled).toHaveBeenCalledWith(true);
  });

  it('should pass conversation history (without timestamps) to the provider', async () => {
    mockStreamChat.mockReturnValue({ abort: vi.fn() });

    // Pre-populate history
    module.conversationHistory = [
      { role: 'user', content: 'Previous question', timestamp: '2024-01-01T00:00:00Z' },
      { role: 'assistant', content: 'Previous answer', timestamp: '2024-01-01T00:00:01Z' }
    ];

    await module.sendMessage('Follow-up');

    const callArgs = mockStreamChat.mock.calls[0][0];
    // Messages should include previous history + new user message
    expect(callArgs.messages).toEqual([
      { role: 'user', content: 'Previous question' },
      { role: 'assistant', content: 'Previous answer' },
      { role: 'user', content: 'Follow-up' }
    ]);
  });

  it('should use default error message when error has no message property', async () => {
    let capturedCallbacks;
    mockStreamChat.mockImplementation((config, callbacks) => {
      capturedCallbacks = callbacks;
      return { abort: vi.fn() };
    });

    await module.sendMessage('Hello');

    capturedCallbacks.onError({});

    expect(chatUI.showError).toHaveBeenCalledWith('An error occurred while generating the response.');
  });
});
