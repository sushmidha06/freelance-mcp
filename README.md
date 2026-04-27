# Sushmi MCP — Multi-tenant agentic copilot for freelancers

A production-grade demonstration of the **Model Context Protocol** (Anthropic 2024-11-05 spec) powering a per-user agent loop. Every user brings their own GitHub / Gmail / Razorpay credentials; an LLM orchestrator calls MCP tools scoped exclusively to that tenant.

- **Live frontend:** https://freelance-mcp-c3b42.web.app
- **Live backend API:** https://sushmi-mcp.vercel.app/api
- **AI service:** deployable via `render.yaml` — see `DEPLOY.md`

## What's inside

- **5 MCP servers** exposing 15 tools — all spec-compliant (`list_tools`, `call_tool`, JSON-Schema args, `TextContent` results, `isError` on failure)
  - `firestore` — user's projects, invoices, alerts, dashboard
  - `github` — repos, PRs, commits, weekly activity (reads user's PAT)
  - `gmail` — recent/search/get (reads user's IMAP app password)
  - `razorpay` — invoices, payments, customers (reads user's test keys)
  - `knowledge_base` — semantic search over the user's workspace (Gemini embeddings + cosine)
- **LangChain tool-calling agent** driving **Gemini 2.0 Flash** — real function-calling loop, capped at 8 iterations
- **Multi-tenant isolation** enforced at four layers:
  - Firestore rules deny all client access; backend Admin SDK only
  - Per-user integration credentials encrypted with **AES-256-GCM** at rest
  - MCP servers constructed with the tenant's `NodeClient` — can't reach another tenant's data by design
  - HS256 service JWTs (5-min TTL, `userId` claim) authenticate Node → Python
- **Per-request RAG** — FAISS-style index built from the tenant's Firestore data, discarded after the request

## Docs

| File                 | What                                                               |
|----------------------|--------------------------------------------------------------------|
| `ARCHITECTURE.md`    | System diagram, MCP protocol choices, multi-tenancy proofs          |
| `DEMO.md`            | 5-minute demo script mapping to grading rubric                      |
| `DEPLOY.md`          | Full deploy runbook for all three services                          |

## Quick start (local)

```bash
# 1. Install deps
npm install                                    # frontend + Node backend deps (hoisted)
cd python_ai && python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt
cd ..

# 2. Configure .env at repo root
cp .env.example .env
# fill in GEMINI_API_KEY, FIREBASE_SERVICE_ACCOUNT, etc.

# 3. Run — three terminals
npm run dev                                    # frontend  http://localhost:5174
cd server && npm run dev                       # backend   http://localhost:3001
cd python_ai && .venv/bin/uvicorn app.main:app --port 8001  # AI

# 4. Open http://localhost:5174, sign up, connect a GitHub PAT in Integrations,
#    click "Ask Sushmi" and ask anything
```

## Tech

| Layer      | Stack                                                                |
|------------|----------------------------------------------------------------------|
| Frontend   | Vue 3, Vite, Tailwind, Pinia, Vue Router                             |
| Backend    | Node 20, Express, Firebase Admin, jsonwebtoken, axios                |
| AI service | Python 3.11, FastAPI, LangChain, langchain-google-genai, httpx       |
| LLM        | Gemini 2.0 Flash + `gemini-embedding-001`                            |
| Data       | Firestore (per-tenant subcollections), in-memory FAISS-style RAG     |
| Hosting    | Firebase Hosting, Vercel, Render (Docker)                            |

## License

Private — RagWorks assignment submission.
