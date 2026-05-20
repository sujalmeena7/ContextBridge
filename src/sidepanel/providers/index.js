/**
 * Provider factory — returns the streamChat function for a given provider name
 * and exposes default model mappings.
 */

import { streamChat as claudeStreamChat } from './claude.js';
import { streamChat as openaiStreamChat } from './openai.js';
import { streamChat as geminiStreamChat } from './gemini.js';
import { streamChat as ollamaStreamChat } from './ollama.js';

/**
 * Default models for each supported provider.
 */
export const DEFAULT_MODELS = {
  claude: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.5-flash',
  ollama: 'llama3'
};

const PROVIDERS = {
  claude: claudeStreamChat,
  openai: openaiStreamChat,
  gemini: geminiStreamChat,
  ollama: ollamaStreamChat
};

/**
 * Returns the streamChat function for the given provider name.
 * @param {string} providerName - One of 'claude', 'openai', or 'gemini'
 * @returns {Function} The streamChat(config, callbacks) function for the provider
 * @throws {Error} If the provider name is not recognized
 */
export function getProvider(providerName) {
  const provider = PROVIDERS[providerName];
  if (!provider) {
    throw new Error(`Unknown provider: "${providerName}". Supported: claude, openai, gemini, ollama`);
  }
  return provider;
}

/**
 * Returns the default model identifier for the given provider.
 * @param {string} providerName - One of 'claude', 'openai', or 'gemini'
 * @returns {string} The default model identifier
 * @throws {Error} If the provider name is not recognized
 */
export function getDefaultModel(providerName) {
  const model = DEFAULT_MODELS[providerName];
  if (!model) {
    throw new Error(`Unknown provider: "${providerName}". Supported: claude, openai, gemini, ollama`);
  }
  return model;
}
