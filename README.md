# Contract Obligation Assistant

Upload a contract (and, optionally, a short organisational policy). An AI workflow extracts parties, dates, renewal, termination and notice terms, obligations and unclear or conflicting terms, **each with an exact cited quote**. A person reviews every item. Approved items then drive **deterministically calculated** reminder dates, an upcoming-deadlines dashboard and a reviewed contract summary.

> **This is an information-management tool, not legal advice.** It extracts and organises what a contract says; it does not interpret enforceability, recommend actions or replace the signed document. The disclaimer is shown on every page, in the AI system prompt, and in every generated summary.

---

## Contents

1. [Requirement coverage](#requirement-coverage)
2. [Architecture](#architecture)
3. [AI workflow and safeguards](#ai-workflow-and-safeguards)
4. [Human review, versions and staleness](#human-review-versions-and-staleness)
5. [Deterministic dates and reminders](#deterministic-dates-and-reminders)
6. [Running locally (no Docker)](#running-locally-no-docker)
7. [Testing](#testing)
8. [Logging](#logging)
9. [Deployment](#deployment)
10. [API reference](#api-reference)
11. [Decisions and assumptions](#decisions-and-assumptions)
12. [Intentionally left out](#intentionally-left-out)
13. [Known limitations](#known-limitations)

---

## Requirement coverage

| Requirement | Where |
|---|---|
| Upload one contract + optional policy (text PDF, DOCX, pasted text; no OCR) | `backend/src/services/documentParser.js`, `frontend/src/components/DocumentForm.jsx` |
| Parties, effective date; expiry, renewal, termination, notice clauses | AI item types `party`, `effective_date`, `expiry`, `renewal`, `termination`, `notice` |
| Obligations, deadlines, responsible parties | item type `obligation` with `responsibleParty`, `date` / `dateRule` / `recurrence` |
| Unclear or conflicting terms | item types `ambiguity`, `conflict` (contract↔contract and contract↔policy) |
| Exact source section behind every item | Mandatory citations (section + verbatim quote), verified in code: `services/citationVerifier.js` |
| Confirmed vs uncertain interpretation | `certainty: confirmed | interpretation` + reason; unverifiable quotes are forced to `interpretation` |
| Clarification questions for ambiguous clauses | Required on `ambiguity`/`conflict` items (schema-enforced) and requested for interpretations |
| Edit / approve / reject extracted items | `services/reviewService.js`, `components/review/ItemCard.jsx` |
| Reminder dates via deterministic code | `services/dateEngine.js`, `services/scheduleBuilder.js` (no LLM involved) |
| Upcoming obligations and renewal deadlines | `GET /api/dashboard`, Dashboard page |
| Preserve versions and user corrections | Immutable versions; `ai_value` never changes; every action audited in `item_reviews` |
| Mark approved items potentially stale on a new version | `flagApprovedItemsAsStale` in the version-upload transaction |
| Reviewed contract summary | `services/summaryBuilder.js` (approved items only), JSON + Markdown download + print |
| Human approval for important AI actions | Every AI item starts `pending`; only approved items affect reminders, dashboard and summary |
| Loading / empty / validation / success / failure states | `components/StatusViews.jsx`, inline field errors, toasts, extraction status panel |
| Structured app and AI-workflow logs | pino JSON logs with request ids; `ai.*` workflow events; per-run audit in `extraction_runs` |
| Focused tests | 130 backend unit/route tests + 17 PostgreSQL integration tests; 15 frontend tests |

## Architecture

```
contract-obligation-assistant/
├── backend/                 Node.js · Express 5 · ES modules · Knex · PostgreSQL
│   ├── src/
│   │   ├── config/          env validation (zod), limits, extraction vocabulary
│   │   ├── db/              knex instance, migration runner, migrations/
│   │   ├── models/          table access (camelCase ↔ snake_case mapping)
│   │   ├── services/        parsing, sectioning, AI client, extraction, review, dates, reporting
│   │   ├── prompts/         versioned extraction prompt + JSON schema
│   │   ├── controllers/     HTTP handlers (thin)
│   │   ├── routes/          route wiring
│   │   ├── validators/      zod request + AI-output schemas
│   │   ├── middleware/      request id, logging, uploads, errors, frontend hosting
│   │   ├── utils/           logger, errors, hashing, text normalisation
│   │   ├── app.js           express app factory (dependency-injected, testable)
│   │   └── server.js        composition root, startup checks, graceful shutdown
│   └── tests/               unit + route tests; tests/integration (PostgreSQL)
└── frontend/                React 19 · Vite · React Router · TanStack Query · plain CSS
    └── src/
        ├── api/             fetch client (ApiError) + query/mutation hooks
        ├── components/      layout, status views, review cards, contract tabs
        ├── pages/           Dashboard, Contracts, Upload, Contract detail
        └── utils/           formatting, upload validation
```

**Request flow:** upload → parse + normalise text → split into sections (deterministic) → store version → queue AI extraction (background job, state in PostgreSQL) → frontend polls run status → reviewer approves/edits/rejects items → schedule, dashboard and summary are computed on read from approved items.

**Data model** (8 tables):

```
contracts ─< contract_versions ─< documents (contract | policy) ─< sections
                    │
                    ├─< extraction_runs ─< extracted_items ─< item_citations >─ sections
                    │                                    └─< item_reviews (audit trail)
```

- `extracted_items.ai_value` is the model's original output and is **never modified**; reviewer corrections go to `current_value`.
- `item_reviews` records every edit, approve, reject, reopen, reconfirm and system `mark_stale` action with before/after snapshots, note and actor.
- Reminders and schedules are **computed on read**, never stored, so they cannot drift from the reviewed data.

## AI workflow and safeguards

Provider: **Google Gemini** via `@google/genai` (`GEMINI_MODEL`, default `gemini-flash-latest`).

1. **Sections before AI.** Each document is split into sections by deterministic rules (`1.`, `4.2.1`, `Section 5`, `Article IV`, `Schedule 1`, text before the first heading → `Preamble`; unnumbered documents → paragraphs). Each section gets a short key (`C1…` contract, `P1…` policy).
2. **Constrained generation.** The model receives the keyed sections and a system prompt that forbids legal advice and outside knowledge, and must return JSON matching a schema (`responseJsonSchema`, temperature 0). Prompt version is stored on each run (`extraction-v1`).
3. **Validation in code** (`extractionItemBuilder.js`):
   - each item is validated individually (zod); invalid items are discarded with a recorded warning, the rest are kept;
   - `ambiguity`/`conflict` items without a clarification question are rejected;
   - dates must be real calendar dates; the model never computes dates, it only supplies a written date or a relative rule.
4. **Citation verification.** Every quote must appear in the cited section (whitespace, case and typographic quotes ignored; `...` allowed between exact fragments). If the key is wrong but the quote appears in exactly one other section, the citation is corrected and logged. Any quote that cannot be found is marked **unverified** and the item is forced to `interpretation`.
5. **Pending by default.** All items are stored as `pending`. Nothing the AI produces affects dates, the dashboard or the summary until a person approves it. Approving an item with an unverified quote **requires a note**.
6. **Run audit.** `extraction_runs` stores status, model, prompt version, token usage, latency, item/invalid/unverified counts, warnings and the raw model JSON (in the database only, never in logs).
7. **Resilience.** 429/5xx/timeouts retry with exponential backoff (3 attempts); other failures get specific codes (`AI_NOT_CONFIGURED`, `AI_AUTH_FAILED`, `AI_OUTPUT_TRUNCATED`, `AI_BLOCKED`, `AI_INVALID_JSON`, `AI_INVALID_OUTPUT` …) shown in the UI with a retry button. Runs interrupted by a restart are marked `INTERRUPTED` on boot.

## Human review, versions and staleness

- **Statuses:** `pending → approved | rejected`; `reopen` returns to pending. Invalid transitions return `409 INVALID_TRANSITION`.
- **Edits** only change supplied fields, keep `ai_value` intact, set `is_edited`, and return the item to `pending` so the corrected value must be approved.
- **Versions** are immutable. Uploading identical text returns `409 DUPLICATE_VERSION`. If a new version has no policy, the previous policy is carried forward (reported as `policyCarriedOver`).
- **Staleness:** in the same transaction that creates a new version, **every approved item from earlier versions** is flagged `potentiallyStale`. A deterministic hint compares the cited sections' text hashes with the new version: *"§2.1 text changed; §3.1 text unchanged (now §4.1)"*. The reviewer reconfirms ("Confirm still valid") or dismisses each one. Stale items stay visible, with a warning, in the schedule, dashboard and summary until resolved.
- Re-extracting a version that already succeeded is blocked (`409 ALREADY_EXTRACTED`) so review decisions are never silently replaced; only failed runs can be retried.

## Deterministic dates and reminders

All date maths is plain code on ISO `YYYY-MM-DD` strings in UTC (`dateEngine.js`), so results never shift with timezones or DST. Every computed date carries a human-readable `calculation`, e.g. `60 days before current term end 2027-01-01 = 2026-11-02`.

| Convention | Behaviour |
|---|---|
| Months / years | Same day-of-month, clamped to month end (Jan 31 + 1 month = Feb 28/29) |
| Business days | Monday–Friday; **no public-holiday calendar** |
| Term from period | `12 months after 2026-01-01 = 2027-01-01` (literal; edit the date if the contract means 31 Dec) |
| Auto-renewal | If expiry has passed and the approved renewal item auto-renews with a term, the term is rolled forward to the current term; the calculation states the assumption that no notice was given |
| Relative rules | `{offset, unit, before/after, anchor}` with anchor `effective_date`, `expiry_date` (→ current term end) or `event` (cannot be dated; listed with the reason) |
| Recurring obligations | Next occurrence on/after today, computed from the start date to avoid month-end drift |
| Conflicts | If approved items disagree (e.g. two effective dates), the date is reported as undetermined with both values; nothing is guessed |
| Precedence | latest-version items > reconfirmed older items > stale items |
| Reminders | 30, 7 and 1 day before each deadline |
| "Today" | The browser sends its local date (`asOf`) so "due soon" matches the user's calendar; defaults to UTC today |

## Running locally (no Docker)

Prerequisites: Node.js ≥ 20 (developed on 24), PostgreSQL ≥ 13 running locally, a Gemini API key.

```bash
# 1. Databases (use your PostgreSQL bin directory if createdb is not on PATH)
createdb -U postgres contract_assistant
createdb -U postgres contract_assistant_test     # optional, for integration tests

# 2. Backend
cd backend
cp .env.example .env        # set DATABASE_URL, GEMINI_API_KEY (and TEST_DATABASE_URL)
npm install
npm run migrate
npm run dev                 # http://localhost:4000/api/health/ready

# 3. Frontend (second terminal)
cd frontend
npm install
npm run dev                 # http://localhost:5173 (proxies /api to :4000)
```

Configuration is validated at startup; missing or invalid variables stop the server with a readable list. See `backend/.env.example` and `frontend/.env.example` (names only, no secrets). Without `GEMINI_API_KEY` the app still runs; extraction runs fail visibly with `AI_NOT_CONFIGURED`.

## Testing

```bash
cd backend  && npm test     # unit + route tests; integration tests run when TEST_DATABASE_URL is set
cd frontend && npm test
npm test                    # from the repo root: both
```

Focus areas:

- **Date engine & schedule**: month-end clamping, leap years, business days, DST, auto-renewal roll-forward, recurrence, conflicting approvals, explanations.
- **AI safeguards**: per-item validation, fabricated/paraphrased quotes, wrong section keys, missing clarification questions, invalid dates, output shape; Gemini client retries and error classification (mocked SDK).
- **Ingestion**: real generated PDF/DOCX files, scanned-PDF rejection, corrupt files, size limits, sectioning offsets and hashing.
- **Review rules**: allowed transitions, note required for unverified items, edits returning to pending, stale reconfirmation.
- **HTTP layer**: validation errors, error envelope, request ids, uploads (type/size/field), frontend fallback.
- **Integration (PostgreSQL)**: upload → extraction (fake LLM) → review → new version → staleness → schedule/dashboard/summary.
- **Frontend**: upload validation, API error handling, approve-with-note behaviour, stale actions, edit patch building.

Integration tests truncate all tables, so `TEST_DATABASE_URL` **must** point at a separate, disposable database.

## Logging

Structured JSON via pino (pretty-printed in development). Every response has an `X-Request-Id` (incoming ids are reused if well-formed), included in each request log line and in every error body, and shown in the UI on failures.

| Event | Fields |
|---|---|
| request log | id, method, url, status, duration |
| `contract.created` / `contract.version_added` | ids, per-document source type, char/section counts, `staleItemCount`, duration |
| `ai.extraction.queued/started/succeeded/failed` | runId, versionId, model, promptVersion, item/invalid/unverified/remapped counts, tokens, latency, error code |
| `ai.llm_call.succeeded/failed` | attempt, model, latency, tokens, error code, willRetry |
| `review.approve/reject/edit/reopen/reconfirm` | itemId, item type, from/to status |
| `summary.generated` | contractId, version, approved count, completeness |

Contract text, quotes and prompts are **never** logged; authorization/cookie headers are redacted.

## Deployment

The app deploys as **one Node service** (Express serves the API and the built React app from the same origin) plus a managed PostgreSQL database. `render.yaml` is a Render Blueprint for exactly that:

1. Push this repository to a Git host you control and create a Render Blueprint from it.
2. Enter `GEMINI_API_KEY` when prompted (it is declared `sync: false`, so it is never stored in the repo).
3. Render runs `npm run build` (installs backend production deps, builds the frontend) and `npm start` (applies migrations, then starts the server). Health check: `/api/health/ready`.

Any Node host works the same way: set `DATABASE_URL`, `GEMINI_API_KEY`, `NODE_ENV=production`, `FRONTEND_DIST_DIR=../frontend/dist`, then run `npm run build` and `npm start` from the repo root. Set `DATABASE_SSL=true` if your database requires TLS.

## API reference

All endpoints are under `/api` and return JSON errors as `{ error: { code, message, details?, requestId } }`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health`, `/health/ready` | Liveness; readiness (database) |
| GET | `/dashboard?asOf&windowDays` | Deadlines across contracts, counts, undated obligations |
| GET / POST | `/contracts` | List / create (multipart `contractFile` or `contractText`, optional `policyFile`/`policyText`, `title`); starts extraction |
| GET | `/contracts/:id` | Contract with version history |
| POST | `/contracts/:id/versions` | New version (+ optional `note`); flags stale items; starts extraction |
| GET | `/contracts/:id/items` | Review workspace: latest-version items + carried-over approved items + counts |
| GET | `/contracts/:id/schedule?asOf` | Anchors, deadlines with reminders and calculations, undated items |
| GET | `/contracts/:id/summary?asOf&format=json\|markdown` | Reviewed summary |
| GET | `/versions/:id` | Version with documents and sections |
| GET / POST | `/versions/:id/extractions` | List runs / start or retry extraction (202) |
| GET | `/versions/:id/items` | Items of one version |
| GET | `/extractions/:runId` | Run status (polled by the UI) |
| GET / PATCH | `/items/:id` | Item with citations and review history / correct fields |
| POST | `/items/:id/approve` \| `reject` \| `reopen` | Review decisions (optional `note`) |

## Decisions and assumptions

- **No authentication** (single-user tool). Not required by the brief; see limitations before exposing real contracts publicly.
- **Background jobs in-process** with state in PostgreSQL rather than a queue service: sufficient for a single instance; restarts mark interrupted runs as failed and retryable.
- **Summary is template-based, not LLM-written**, so it can only contain reviewed content with citations.
- **Policy carried forward** to a new version when none is uploaded, so policy conflicts don't silently disappear.
- **Deadlines from stale items stay visible** (flagged) rather than hidden, to avoid silently dropping a real deadline.
- **Dashboard window** (default ±90 days) omits overdue items older than the window so long-expired terms don't dominate.
- **Limits:** files ≤ 10 MB; contract ≤ 200,000 characters; policy ≤ 50,000 characters ("small"); scanned PDFs are detected (too little text per page) and rejected.

## Intentionally left out

Per the brief: electronic signatures, external calendar integration, OCR, payment processing, legal recommendations.
Also not built (not required): user accounts/roles and multi-tenancy, email/push notifications (reminders are shown in the app), holiday calendars for business days, side-by-side version text diff, deleting contracts, re-extracting a successfully extracted version.

## Known limitations

- **No access control**: anyone who can reach the deployment can read and change data. Add authentication before using real, confidential contracts.
- Sectioning is heuristic; unusual numbering may produce coarse sections (citations still verify against the stored text).
- AI extraction quality depends on the model; the review step is the control, and unverified quotes are flagged.
- Schedules are computed per request across all contracts — fine for small volumes, would need caching or materialisation at scale.
- Single instance assumed for background jobs and start-up migrations.
- Free-tier hosting may sleep when idle, delaying the first request.
