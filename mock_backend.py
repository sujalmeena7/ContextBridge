from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import json

app = FastAPI()

# Enable CORS for the extension to communicate with localhost
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/v1/context")
async def receive_context(request: Request):
    payload = await request.json()
    
    print("\n" + "="*50)
    print(f"📥 RECEIVED PAYLOAD: {payload.get('title')}")
    print(f"🔗 URL: {payload.get('url')}")
    print(f"📄 CONTENT TYPE: {payload.get('meta', {}).get('content_type')}")
    print(f"🧩 CHUNKS: {len(payload.get('chunks', []))}")
    print(f"💻 CODE BLOCKS: {len(payload.get('code_blocks', []))}")
    print("="*50 + "\n")
    
    # Log the first chunk snippet for verification
    if payload.get('chunks'):
        snippet = payload['chunks'][0]['text'][:200] + "..."
        print(f"Preview: {snippet}\n")

    return {
        "status": "success",
        "message": f"Successfully indexed '{payload.get('title')}'",
        "chunks_processed": len(payload.get('chunks', []))
    }

@app.get("/v1/health")
async def health_check():
    return {"status": "ok"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
