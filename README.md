# ContextBridge — Local RAG Companion 🌉

> A hyper-focused Chrome Extension that extracts clean, structured technical content from your active browser tab and stores it locally in IndexedDB — with full-text search, AI chat, markdown export, and optional RAG endpoint integration.

---

## What It Does

ContextBridge sits silently in your Chrome sidebar. When you're reading a GitHub issue, a Stack Overflow thread, an arXiv paper, or any technical documentation page — press **Ctrl+Shift+E** (or click the button) and the full, clean, markdown-formatted content is immediately stored locally in your browser.

**No cloud required. No backend setup. Works offline out of the box.**

Optionally, you can also send content to a custom RAG endpoint (vector store) for advanced retrieval workflows.

---

## Feature Set

| Feature | Description |
|---|---|
| **Local-First Storage** | All content stored in IndexedDB — zero setup, works immediately |
| **AI Chat with Page** | Ask questions about any indexed page using Claude, OpenAI, or Gemini (BYOK) |
| **Full-Text Search** | Keyword search across all indexed pages with highlighted snippets |
| **Markdown Export** | Export pages as .md files (single or ZIP bundle) for Obsidian/notes |
| **Storage Mode** | Choose: local-only, endpoint-only, or both simultaneously |
| **Site-Adaptive Extraction** | Custom parsers for GitHub, Stack Overflow, arXiv, HN, MDN, and generic docs |
| **Markdown Conversion** | Full DOM → Markdown with headings, code blocks, tables, links preserved |
| **Code Block Preservation** | Language detection + indentation preserved; sent as structured `code_blocks[]` |
| **Smart Chunking** | Splits large documents into configurable RAG-optimal chunks with overlap |
| **Auto-tagging** | Detects technologies (Python, Rust, K8s, LLM, SQL, etc.) from content |
| **Content Type Detection** | API Docs, Tutorial, GitHub Issue/PR/README, SO, arXiv, Blog, HN Thread |
| **Readability Scoring** | Filters low-signal pages before sending |
| **Offline Queue** | Failed sends queue locally and auto-flush when endpoint comes back online |
| **Deduplication** | Tracks URL hash history; configurable: warn, skip, or always allow |
| **Health Check** | Polls endpoint every minute; live status indicator in UI |
| **Session History** | Indexed pages with domain, word count, content type, delete, re-send actions |
| **Stats Dashboard** | Total indexed, today's count, total words, domain breakdown, tag cloud, storage usage |
| **Keyboard Shortcut** | Global `Ctrl+Shift+E` / `Cmd+Shift+E` — works without opening the panel |
| **Premium UI** | Off-cream / charcoal / terracotta palette, smooth animations, zero bloat |

---

## AI Chat (Bring Your Own Key)

The Chat tab lets you have multi-turn conversations about any indexed page. The AI answers strictly from the page content.

**Supported providers:**
- Claude (default: claude-sonnet-4-20250514)
- OpenAI (default: gpt-4o-mini)
- Gemini (default: gemini-2.5-flash)

**Setup:** Open Settings → select your AI Provider → paste your API key → Save.

> ⚠️ Your API key is stored in `chrome.storage.local` (on-device only, not synced). The extension makes direct API calls to the provider — no intermediary server.

---

## Architecture

```
ContextBridge/
├── manifest.json                  # MV3 manifest
├── mock_backend.py                # FastAPI dev server for local testing
├── assets/
│   └── icons/                     # 16/32/48/128px icons
└── src/
    ├── shared/
    │   └── constants.js           # Shared config + content type enums
    ├── background/
    │   ├── worker.js              # Service worker: pipeline, queue, health, dedup, routing
    │   ├── db.js                  # IndexedDB manager (CRUD, storage estimates)
    │   ├── search.js              # Full-text search scanner
    │   └── exporter.js            # Markdown export + ZIP packaging
    ├── content/
    │   └── extractor.js           # DOM parser (injected on demand)
    └── sidepanel/
        ├── sidepanel.html         # Side panel markup
        ├── sidepanel.css          # Premium CSS design system
        ├── sidepanel.js           # UI controller
        ├── chat.js                # Chat UI component
        ├── chat-module.js         # Chat logic (context, streaming, history)
        └── providers/
            ├── index.js           # Provider factory
            ├── claude.js          # Claude SSE streaming adapter
            ├── openai.js          # OpenAI SSE streaming adapter
            └── gemini.js          # Gemini SSE streaming adapter
```

---

## POST Payload Schema

```json
{
  "title": "Authentication — FastAPI Docs",
  "url": "https://fastapi.tiangolo.com/tutorial/security/",
  "timestamp": "2025-05-16T10:30:00.000Z",
  "raw_content": "# Authentication\n\n...",
  "chunks": [
    { "index": 0, "text": "...", "start": 0, "end": 1200 },
    { "index": 1, "text": "...", "start": 1050, "end": 2250 }
  ],
  "code_blocks": [
    { "language": "python", "code": "from fastapi import ...", "lines": 12 }
  ],
  "meta": {
    "domain": "fastapi.tiangolo.com",
    "content_length": 8432,
    "word_count": 1840,
    "content_type": "api_docs",
    "tags": ["python", "api", "fastapi"],
    "readability": 88,
    "extraction_mode": "generic_docs",
    "language": "en"
  }
}
```

---

## Quick Start

### 1. Load the extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer Mode** (top right)
3. Click **Load unpacked** → select the `ContextPipe/` folder

### 2. Start the mock backend

```bash
pip install fastapi uvicorn
uvicorn mock_backend:app --reload --port 8000
```

### 3. Index a page

- Open any documentation or GitHub page
- Press `Ctrl+Shift+E` or click the extension icon → sidebar button
- Watch the terminal print the indexed payload

---

## Settings

All settings are in the sidebar's gear menu:

| Setting | Default | Description |
|---|---|---|
| Storage Mode | `local-only` | local-only / endpoint-only / both |
| AI Provider | Claude | Claude / OpenAI / Gemini |
| Chat API Key | — | Your provider API key (stored locally) |
| Endpoint URL | `http://localhost:8000/v1/context` | POST target (for endpoint mode) |
| API Key | — | Optional Bearer token for endpoint |
| Timeout | 8000ms | Per-request timeout |
| Dedup Mode | `warn` | warn / skip / allow |
| Chunk Size | 1200 words | RAG chunk target |
| Chunk Overlap | 150 words | Context overlap between chunks |
| Notifications | On | Toast alerts |

---

## Connecting to Real Vector Stores

Replace the mock backend with any ingestion pipeline:

```python
# Qdrant example
from qdrant_client import QdrantClient
from openai import OpenAI

client = QdrantClient(":memory:")
openai = OpenAI()

@app.post("/v1/context")
async def ingest(payload: ContextPayload):
    for chunk in payload.chunks:
        embedding = openai.embeddings.create(
            input=chunk.text, model="text-embedding-3-small"
        ).data[0].embedding
        client.upsert("docs", [PointStruct(
            id=uuid4().hex,
            vector=embedding,
            payload={"text": chunk.text, "url": payload.url, "title": payload.title}
        )])
    return {"success": True, "chunks": len(payload.chunks)}
```

---

## Privacy

- **Local-first by default** — all indexed content stored in IndexedDB (on-device only)
- **No analytics, no telemetry**
- Settings and history stored in `chrome.storage.local` (on-device only)
- AI chat makes direct API calls to your chosen provider (Claude/OpenAI/Gemini) — no intermediary
- API keys stored locally, never synced or transmitted elsewhere
- Optional endpoint mode sends data only to your configured URL
- Extension requires: `activeTab`, `scripting`, `storage`, `alarms`, `sidePanel`, `notifications`

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+E` / `Cmd+Shift+E` | Index current page |
| `Ctrl+Shift+B` / `Cmd+Shift+B` | Open/close sidebar |

---

*Built with Manifest V3, zero dependencies, zero build step.*
