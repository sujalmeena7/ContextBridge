# Privacy Policy — ContextBridge

**Last updated:** May 17, 2026

## Overview

ContextBridge is a Chrome extension that extracts, stores, and searches web page content locally on your device. Your privacy is fundamental to how this extension is designed.

## Data Collection

**ContextBridge does NOT collect, transmit, or share any user data with us or any third party.**

### What is stored locally on your device:

- **Page content** — Text extracted from pages you explicitly choose to index (stored in IndexedDB)
- **Page URLs and titles** — Metadata for pages you index (stored in chrome.storage.local)
- **Settings** — Your preferences like storage mode, endpoint URL, and AI provider choice
- **API keys** — Your AI provider API key (stored locally, never transmitted to us)

### What is NOT collected:

- No personal information
- No browsing history (only pages you explicitly index)
- No analytics or telemetry
- No cookies or tracking
- No data is sent to our servers (we have no servers)

## Third-Party Services

### AI Chat (Optional, User-Initiated)

If you configure an AI provider (Claude, OpenAI, or Gemini) and use the Chat feature:
- Your API key and the indexed page content are sent directly to your chosen AI provider
- This only happens when you actively send a chat message
- We do not intermediate, log, or store these communications
- Refer to your AI provider's privacy policy for how they handle data

### Custom RAG Endpoint (Optional, User-Configured)

If you configure a custom endpoint in settings:
- Extracted content is sent only to the URL you specify
- This is entirely under your control
- No data is sent anywhere unless you configure an endpoint

## Data Storage

All data is stored locally using:
- **IndexedDB** — For full page content records
- **chrome.storage.local** — For settings, history metadata, and queue

Data never leaves your device unless you explicitly use the AI chat feature or configure a custom endpoint.

## Data Deletion

- Use "Clear Local Storage" in settings to delete all stored content
- Delete individual pages from the History panel
- Uninstalling the extension removes all stored data

## Permissions

| Permission | Purpose |
|---|---|
| activeTab | Access the current tab's content when you click "Index" |
| scripting | Inject the content extraction script into the active tab |
| storage | Store settings, history, and queue locally |
| alarms | Schedule retry attempts for failed endpoint sends |
| sidePanel | Display the extension UI in Chrome's side panel |
| notifications | Alert you about indexing results and storage warnings |
| host_permissions (<all_urls>) | Extract content from any page you choose; make AI API calls |

## Changes

If this policy changes, the updated version will be posted here with a new date.

## Contact

For questions about this privacy policy, open an issue at: https://github.com/sujalmeena7/ContextPipe/issues
