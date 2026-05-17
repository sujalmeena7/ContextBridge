import { describe, it, expect } from 'vitest';
import { getProvider, getDefaultModel, DEFAULT_MODELS } from '../src/sidepanel/providers/index.js';
import { streamChat as claudeStreamChat } from '../src/sidepanel/providers/claude.js';
import { streamChat as openaiStreamChat } from '../src/sidepanel/providers/openai.js';
import { streamChat as geminiStreamChat } from '../src/sidepanel/providers/gemini.js';

/**
 * Unit tests for the provider factory.
 * Validates: Requirements 3.1, 3.4, 8.1
 */

describe('Provider Factory - getProvider', () => {
  it('should return the Claude streamChat function for "claude"', () => {
    expect(getProvider('claude')).toBe(claudeStreamChat);
  });

  it('should return the OpenAI streamChat function for "openai"', () => {
    expect(getProvider('openai')).toBe(openaiStreamChat);
  });

  it('should return the Gemini streamChat function for "gemini"', () => {
    expect(getProvider('gemini')).toBe(geminiStreamChat);
  });

  it('should throw an error for an unknown provider', () => {
    expect(() => getProvider('unknown')).toThrow('Unknown provider: "unknown"');
  });

  it('should throw an error for undefined', () => {
    expect(() => getProvider(undefined)).toThrow();
  });
});

describe('Provider Factory - DEFAULT_MODELS', () => {
  it('should have claude-sonnet-4-20250514 as the default Claude model', () => {
    expect(DEFAULT_MODELS.claude).toBe('claude-sonnet-4-20250514');
  });

  it('should have gpt-4o-mini as the default OpenAI model', () => {
    expect(DEFAULT_MODELS.openai).toBe('gpt-4o-mini');
  });

  it('should have gemini-2.5-flash as the default Gemini model', () => {
    expect(DEFAULT_MODELS.gemini).toBe('gemini-2.5-flash');
  });
});

describe('Provider Factory - getDefaultModel', () => {
  it('should return claude-sonnet-4-20250514 for "claude"', () => {
    expect(getDefaultModel('claude')).toBe('claude-sonnet-4-20250514');
  });

  it('should return gpt-4o-mini for "openai"', () => {
    expect(getDefaultModel('openai')).toBe('gpt-4o-mini');
  });

  it('should return gemini-2.5-flash for "gemini"', () => {
    expect(getDefaultModel('gemini')).toBe('gemini-2.5-flash');
  });

  it('should throw an error for an unknown provider', () => {
    expect(() => getDefaultModel('unknown')).toThrow('Unknown provider: "unknown"');
  });
});
