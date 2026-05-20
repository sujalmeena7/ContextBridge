<div align="center">
  <h1>🌉 ContextBridge</h1>
  <p><strong>Your Ultimate Local RAG & AI Reading Companion</strong></p>
  
  <p>
    <img src="https://img.shields.io/badge/Manifest-V3-blue?style=flat-square" alt="Manifest V3" />
    <img src="https://img.shields.io/badge/Storage-IndexedDB-success?style=flat-square" alt="IndexedDB" />
    <img src="https://img.shields.io/badge/AI-Ollama%20%7C%20Claude%20%7C%20OpenAI-blueviolet?style=flat-square" alt="AI Providers" />
    <img src="https://img.shields.io/badge/Zero-Dependencies-orange?style=flat-square" alt="Zero Deps" />
  </p>
</div>

<br/>

ContextBridge is a hyper-focused Chrome Extension that sits silently in your browser sidebar. It instantly extracts clean, structured technical content from your active browser tab, parses the DOM into Markdown, and stores it locally in IndexedDB. 

Whether you're reading a GitHub issue, a Stack Overflow thread, an arXiv paper, or technical documentation, **ContextBridge** empowers you with full-text search, local AI chat, and optional RAG endpoint integration.

**No cloud required. No backend setup. Works offline out of the box.**

---

## ✨ Key Features

- 🔋 **Local-First Storage:** All content stored in IndexedDB — zero setup, works immediately.
- 🤖 **AI Chat with Page:** Ask questions about any indexed page using **Local Ollama**, Claude, OpenAI, or Gemini.
- 🔍 **Full-Text Search:** Keyword search across all indexed pages with highlighted snippets.
- 📝 **True DOM-to-Markdown Extraction:** Complete HTML-to-Markdown parser preserving headings, lists, blockquotes, and tables.
- 💻 **Code Block Extraction:** Properly identifies `<pre><code>` blocks, preserving language tags and formatting.
- ✂️ **Semantic Chunking:** Automatically splits large documents into configurable RAG-optimal chunks based on paragraph boundaries.
- 📤 **Markdown Export:** Export pages as `.md` files (single or ZIP bundle) for Obsidian, Notion, or your personal knowledge base.
- 🌐 **Storage Modes:** Choose between local-only, endpoint-only (for remote RAG), or both simultaneously.
- 🎨 **Premium UI/UX:** Sleek, dynamic dark-mode interface with glassmorphism and micro-animations.

---

## 🚀 Quick Start

### 1. Install the Extension
1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer Mode** (toggle in the top right corner).
3. Click **Load unpacked** and select the `ContextPipe/` (or repository) folder.
4. Pin the extension to your toolbar.

### 2. Index Your First Page
- Navigate to any technical documentation, GitHub repo, or Stack Overflow thread.
- Press **`Ctrl+Shift+E`** (or `Cmd+Shift+E` on Mac) to instantly index the page.
- Open the ContextBridge sidebar (`Ctrl+Shift+B`) to view, search, or chat with the extracted Markdown.

---

## 🧠 Local AI & Chat Integration

ContextBridge allows you to have multi-turn conversations about any indexed page. The AI context is strictly bounded to the page content to prevent hallucinations.

**Supported Providers:**
- **Ollama (Local)** — 100% private, offline, and free! (Default host: `http://localhost:11434`)
- **Claude** (Anthropic)
- **OpenAI** (GPT-4o, etc.)
- **Gemini** (Google)

**Setup:**
1. Open the **Settings** gear in the sidebar.
2. Select your preferred **AI Provider**.
3. *For Cloud Providers:* Paste your API key. (Keys are securely stored in local Chrome storage and never transmitted except directly to the provider).
4. *For Ollama:* Ensure your Ollama app is running locally (e.g., `ollama run llama3`), and configure the Host URL if needed.

---

## 🏗️ Connecting to Real Vector Stores

If you're building a RAG application, ContextBridge can forward all chunks directly to your ingestion pipeline. Just switch the Storage Mode to `endpoint-only` or `both`.

<details>
<summary><b>View Python Backend Example (Qdrant + FastAPI)</b></summary>

```python
from fastapi import FastAPI
from pydantic import BaseModel
from qdrant_client import QdrantClient
from openai import OpenAI
from uuid import uuid4

app = FastAPI()
client = QdrantClient(":memory:")
openai = OpenAI()

class Chunk(BaseModel):
    text: str
    start: int
    end: int

class ContextPayload(BaseModel):
    title: str
    url: str
    chunks: list[Chunk]

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
</details>

---

## 📦 Extractor Payload Schema

ContextBridge sends beautifully clean, structured JSON to your backend. Here is the structure:

```json
{
  "title": "Authentication — FastAPI Docs",
  "url": "https://fastapi.tiangolo.com/tutorial/security/",
  "raw_content": "# Authentication\n\n...",
  "chunks": [
    { "index": 0, "text": "...", "start": 0, "end": 1200 }
  ],
  "codeBlocks": [
    { "language": "python", "code": "from fastapi import ...", "lines": 12 }
  ],
  "meta": {
    "domain": "fastapi.tiangolo.com",
    "content_type": "api_docs",
    "word_count": 1840,
    "chunk_count": 5,
    "code_block_count": 3
  }
}
```

---

## 🛡️ Privacy & Security

ContextBridge is engineered with privacy at its core:
- **Local-first by default:** All content is stored purely in IndexedDB on your device.
- **Zero Telemetry:** No analytics, tracking, or sneaky background calls.
- **Direct API Connections:** AI chat makes direct API calls to your chosen provider from your browser — absolutely no intermediary servers.
- **API Keys are safe:** Stored strictly in `chrome.storage.local`.

---

<div align="center">
  <i>Built with Manifest V3, zero build steps, and zero dependencies.</i>
</div>
