# Architecture

Sushmi MCP is a multi-tenant agentic copilot for freelancers. It treats every
user as a tenant: each user plugs their own GitHub / Gmail / Calendar /
Razorpay accounts into the UI, and an LLM-driven orchestrator calls **MCP
tools** scoped to that tenant's credentials and data. No credentials are
ever shared across users.

## High-level topology

```
┌──────────────────┐                    ┌──────────────────────────┐
│ Vue frontend      │                    │ Node backend (Vercel)     │
│ Firebase Hosting  │ ← HTTPS ─────────→ │ • Auth + CRUD (Firestore) │
│ (SPA)             │                    │ • Per-user integ. vault   │
│                   │                    │ • AES-256-GCM at rest     │
│                   │                    │ • Email classifier        │
│                   │                    │ • Gemini one-shot extract │
└──────────┬────────┘                    └────────────┬─────────────┘
           │ POST /api/chat                           │ HTTPS,
           │ (session token)                          │ HS256 service JWT
           ▼                                          ▼
   ┌─────────────────────────────────────────────────────────┐
   │   Python AI service (FastAPI on Render)                 │
   │                                                          │
   │   Orchestrator (per request, per user)                   │
   │     ↓                                                    │
   │   LangChain tool-calling agent (Gemini 2.5 Flash)        │
   │     ↓ (function calls)                                   │
   │   ┌────────────────┐  ┌────────────────┐                 │
   │   │ Firestore MCP  │  │ GitHub MCP     │                 │
   │   │ 4 tools        │  │ 4 tools        │                 │
   │   └────────────────┘  └────────────────┘                 │
   │   ┌────────────────┐  ┌────────────────┐                 │
   │   │ Gmail MCP      │  │ Calendar MCP   │                 │
   │   │ 3 tools        │  │ 3 tools (incl. │                 │
   │   │                │  │  draft_event)  │                 │
   │   └────────────────┘  └────────────────┘                 │
   │   ┌────────────────┐  ┌────────────────┐                 │
   │   │ Razorpay MCP   │  │ Expenses MCP   │                 │
   │   │ 3 tools        │  │ create_expense │                 │
   │   └────────────────┘  └────────────────┘                 │
   │   ┌───────────────────────────────────┐                  │
   │   │ Knowledge base MCP (RAG)          │                  │
   │   │ search_knowledge (cosine + LLM)   │                  │
   │   └───────────────────────────────────┘                  │
   │                                                          │
   │   Total: 7 servers, 19 tools                             │
   └─────────────────────────────────────────────────────────┘
                                │
                                │ Admin SDK (service-account, server-only)
                                ▼
                        ┌────────────────────────────┐
                        │ Firestore                   │
                        │ users/{uid}/…               │
                        │   ├ projects                │
                        │   ├ invoices                │
                        │   ├ alerts                  │
                        │   ├ notifications           │
                        │   ├ connections/{provider}  │ (encrypted)
                        │   ├ email_meta/{emailId}    │ (folders, deletions)
                        │   ├ email_bodies/{uid}      │ (RAG corpus)
                        │   └ expenses/{id}           │
                        └────────────────────────────┘
```

## The MCP layer (this is the point of the project)

We implement a **spec-faithful Model Context Protocol** (Anthropic 2024-11-05)
server interface in `python_ai/app/mcp_servers/base.py`:

```python
class McpServer:
    def list_tools(self) -> list[dict]:
        # returns [{name, description, inputSchema}]
    def call_tool(self, name: str, arguments: dict) -> dict:
        # returns {content: [TextContent...], isError: bool}
```

Each tool declares a **JSON Schema** for its arguments, matching MCP's
`tools/list` response shape. Tool results are `TextContent[]`, matching MCP's
`tools/call` return shape. Errors surface as `isError: true` with a protocol
error code.

### Why in-process transport

The MCP spec supports both **stdio** (separate process, JSON-RPC 2.0 over
pipes) and **in-process** transports. For a single-instance Python service
scoped to a single tenant's request, spawning seven subprocesses per request
is wasteful — so we run all seven MCP servers in-process and hand them to
the agent through the same `list_tools`/`call_tool` contract. Swapping to
stdio is a drop-in change to the transport layer; the tool contract doesn't
change.

### Servers & tools

| MCP server       | Tenant-scope source           | Tools                                                            |
|------------------|-------------------------------|-------------------------------------------------------------------|
| `firestore`      | user's own Firestore data     | `list_projects`, `list_invoices`, `get_dashboard_summary`, `list_alerts` |
| `github`         | user's PAT (encrypted)        | `list_repos`, `list_open_prs`, `list_recent_commits`, `get_repo_activity` |
| `gmail`          | user's IMAP app password      | `list_recent_emails`, `search_emails`, `get_email_body`           |
| `calendar`       | user's secret iCal URL        | `list_upcoming_events`, `search_events`, `draft_event` (write via prefill URL) |
| `razorpay`       | user's key_id / key_secret    | `list_invoices`, `list_payments`, `list_customers`               |
| `expenses`       | Node `/internal/expenses` (HS256-protected) | `create_expense` — write tool, optionally `project_id` linked |
| `knowledge_base` | per-request FAISS-style index | `search_knowledge` (RAG over user's own workspace)                |

## Agentic loop

`python_ai/app/agent.py` wires the MCP tools into **LangChain's tool-calling
agent** driven by **Gemini 2.5 Flash** (via the OpenAI-compatible endpoint
to sidestep flaky `google-api-core` REST error parsing):

```
user message ─► Gemini (with tool schemas) ─► tool name + args
                ▲                             │
                │                             ▼
        Gemini reads result ◄── MCP server executes tool
                │
                ▼ (may loop up to AGENT_MAX_ITERATIONS)
         final text response
```

This is the classic agent loop: the LLM decides *which* tool to call and *with
what arguments*, the MCP server executes it, the LLM sees the observation,
and iterates until it has an answer.

## Multi-tenancy — how isolation is enforced

1. **Every MCP server is constructed with the tenant's `NodeClient`**, not
   a generic global. Servers have no other way to reach data; they *can't*
   read another user's data even if asked.
2. **`NodeClient` signs an HS256 service JWT with the tenant's `userId`** and
   calls the Node backend's `/internal/*` endpoints. The Node backend verifies
   the JWT and looks up data only under `users/{uid}/…` in Firestore.
3. **Integration credentials** (GitHub PAT, Gmail app password, Razorpay keys)
   live under `users/{uid}/connections/{provider}` and are **AES-256-GCM
   encrypted at rest** using a server-side `TOKEN_ENCRYPTION_KEY`. Decryption
   happens only server-side, and only in response to a valid service JWT.
4. **Firestore rules** (`firestore.rules`) deny **all** client-side reads and
   writes. The browser only interacts with Firestore via Firebase Auth (for
   the Google sign-in popup); every data path routes through the Node backend.
5. **The RAG index is built per-request** from that user's Firestore data,
   discarded at the end of the request. There is no shared vector store.

## RAG

`python_ai/app/rag.py` + `mcp_servers/rag_server.py`:

- On every chat turn, the orchestrator snapshots the user's projects +
  invoices + alerts from Firestore and constructs a list of `Doc` chunks.
- When the agent calls `knowledge_base__search_knowledge`, we embed the query
  and all docs with **Gemini `gemini-embedding-001`** (`task_type=retrieval_*`),
  L2-normalise, compute cosine similarity via a single numpy dot product, and
  return the top-k with scores.
- Returning scores alongside text lets the LLM prioritise high-confidence
  snippets and cite them back to the user.

## Inbox → RAG pipeline

`POST /api/inbox/sync-rag` is a user-triggered button on the Inbox page.
Pulls last 30 days × max 100 messages **with bodies** via IMAP, strips HTML,
caps at 4 KB per body, stores under `users/{uid}/email_bodies/{gmail_uid}`.
Idempotent — re-syncing only updates changed metadata.

On every chat turn the orchestrator pulls these bodies (via the JWT-protected
`/internal/email-bodies` endpoint), runs them through `build_docs_from_emails`
(800-char chunks, 100 overlap), and merges them into the per-tenant RAG index
alongside Firestore data. The agent's `knowledge_base__search_knowledge` tool
sees them automatically — pass `source: "email"` to scope queries to inbox.

**Why server-side persistence (not in-process):** the RAG index is rebuilt
per request because the production backend is in-memory numpy. Firestore
gives us cross-request persistence cheaply without paying for a vector DB
deploy. When `RAG_USE_CHROMA=1`, the same email docs land in Chroma Cloud
with the same idempotent ids.

## Inbox folders

`server/services/emailClassifier.js` is a pure function:
`(envelope, projectClients) → folderPath`. It runs server-side on every
Gmail fetch — no LLM, no token cost.

Order of decisions (first match wins):
1. **GitHub** — sender domain matches `github.com` or subject contains PR /
   commit / merge / issue keywords.
2. **Calendar** — sender is Calendly / Cal.com / `calendar-noreply@google.com`,
   or subject contains meeting / booking / scheduled keywords.
3. **Expenses** — sender is on a finance-domain allowlist (Stripe, Razorpay,
   PayPal, Wise, Payoneer, QuickBooks, FreshBooks, Xero, Gusto, Deel) or
   subject contains invoice / payment / receipt / payout keywords. Checked
   *before* clients so a Stripe receipt for an Acme charge stays in
   `expenses` rather than `clients/acme`.
4. **clients/{name}** — matched against the user's project clients by
   domain core, display-name substring, or first-word substring. Falls
   back to `clients/{domainCore}` for any custom domain that isn't a
   generic provider (gmail.com, yahoo, etc.).
5. **other** — everything else (generic-provider senders, system noreply
   addresses).

User overrides live in `users/{uid}/email_meta/{emailId}` with shape
`{ folder, deleted, updatedAt }`. The classifier output is the *default*;
when an override exists for an email's stable Gmail UID, the override wins
on every refetch. Soft-delete is local — we never modify the user's real
Gmail.

## Expense rollup

`users/{uid}/expenses/{id}` rows can carry a `projectId`. On every
`GET /api/projects` we run `ExpensesService.sumByProject(uid)` in parallel
with the Firestore project read and the GitHub stats fetch, then overwrite
each project's `spent` with the sum of its linked expenses. The Projects
page shows the live, rolled-up number — no separate "refresh" call needed.

Expenses can be created three ways, all server-validated and notified:
- **Manual** (`POST /api/expenses`) from the Expenses page UI — `source: "manual"`
- **Email-extracted** (`POST /api/inbox/email/:id/extract-expense` →
  Gemini one-shot returns `{vendor, amount, date, category, confidence,
  reasoning}`, user reviews + saves) — `source: "email:<emailId>"`
- **Agent** (Python MCP `expenses__create` → `POST /api/internal/expenses`,
  HS256-JWT-protected) — `source: "agent"`

The `source` field is opaque to the agent and the project-rollup logic,
but it makes the Expenses table self-documenting and gives us an audit
trail without extra plumbing.

## Security surfaces

| Surface                       | Mechanism                                  |
|-------------------------------|--------------------------------------------|
| Browser → backend auth         | Opaque session token in Firestore `sessions` |
| Backend → Python trust         | HS256 service JWT, 5-minute TTL, `userId` claim |
| Integration credentials at rest| AES-256-GCM, key in `TOKEN_ENCRYPTION_KEY` env |
| Firestore direct client access | Fully denied in rules                       |
| Gemini API key                 | Only on Python service; never in browser    |

## Deployment

| Service         | Where                | Entry point             |
|-----------------|----------------------|-------------------------|
| Frontend (Vue)  | Firebase Hosting     | `dist/index.html` (Vite build) |
| Backend (Node)  | Vercel serverless    | `api/index.js` → `server/app.js` |
| AI (Python)     | Render Docker        | `python_ai/Dockerfile` |

See `DEPLOY.md` for step-by-step deploy instructions.
