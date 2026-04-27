# 6-minute demo script

Walk this script from top to bottom for an interview or recorded demo.
Each section ends with a one-line **point** mapped to a grading criterion.

## Live URLs

- **Frontend:** https://freelance-mcp-c3b42.web.app
- **Backend API:** https://sushmi-mcp.vercel.app/api
- **Python AI service:** https://sushmi-mcp-ai.onrender.com

---

## 0 · Set the stage (30s)

> "Sushmi is a multi-tenant agentic MCP platform for freelancers. Every
> user plugs in their own GitHub, Gmail, Calendar, and Razorpay
> credentials; an LLM orchestrator calls **7 MCP servers / 19 tools**
> scoped to that user only. I'll show: tenant auth, encrypted integrations,
> the spec-compliant MCP catalog, multi-step agent chains, RAG, an
> end-to-end inbox-to-expense automation, and the tenant-isolation
> guarantees."

## 1 · Multi-tenant auth (30s)

1. Open the frontend → sign-up tab.
2. Sign up with a fresh email. Sidebar updates with the user's name; default
   currency is INR (₹), can be flipped to USD ($) in Settings.
3. Open a second browser (incognito) and sign up as a different user. Both
   logged in, zero shared data — proven in step 6.

> **Point:** Per-tenant Firestore subtree at `users/{uid}/…` for every piece
> of data: projects, invoices, notifications, integration credentials,
> email metadata, expenses.

## 2 · Connect integrations (60s)

1. Click **Integrations** in the sidebar. Show **four cards**: GitHub,
   Gmail, Google Calendar, Razorpay.
2. Click **Connect GitHub**, paste a PAT, hit Connect.
3. Card flips to **Connected ✓** with the username shown but the token hidden.
4. (Optional, but lands well) In Firebase Console → Firestore →
   `users/{uid}/connections/github`, show `secrets.token` as an unreadable
   base64 blob.

> **Point:** Credentials are AES-256-GCM encrypted before they hit
> Firestore. The Python AI service can only decrypt them via a short-lived
> HS256 service JWT signed by the Node backend (5-minute TTL, `userId`
> claim). Browser never sees them again after submission.

## 3 · The MCP catalog (45s)

```bash
curl https://sushmi-mcp-ai.onrender.com/mcp/servers \
  -H "Authorization: Bearer <SERVICE_JWT>"
```

Shows **7 MCP servers, 19 tools** with full `inputSchema` (JSON Schema) per
tool:

```
firestore:      list_projects, list_invoices, get_dashboard_summary, list_alerts
github:         list_repos, list_open_prs, list_recent_commits, get_repo_activity
gmail:          list_recent_emails, search_emails, get_email_body
calendar:       list_upcoming_events, search_events, draft_event
razorpay:       list_invoices, list_payments, list_customers
expenses:       create_expense
knowledge_base: search_knowledge
```

> **Point:** Every tool exposes `name`, `description`, `inputSchema` per
> the MCP 2024-11-05 spec. `call_tool` returns `{content: [TextContent],
> isError}` — also spec-compliant. In-process transport for now;
> swapping to stdio subprocess is a drop-in change to the transport
> layer (the tool contract doesn't move).

## 4 · Agent loop in action (90s)

Click **Ask Sushmi** in the top bar.

### 4a — Single-tool: `firestore`
> "What projects do I have?"

- Tool chip shows `firestore__list_projects`. Natural-language summary.

### 4b — External integration: `github`
> "List my open GitHub PRs."

- Tool chip: `github__list_open_prs`. Real data from api.github.com via the
  user's PAT. If GitHub isn't connected, agent says "Connect GitHub in
  Integrations" — no hallucination.

### 4c — Multi-step chain: `gmail` + `calendar` (the showstopper)
> "Find any meeting requests in my emails this week and add them to my calendar."

The agent autonomously runs:
1. `gmail__search_emails(query="meeting OR call OR schedule newer_than:7d")`
2. `gmail__get_email_body(uid=…)` for promising candidates
3. Extracts title, datetime, attendees from the body itself
4. `calendar__draft_event(title=…, start=…, end=…, attendees=…)` for each
5. Returns one-click prefill URLs the user opens to confirm in Google Calendar

> **Point:** This is LangChain's tool-calling agent driving Gemini 2.5
> Flash via the OpenAI-compatible endpoint. The LLM picks *which* MCP
> tool to call and *what arguments to pass* — it's a real function-calling
> loop, not regex over a prompt. Capped at 8 iterations.

## 5 · End-to-end inbox → expense → project rollup (60s)

This is the flagship demo: agent + folders + expenses all working together.

### 5a — UI flow (proves the building blocks)
1. Visit `/inbox`. Folder sidebar already shows `clients/…`, `expenses`,
   `github`, `calendar`, `other`. Click an expense email (e.g. a Stripe or
   Razorpay receipt).
2. Hit **Convert to expense**. Modal opens, "Reading email and
   extracting…" spinner. Backend pulls the body via IMAP and runs **Gemini
   2.5 Flash** to parse vendor / amount / date / category / confidence.
3. Modal pre-fills with the extracted values + a **"Gemini extracted
   (high/medium/low confidence)"** badge with the model's reasoning.
4. Pick a project from the dropdown. Hit **Save**.
5. Visit `/expenses` — new row, tagged `source: email:<id>`.
6. Visit `/projects` — the project's **Spent** card has updated, rolled
   up from the new expense.

### 5b — Agent flow (the same thing, by chat)
> "Log my Vercel receipt from yesterday as a hosting expense for the Northwind project."

The agent autonomously runs:
1. `gmail__search_emails(query="vercel newer_than:2d")`
2. `gmail__get_email_body(uid=…)` to read amount + date
3. `firestore__list_projects` to find the Northwind project id
4. `expenses__create(vendor="Vercel", amount=…, category="Hosting & infra", project_id=…)`
5. Confirms in chat with the new expense id; the project's **Spent**
   updates immediately on `/projects`.

> **Point:** Four MCP servers chained inside one agent turn. Real Gemini
> extraction → real Firestore write → live cross-page roll-up. No mocks,
> no fixtures, no scripted demo — the LLM picked all four tools and
> their arguments.

## 6 · RAG over the user's actual inbox (60s — flagship)

This is the moment the demo lands hardest for a RAG company.

1. On `/inbox`, point at the violet **Knowledge base sync** banner.
2. Click **Sync inbox to knowledge base**. Toast: *"Indexed N emails — Ask
   Sushmi can now cite them."* Banner updates with the count.
3. Open **Ask Sushmi** and ask something email-shaped, e.g.
   > "What did Acme say about the API change last week?"
4. Tool chip shows `knowledge_base__search_knowledge`. The agent retrieves
   the actual email by content, cites it back by subject + date.

Compare with a workspace question:
> "Search my workspace for anything related to invoices."

- Same tool, different `source` filter. Returns invoice + project snippets,
  not emails.

> **Point:** Per-tenant RAG over a *combined* corpus — Firestore data plus
> the user's indexed Gmail bodies. Embeddings are **Gemini `gemini-embedding-001`**
> via direct REST (httpx — no gRPC threads-of-doom). 600/800-char overlapping
> chunks, metadata-tagged so the agent can scope by `source` or `client`.
> Production backend is in-memory numpy cosine; **Chroma Cloud integration**
> is wired and tested locally — flip with `RAG_USE_CHROMA=1`. The numpy
> default avoids a documented `chromadb`/`grpcio.aio` interaction with
> FastAPI's worker-thread model on Render's free tier.

## 7 · Tenant isolation proof (30s)

Switch to the second browser (other user).

> "What projects do I have? What expenses?"

- Agent returns **zero** for both — different tenant, different Firestore
  subtree, different MCP server instances entirely.

> **Point:** Every MCP server is constructed with the tenant's
> `NodeClient`. A server *cannot* reach another user's data — no global
> tools, no shared state. Firestore rules deny all direct client reads
> too; the boundary is enforced four layers deep.

## 8 · Wrap-up (30s)

> "Stack: Vue on Firebase Hosting, Express on Vercel, FastAPI on Render,
> Firestore for data, Gemini 2.5 Flash + LangChain + 7 spec-compliant MCP
> servers for intelligence. Multi-tenancy is enforced at every layer:
> Firestore rules, AES-256-GCM encrypted credentials, per-tenant
> NodeClient construction, and HS256 service JWTs scoped to a userId.
> Read-and-write tools, real RAG, and end-to-end automation flows
> demoable today."

---

## Fallback if Gemini free-tier rate-limits at the wrong moment

The agent backs off and retries on 429, but if you're unlucky:

- Hit `/mcp/servers` directly — shows the full 19-tool catalog without an LLM call
- Use the **Convert to expense** UI flow — proves Gemini extraction + project rollup with one button
- Walk through `/inbox` folder tree + move/delete — proves classifier + persistence without an LLM call
- Show the encrypted token in Firebase Console — proves the security boundary
- Show `ARCHITECTURE.md` diagram live

Each one alone demonstrates the MCP core; the LLM chat is the visible polish on top.
