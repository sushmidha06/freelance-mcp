# Feature list

A complete inventory of what ships in this repository, organised by surface.
Companion to `README.md` (overview), `ARCHITECTURE.md` (how it works),
`DEPLOY.md` (how to ship it), `DEMO.md` (how to demo it).

---

## Authentication & accounts

- Email + password sign-up and sign-in (PBKDF2-SHA512 hashing, 100k iterations)
- "Sign up first" gate — sign-in for unknown emails returns a clear `NOT_REGISTERED` error
- Google sign-in via Firebase Auth (`signInWithPopup`)
- Server-side session tokens stored in Firestore (`users/{uid}` + `sessions/{token}`)
- Sign out clears session on server and removes Firebase token client-side

## User profile & settings

- Editable profile (name, email — email locked for Google accounts)
- Password change with current-password verification (rotates session token)
- Preferences:
  - Theme: dark / light / system
  - Currency: **USD ($)** or **INR (₹)** — applied across Dashboard, Projects, Billing, PDF invoices
  - Timezone (12 options)
  - Toggles: email notifications, push notifications, weekly digest
- Account deletion (cascades to projects, invoices, alerts, notifications)

## Multi-tenancy & security

- Per-tenant Firestore subtree at `users/{uid}/...`
- Firestore rules deny all client access — every read/write goes through the backend Admin SDK
- Per-user integration credentials encrypted at rest with **AES-256-GCM** (`TOKEN_ENCRYPTION_KEY`)
- Node ↔ Python AI service trust via short-lived **HS256 service JWTs** (5-min TTL, `userId` claim)
- CORS allowlist driven by `ALLOWED_ORIGINS` env var

## Integrations (per-user external accounts)

Each integration is connected via a single dialog in **Settings → Integrations**.
Credentials are AES-encrypted and only decrypted server-side when an MCP tool runs.

| Provider          | Auth                              | Read                              | Write                                              |
|-------------------|-----------------------------------|-----------------------------------|----------------------------------------------------|
| **GitHub**        | Personal Access Token (PAT)       | Repos, PRs, commits, repo activity | —                                                  |
| **Gmail**         | App Password (IMAP)               | Recent inbox, search, full body, **per-email body** | "Convert to expense" via Gemini extraction        |
| **Google Calendar** | Secret iCal URL                 | Upcoming events, search           | One-click "draft event" prefill URL                |
| **Razorpay**      | Key ID + Key Secret               | Invoices, payments, customers     | —                                                  |

## MCP servers (Anthropic spec, in-process transport)

Seven spec-compliant MCP servers exposing **19 tools** total. All implement
`list_tools()` (with JSON Schema arg specs) and `call_tool()` (returning
`TextContent[]` + `isError` per the 2024-11-05 spec).

- **firestore** (4 tools): `list_projects`, `list_invoices`, `get_dashboard_summary`, `list_alerts`
- **github** (4 tools): `list_repos`, `list_open_prs`, `list_recent_commits`, `get_repo_activity`
- **gmail** (3 tools): `list_recent_emails`, `search_emails`, `get_email_body`
- **calendar** (3 tools): `list_upcoming_events`, `search_events`, `draft_event`
- **razorpay** (3 tools): `list_invoices`, `list_payments`, `list_customers`
- **expenses** (1 tool): `create_expense` — agent logs expenses on the user's behalf, optionally rolling up into a project
- **knowledge_base** (1 tool): `search_knowledge` — RAG over the user's own workspace

## Agent runtime

- **LangChain tool-calling agent** driving **Gemini 2.5 Flash** via the OpenAI-compatible endpoint
- Hard-capped at **8 iterations** per chat turn
- Free-tier 429 backoff with retry (4s / 10s / 15s)
- Per-request orchestrator scoped to a single `userId` — every MCP server is constructed with the tenant's NodeClient (no global tools)
- System prompt encourages multi-step chains. Documented examples:
  - "find meetings in mail → draft calendar events" → `gmail__search_emails` → `gmail__get_email_body` → `calendar__draft_event`
  - "log my Vercel receipt for the Northwind project" → `gmail__search_emails` → `gmail__get_email_body` → `firestore__list_projects` → `expenses__create`
  - "summarise my week" → `firestore__get_dashboard_summary` + `gmail__list_recent_emails` + `calendar__list_upcoming_events`

## RAG (per-tenant)

- Per-request snapshot of the user's projects + invoices + alerts → typed `Doc` chunks
- **Plus indexed Gmail bodies** when the user has hit *Sync inbox* on the Inbox page (Firestore-backed, persists across requests)
- **Gemini `gemini-embedding-001`** embeddings via direct REST (httpx, no gRPC)
- Cosine similarity via numpy in production hosting; **Chroma Cloud opt-in** via `RAG_USE_CHROMA=1` (per-tenant collection `tenant_{userId}`)
- 600-char overlapping chunks with metadata: `{source, source_id, title, client, chunk_idx, …}`. Email chunks are 800 chars and carry `{subject, from, gmail_uid, date}`.
- Metadata-filtered search supported: agent can scope by `source` (`project`/`invoice`/`alert`/`email`) or `client`
- No cross-tenant leakage at the vector layer — collection name is the tenancy boundary

## Frontend pages

| Page              | Wired                                                                   |
|-------------------|-------------------------------------------------------------------------|
| `/auth`           | Sign-up / sign-in tabs, Google button, validation, error gating         |
| `/`               | Dashboard: stats (revenue/projects/invoices/commits), agent cards, alerts, quick actions |
| `/inbox`          | Inbox Triage — pulls last 7 days of Gmail, **auto-classifies into folders** (clients/expenses/github/calendar/other), per-email move/delete, **convert-to-expense via Gemini**, **draft AI reply via IMAP APPEND** to Gmail Drafts, **Sync inbox → knowledge base** for RAG over email bodies |
| `/projects`       | Project list with health bars; New Project modal with **GitHub repo picker** (live list of user's repos); **`spent` rolls up live from linked expenses** |
| `/billing`        | Invoice list with revenue/outstanding/overdue totals, mark-paid, **PDF download** |
| `/expenses`       | Manual + agent-logged expenses; totals by month / by category / unattributed; per-row edit & delete; project picker |
| `/integrations`   | Connect / Update / Disconnect cards for the four providers              |
| `/settings`       | Profile, security, preferences (theme/currency/timezone), danger zone   |

## Notifications

- Bell with unread count in topbar
- Backend-driven feed: signup welcome, Google welcome, new project, new invoice, invoice marked paid, profile updated, password changed
- Mark-read / mark-all-read / clear-all
- Per-notification dismiss
- 20 s polling while authenticated
- **Browser push permission** requested on first load
- Native desktop `Notification` fired when a new unread item arrives while the tab is in the background
- Click desktop notification → focuses tab + navigates to the linked page
- Dropdown panel `<Teleport>`'d to `<body>` to escape stacking-context traps from `backdrop-filter` ancestors

## Chat ("Ask Sushmi")

- Slide-out drawer triggered from the topbar
- Sends message + last 6 turns of history to `/api/chat`
- Renders agent response with **MCP tool-call chips** showing which tools were invoked
- Suggested prompts on first open
- Clear-history button

## Project flow

- Create project with **GitHub repo picker** — lists the user's real repos via `/api/integrations/github/repos`
- Repo selection auto-fills the project name on first pick
- Health %, status (On Track / At Risk / Critical), budget, deadline
- Health bar coloured by score (green ≥ 80, amber ≥ 60, rose < 60)

## Invoice flow

- Create invoice with client, amount, due date, status
- Mark as paid (PATCH; pushes notification)
- **Download as PDF** — clean A4 template with violet header, status pill, line items, totals block; respects user's currency (₹ / $)

## Inbox folders

- Server-side classifier (`server/services/emailClassifier.js`) — pure function, no LLM cost
- Auto-buckets every email into one of:
  - `clients/{name}` — matched against the user's project clients (domain-core OR display-name OR first-word match), then falls back to custom email domains
  - `expenses` — finance senders (Stripe / Razorpay / PayPal / Wise / Payoneer / QuickBooks / FreshBooks / Xero / Gusto / Deel) or invoice/payment/receipt keywords
  - `github` — `github.com` senders or PR/commit/issue keywords
  - `calendar` — Calendly / Cal.com / `calendar-noreply@google.com` or meeting/booking keywords
  - `other` — generic provider senders (gmail.com, yahoo, etc.) and notifications
- **User overrides win** — moves persist in `users/{uid}/email_meta/{emailId}` and survive every Gmail refetch
- Per-email actions when expanded: **Move to…** (any existing folder), **Delete** (soft, app-internal — never modifies real Gmail), **Convert to expense**, **Draft AI reply**
- Folder counts in the sidebar update live as you move/delete
- Two-pane layout: collapsible folder tree on the left, email list on the right

## Expenses

- Manual entry via `/expenses` New Expense modal (vendor, amount, date, category, project picker, notes)
- Edit / delete per row
- Stats: total spend, this month, unattributed; spend grouped by category
- 10 default categories (Software / Hardware / Hosting & infra / Subcontractor / Travel / Meals / Office / Marketing / Taxes & fees / Other)
- Currency follows the user's Settings preference (₹ / $)
- **Project rollup** — `GET /api/projects` sums `expenses.amount` where `projectId == project.id` and overrides `project.spent`. The Projects page reflects expenses immediately.
- `source` field tracks origin: `manual` (UI), `email:<id>` (Gmail extraction), `agent` (MCP tool)

## Inbox → knowledge base (RAG indexing)

- **Sync inbox** button on the Inbox page pulls the last 30 days of Gmail (max 100 messages, bodies included), strips HTML, caps at 4 KB per body
- Stored in `users/{uid}/email_bodies/{gmail_uid}` — persistent, idempotent (same UID = same key, upserted)
- On every chat turn the orchestrator pulls these alongside the user's projects/invoices/alerts and merges them into the per-tenant RAG index
- The agent's `knowledge_base__search_knowledge` tool now retrieves email snippets too — pass `source: "email"` to scope to inbox only
- Demo line: *"What did Acme say about the API change last week?"* → tool chip shows `knowledge_base__search_knowledge` → response cites the actual email by subject and date

## Email → AI draft reply

- **Draft AI reply** button on any email opens the Gmail draft directly in the user's `[Gmail]/Drafts` folder
- Backend pulls the email body via IMAP → asks Gemini for a polite reply (matches tone, ≤180 words, no fabricated specifics)
- Composes a properly threaded RFC822 message (`In-Reply-To`, `References` headers) and IMAP-APPENDs it to Drafts
- Uses the same encrypted Gmail credential the user pasted for the inbox — no new auth
- User opens Gmail, sees the draft already in the right thread, edits, sends

## Email → expense automation

- "Convert to expense" button on any inbox email
- Backend pulls the email body via IMAP (UTF-8, HTML stripped, capped at 6 KB)
- **Gemini 2.5 Flash** parses it into `{ vendor, amount, currency, date, category, confidence, reasoning }`
- Modal pre-fills with the extracted values, badged with the model's confidence + one-line reasoning
- User reviews / edits / picks a project / saves → expense lands with `source: "email:<emailId>"`
- Falls back to a regex extractor if no Gemini key is configured (so the flow never fully breaks)

## Deployment

- Frontend → Firebase Hosting
- Node backend → Vercel serverless functions
- Python AI → Render Docker service (auto-deploys on git push)
- All env vars listed in `DEPLOY.md`; all secrets injected at runtime, never in code

## Documentation

- `README.md` — overview, quickstart, tech stack
- `ARCHITECTURE.md` — system diagram, MCP protocol choices, multi-tenancy proofs
- `DEPLOY.md` — env vars, deploy commands, local dev
- `DEMO.md` — 5-minute demo script with talking points mapped to grading rubric
- `FEATURES.md` — this file
