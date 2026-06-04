# Phase 25: Cal.com Booking Migration - Research

**Researched:** 2026-06-03
**Domain:** Booking-provider migration — swap Zoho Bookings backend for Cal.com Cloud (free tier) behind an unchanged middleware HTTP contract (Express.js, ES5, Railway, Jest)
**Confidence:** MEDIUM-HIGH (API mechanics HIGH/CITED; free-tier feature inclusion is the central LOW-confidence risk — see Open Questions)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Cal.com Cloud, free tier** (NOT self-hosted). Revisit self-host only if free-tier API rate limits become a problem.
- Cal.com credentials (API key, event-type IDs, webhook signing secret) live in **Railway env vars**, mirroring the existing `ZOHO_BOOKINGS_*` pattern. New vars likely: `CALCOM_API_KEY`, `CALCOM_EVENT_TYPE_FERMENT` (+ one per additional type), `CALCOM_WEBHOOK_SECRET`. Add to `lib/validateEnv.js` OPTIONAL list.
- **Contract preservation (critical):** The frontend MUST NOT change. The middleware `/api/bookings*` endpoints keep identical request/response shapes. Cal.com calls are an internal implementation detail behind an adapter (suggest `lib/calcom.js` mirroring `lib/zoho-api.js` bookings helpers).
- `POST /api/bookings` still accepts `{ customer: { name, email, phone }, date, time, notes }` and returns `{ ok, booking_id, timeslot }`. Map `customer.email` into the Cal.com attendee so Cal.com sends the confirmation.
- Set up **multiple Cal.com event types in this phase**: ferment-in-store (parity) PLUS at least one additional type. `GET /api/bookings/services` should return event types in the shape the frontend expects from the old Zoho "services" response.
- **Manual re-entry** of existing upcoming Zoho appointments (e.g. Anne MacDougall, June 4 1:00 PM). No migration script. Clean switch (not dual-run).
- Customer booking confirmation now comes from **Cal.com** (sent over HTTPS — sidesteps Railway's blocked outbound SMTP). Staff notification via Cal.com notifications where possible.
- Wire Cal.com **HMAC-signed webhooks** (created/cancelled/rescheduled) to a new endpoint (suggest `POST /api/webhooks/calcom`), signature-verified, exempt from the API-key guard like the existing terminal webhook. At minimum: verify signature + log; ideally cancellation handling.
- After verification, remove/disable `bookingsGet`/`bookingsPost` usage in `routes/bookings.js`, the `ZOHO_BOOKINGS_SERVICE_ID`/`ZOHO_BOOKINGS_STAFF_ID` env references, and any now-dead helpers. No dead references left behind.
- Preserve the offline-fallback behavior currently in `routes/bookings.js`.

### Claude's Discretion
- Exact module layout for the Cal.com adapter (e.g. `lib/calcom.js` + thin `routes/bookings.js`).
- Cal.com API v2 endpoint/version specifics (this research confirms them below).
- How `GET /api/bookings/availability` (month view) and `/slots` (day view) map onto Cal.com's slots API.
- Caching strategy for availability/slots (mirror existing cache TTLs/keys where sensible).
- Test doubles for Cal.com (follow existing `__tests__` patterns: mock `https`/the adapter).

### Deferred Ideas (OUT OF SCOPE)
- Self-hosting Cal.com (only if free-tier rate limits bite).
- Programmatic migration of historical Zoho Bookings data.
- Replacing/repairing the middleware SMTP layer for non-booking staff alerts.
- Deep webhook side effects beyond signature-verify + cancellation handling.
- Changing the checkout/payment flow (Helcim stays as-is).
</user_constraints>

<phase_requirements>
## Phase Requirements

No formal REQ-IDs were supplied for this phase. The de-facto requirements derived from CONTEXT.md scope:

| ID | Description | Research Support |
|----|-------------|------------------|
| BK-01 | Authenticate to Cal.com API v2 from middleware | §Auth — Bearer key + per-endpoint `cal-api-version` header [CITED] |
| BK-02 | `GET /api/bookings/services` backed by Cal.com event types | §Event Types + §Contract Mapping (services↔event-types) |
| BK-03 | `GET /api/bookings/availability` (month) backed by Cal.com slots | §Availability/Slots + §Contract Mapping (derive per-date `available`/`slots_count`) |
| BK-04 | `GET /api/bookings/slots` (day) backed by Cal.com slots | §Availability/Slots + §Contract Mapping (ISO→12h "10:00 AM") |
| BK-05 | `POST /api/bookings` creates a Cal.com booking, attendee email triggers confirmation | §Create Booking — attendee.email triggers Cal.com email [CITED] |
| BK-06 | Cal.com HMAC webhook endpoint, signature-verified, key-guard-exempt | §Webhooks + §Mirror existing terminal webhook |
| BK-07 | Customer (and ideally host) confirmation email proven on staging | §Confirmation Emails — acceptance proof |
| BK-08 | Remove Zoho Bookings code paths + env refs, no dead references | §Runtime State Inventory |
| BK-09 | Jest tests for adapter + routes; lint clean; both suites green | §Validation Architecture |
</phase_requirements>

## Summary

The migration is a pure backend swap: replace the four Zoho-Bookings-backed handlers in `zoho-middleware/routes/bookings.js` with a thin adapter (`lib/calcom.js`) calling Cal.com API v2, while keeping the exact request/response JSON the frontend already parses. The frontend (`js/modules/12c-checkout-scheduling.js`) reads only three things: `data.dates[]` (`{date, slots_count}`) for the month grid, `data.slots[]` (strings or `{time}` in **12-hour "10:00 AM"** format) for the day grid, and `{ok, booking_id, timeslot}` from the POST. Cal.com's models differ on every one of these, so the adapter's main job is **shape translation**, not new business logic.

Cal.com API v2 is the correct target (v1 is legacy/deprecated). Auth is a simple `Authorization: Bearer <key>` plus a **per-endpoint dated `cal-api-version` header** — the version string differs by endpoint and is mandatory. Slots come from `GET /v2/slots` keyed by date with ISO-8601 timestamps; the adapter converts these to the 12-hour strings the frontend wants and derives the month-availability summary by counting slots per day. Booking creation is `POST /v2/bookings` with an `attendee` object — supplying `attendee.email` is exactly what triggers Cal.com's confirmation email, which is the acceptance proof that closes the original "customer didn't get a confirmation" thread and sidesteps Railway's blocked SMTP.

**Primary recommendation:** Build `lib/calcom.js` (axios, mirroring `bookingsGet`/`bookingsPost`) exporting `listEventTypes()`, `getSlots(eventTypeId, start, end, timeZone)`, plus a thin `routes/bookings.js` that maps Cal.com responses into the legacy shapes. Use America/Vancouver as the canonical timeZone. Mirror `lib/helcim.js`'s `verifyWebhookSignature` for `lib/calcom.js#verifyWebhook` (note: Cal.com uses a **single header `x-cal-signature-256`, hex digest, HMAC over the raw body** — simpler than Helcim's Svix scheme). **CRITICAL OPEN QUESTION:** sources conflict on whether webhooks + API keys are truly on the free tier — verify by creating a real key + webhook on a free account before committing to the plan (see Open Questions Q1).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cal.com auth + API calls | API / Middleware | — | API key must never reach the browser; same as Zoho today |
| Shape translation (Cal.com ↔ legacy contract) | API / Middleware | — | The entire point of the phase — adapter owns it |
| Availability/slots caching | API / Middleware (Redis) | — | Mirror existing 5-min TTLs; protects free-tier rate limit |
| Booking creation | API / Middleware | — | Server-authoritative; attendee email drives confirmation |
| Webhook signature verification | API / Middleware | — | Key-guard-exempt route; raw body required |
| Confirmation/reminder emails | External (Cal.com SaaS) | — | Deliberately offloaded — Railway blocks SMTP |
| Event-type / availability setup | External (Cal.com dashboard) | — | **Dashboard-only — manual setup step, see flags below** |
| Calendar UI (month grid, slot picker) | Browser | — | Unchanged — must not be touched |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `axios` | already in `zoho-middleware/package.json` | HTTP client for Cal.com calls | Already used by `lib/zoho-api.js`; reuse `withRetry` wrapper |
| `crypto` (Node built-in) | n/a | HMAC-SHA256 webhook verification | Already used by `lib/helcim.js` |
| Cal.com API v2 | dated versions per endpoint | Booking backend | v1 is legacy/deprecated; v2 is the documented current API |

**No new npm packages required.** This is a HIGH-confidence "don't add dependencies" outcome — everything needed (axios, crypto, the cache layer, the retry wrapper) already exists in the middleware. There is an official `@calcom/sdk`/`@calcom/api` family, but adding it contradicts the codebase's minimal-dependency ES5 style and offers nothing over a ~150-line axios adapter. **Do not add it.**

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled axios adapter | `@calcom/api-v2` SDK / atoms | SDK is React-oriented, heavier, ESM, and pulls a large dep tree into an ES5 CommonJS app. Rejected. |
| API v2 | API v1 (`/v1/*` + `?apiKey=`) | v1 is legacy and being phased out; v2 has the dated-version contract this research documents. Use v2. |

**Installation:** None. (Confirm `axios` present: `cd zoho-middleware && npm ls axios`.)

## Package Legitimacy Audit

**No external packages are installed in this phase** — the adapter uses only `axios` (already a dependency) and Node's built-in `crypto`. slopcheck was unavailable at research time, but since no new packages are introduced, there is nothing to audit. If the planner decides to add the Cal.com SDK against this recommendation, gate it behind a `checkpoint:human-verify` task and run the Package Legitimacy Gate first.

## Cal.com API v2 — Concrete Facts (for the planner)

> **Version note:** v2 versions are dated strings sent in a **mandatory** `cal-api-version` header. The value is **different per endpoint**. Omitting it silently falls back to an older endpoint version with a different response shape — a top pitfall. Values below are from official docs; one (`/bookings`) returned a newer date via direct doc fetch than older search snippets, so **the planner/implementer must confirm each value against the live doc page at build time.**

### 1. Auth [CITED: cal.com/docs/api-reference/v2/introduction]
- **Base URL:** `https://api.cal.com/v2`
- **Auth header:** `Authorization: Bearer <CALCOM_API_KEY>` (API keys conventionally prefixed `cal_...`).
- **API key creation:** Cal.com dashboard → **Settings → Security → API Keys** (a.k.a. Developer settings). **DASHBOARD-ONLY → manual setup step.**
- **Rate limit:** standard **120 requests/min** (raisable to 200 on request; higher tiers via support). [CITED: introduction page]

### 2. Event Types — backs `GET /api/bookings/services` [CITED: cal.com/docs/api-reference/v2/event-types/get-all-event-types]
- **Endpoint:** `GET /v2/event-types`
- **Header:** `cal-api-version: 2024-06-14` (must be exactly this).
- **Useful query params:** `username` (filter by user), `eventSlug` (requires username), `sortCreatedAt=asc|desc`.
- **Each event-type object includes:** `id` (numeric), `title`, `slug`, `lengthInMinutes`, `description`, `price`, `currency`, `bookingUrl`, plus ~50 more.
- **Example:**
```bash
GET https://api.cal.com/v2/event-types?username=steins-and-vines&sortCreatedAt=asc
cal-api-version: 2024-06-14
Authorization: Bearer cal_xxx
```
```json
{ "status": "success", "data": [
  { "id": 1, "title": "Ferment in Store", "slug": "ferment-in-store",
    "lengthInMinutes": 60, "description": "...", "price": 0, "currency": "CAD",
    "bookingUrl": "https://cal.com/steins-and-vines/ferment-in-store" }
]}
```
> Note: the `username` for the free single-user account is set at signup (DASHBOARD-ONLY). The planner can either filter by `username` or, more robustly, drive `services` directly from the known `CALCOM_EVENT_TYPE_*` env IDs (one `GET /v2/event-types/{id}` per configured type) so output is deterministic regardless of other event types on the account.

### 3. Availability / Slots — backs `GET /api/bookings/availability` (month) and `GET /api/bookings/slots` (day) [CITED: cal.com/docs/api-reference/v2/slots/get-available-time-slots-for-an-event-type]
- **Endpoint:** `GET /v2/slots`
- **Header:** `cal-api-version: 2024-09-04` (must be exactly this — different from event-types/bookings).
- **Query params:**
  - `eventTypeId` (numeric)
  - `start` — ISO-8601 UTC; date-only `2026-06-01` defaults to start-of-day
  - `end` — ISO-8601 UTC; date-only `2026-06-30` defaults to end-of-day
  - `timeZone` — e.g. `America/Vancouver` (defaults UTC) — **set this so returned offsets match Squamish local time**
  - `format` — omit for default (per-date arrays of `{start}`); `format=range` adds `{start,end}`
- **Default response shape** — object keyed by `YYYY-MM-DD`, value = array of slot objects with ISO-8601 `start` (with TZ offset):
```json
{ "status": "success", "data": {
  "2026-06-05": [
    { "start": "2026-06-05T09:00:00.000-07:00" },
    { "start": "2026-06-05T10:00:00.000-07:00" }
  ],
  "2026-06-06": [ { "start": "2026-06-06T09:00:00.000-07:00" } ]
}}
```
- **Both the month view and the day view come from this ONE endpoint.** For the day view, request a single day (`start=<date>`, `end=<date>`); for the month view, request the whole month in a **single call** and derive per-day counts — a major efficiency win over the current Zoho code which fans out one request per day in batches of 5 (see Pitfall 3).

### 4. Create Booking — backs `POST /api/bookings` [CITED: cal.com/docs/api-reference/v2/bookings/create-a-booking]
- **Endpoint:** `POST /v2/bookings`
- **Header:** `cal-api-version: <dated>` — direct doc fetch returned `2026-02-25`; older search snippets said `2024-08-13`. **Confirm against the live doc page at build time** (this is the value most likely to have changed).
- **Request body:**
```json
{
  "start": "2026-06-05T16:00:00Z",
  "eventTypeId": 123,
  "attendee": {
    "name": "Anne MacDougall",
    "email": "anne@example.com",
    "timeZone": "America/Vancouver",
    "language": "en"
  },
  "metadata": { "notes": "Cabernet kit" },
  "bookingFieldsResponses": {}
}
```
  - `start` is **ISO-8601 in UTC** (`...Z`). The legacy contract receives `date: "YYYY-MM-DD"` + `time: "10:00 AM"` (local) → adapter must combine + convert to a UTC instant in America/Vancouver. (Existing `normalizeTimeTo24h` gives 24h local time; pair it with a TZ-aware conversion — see Pitfall 2.)
  - `attendee.name`, `attendee.email`, `attendee.timeZone` are **required**.
  - `metadata`: max 50 keys, 40 chars/key, 500 chars/value — fine for `notes`.
- **Response:**
```json
{ "status": "success", "data": {
  "id": 123, "uid": "booking_uid_123", "status": "accepted",
  "start": "2026-06-05T16:00:00Z", "end": "2026-06-05T17:00:00Z",
  "attendees": [ { "name": "Anne MacDougall", "email": "anne@example.com" } ]
}}
```
  - Map to legacy: `booking_id` ← `data.uid` (preferred — stable string, what cancel/reschedule webhooks key on) **or** `data.id`. Recommend `uid`. `timeslot` ← original `body.date + ' ' + body.time` (unchanged from today).

### 5. Confirmation Emails [CITED: cal.com/pricing — "Email & SMS notifications" listed under free plan]
- Cal.com sends the **attendee confirmation email automatically** when a booking is created with a valid `attendee.email`. This is the mechanism that fixes the original missing-confirmation bug and bypasses Railway's blocked SMTP (sent from Cal.com's servers over HTTPS).
- **Host (staff) notification:** the account owner (host) also receives a notification by default. For a shared staff inbox, point the Cal.com account email / add the staff address in the dashboard. Email content/branding is configurable via **Workflows** in the dashboard (DASHBOARD-ONLY).
- **Acceptance proof for the whole phase:** on staging, make one real test booking and confirm the attendee email actually arrives. `[ASSUMED]` that the *default* template is acceptable without Workflow customization — confirm with the owner whether the default email wording is good enough or a Workflow is needed.

### 6. Webhooks [CITED: cal.com/docs/developing/guides/automation/webhooks]
- **Configured in dashboard:** Settings → Developer → Webhooks (`/settings/developer/webhooks`). **DASHBOARD-ONLY → manual setup step.** Set the subscriber URL (`https://<middleware>/api/webhooks/calcom`) and a **secret** at creation time.
- **Triggers available:** `BOOKING_CREATED`, `BOOKING_CANCELLED`, `BOOKING_RESCHEDULED`, `BOOKING_REQUESTED`, `BOOKING_REJECTED`, `BOOKING_PAID`, `MEETING_STARTED/ENDED`, `FORM_SUBMITTED`, plus more. Subscribe to **CREATED / CANCELLED / RESCHEDULED** for parity.
- **Signature scheme:**
  - Header: **`x-cal-signature-256`** (single header — not the Helcim/Svix triple of webhook-id/timestamp/signature).
  - Algorithm: **HMAC-SHA256**, **hex** digest.
  - Signed payload: the **raw request body string** (use `req.rawBody`, already captured by `express.json({verify})` in `server.js`). `[ASSUMED]` raw-body (vs `JSON.stringify(req.body)`) based on standard practice — **verify with a real delivery on staging**; key whitespace/ordering differences make this a classic source of mismatch (mirror how `lib/helcim.js` handles candidates). Compare with `crypto.timingSafeEqual`.
- **Verification reference implementation (adapt to ES5 + raw body):**
```js
// lib/calcom.js
var crypto = require('crypto');
function verifyWebhook(rawBody, signature) {
  var secret = process.env.CALCOM_WEBHOOK_SECRET || '';
  if (!secret) { log.warn('[calcom] CALCOM_WEBHOOK_SECRET not set — skipping verification'); return true; } // fail-open dev pattern, matches helcim/reCAPTCHA
  var expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature || '')); }
  catch (e) { return false; } // length mismatch
}
```
- **Webhook side-effects (per CONTEXT scope):** minimum = verify + log via `eventLog.logEvent('calcom.webhook_received', {...})`; respond `200` immediately then process async (mirror `routes/webhooks.js`). Cancellation handling = invalidate the slots/availability cache for the affected date so freed slots reappear.

### 7. Free-tier limits & gotchas
- **Rate limit:** 120 req/min standard [CITED]. The current per-day-fan-out availability code would spend ~30 requests for one month view; the v2 single-call month fetch reduces this to **1 request/month/event-type**, comfortably inside the limit. Redis caching (existing 5-min TTLs) protects it further.
- **1-user free plan** [CITED: cal.com/pricing] — fine for a single shared business calendar; multi-staff round-robin would need a paid Teams plan (out of scope; the shop books against one calendar today).
- **v1 vs v2:** use **v2** (dated headers). Avoid v1 (`?apiKey=`) — legacy.
- **Managed/Platform API vs regular API:** the **Platform/managed-users API** (`x-cal-client-id` + `x-cal-secret-key`, OAuth, managed users) is for embedding Cal.com inside your own product as a reseller and is a **paid platform plan** — **do NOT use it.** This phase uses the plain **API-key** path against a normal free account. Confirm the planner targets the API-key flow, not Platform.

## Architecture Patterns

### System Architecture Diagram
```
Browser (UNCHANGED)
  js/modules/12c-checkout-scheduling.js
    │  GET /api/bookings/availability?year&month   (expects {dates:[{date,slots_count}]})
    │  GET /api/bookings/slots?date                (expects {slots:[ "10:00 AM" | {time} ]})
    │  POST /api/bookings {customer,date,time,notes} (expects {ok,booking_id,timeslot})
    ▼
Middleware  zoho-middleware/  (Express, ES5, Railway)
    routes/bookings.js  ── thin: validate (unchanged) + offline fallback (unchanged)
    │        ├── translate legacy req → Cal.com params
    │        ├── Redis cache (existing keys/TTLs)
    │        └── translate Cal.com resp → legacy shape  ◄── the core work
    ▼
    lib/calcom.js  (NEW — mirrors lib/zoho-api.js bookings helpers)
      listEventType(id) / listEventTypes()   → GET  /v2/event-types
      getSlots(eventTypeId,start,end,tz)      → GET  /v2/slots
      createBooking({...})                    → POST /v2/bookings
      verifyWebhook(rawBody, signature)       → crypto HMAC-SHA256 hex
    ▼ (HTTPS, Authorization: Bearer + cal-api-version)
Cal.com API v2  (api.cal.com/v2)
    └── sends attendee + host confirmation EMAIL over HTTPS  ──► customer inbox (bypasses Railway SMTP)
    └── fires webhook ──► POST /api/webhooks/calcom (key-guard-exempt, x-cal-signature-256 verified)
                              └── handleCalcomWebhook(): log + on CANCELLED invalidate slot cache
```

### Recommended Project Structure
```
zoho-middleware/
├── lib/
│   ├── calcom.js          # NEW — adapter (axios + crypto), mirrors zoho-api bookings helpers
│   └── zoho-api.js        # remove bookingsGet/bookingsPost + BOOKINGS_API_BASE after cutover
├── routes/
│   ├── bookings.js        # rewrite handlers to delegate to lib/calcom.js; keep validation + offline fallback verbatim
│   └── webhooks.js        # add POST /api/webhooks/calcom handler (mirror terminal pattern)
├── lib/validateEnv.js     # add CALCOM_* to OPTIONAL; remove ZOHO_BOOKINGS_* after cutover
└── __tests__/
    ├── bookings.test.js   # extend: assert legacy shapes from mocked Cal.com responses
    └── calcom.test.js     # NEW — unit-test adapter + verifyWebhook (mock https/axios)
```

### Pattern 1: Thin route + adapter (mirror existing zoho-api split)
**What:** `routes/bookings.js` keeps all validation/offline-fallback logic unchanged and delegates I/O to `lib/calcom.js`; the route owns shape translation.
**When to use:** Always here — it preserves the contract and keeps Cal.com swappable.

### Pattern 2: Single-call month availability
**What:** Fetch the whole month from `GET /v2/slots` in one request; group by date; emit `{date, available:true, slots_count:N}` for days with slots.
**Example:**
```js
// routes/bookings.js — availability handler (sketch)
var data = await calcom.getSlots(eventTypeId, year+'-'+month+'-01', lastDay, 'America/Vancouver');
var byDate = data.data || {};            // { "2026-06-05": [ {start}, ... ], ... }
var dates = Object.keys(byDate).map(function (d) {
  return { date: d, available: byDate[d].length > 0, slots_count: byDate[d].length };
}).filter(function (r) { return r.available; });
res.json({ source: 'calcom', dates: dates });   // <-- exact legacy shape
```

### Pattern 3: ISO slot → legacy "10:00 AM" string
**What:** The frontend renders `s.time || s` and matches `/(\d+):(\d+)\s*(AM|PM)/i`. Convert each Cal.com ISO `start` to a 12-hour America/Vancouver string.
**Example:**
```js
// Given start = "2026-06-05T09:00:00.000-07:00"
var label = new Date(start).toLocaleTimeString('en-US', {
  hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Vancouver'
}); // -> "9:00 AM"
// emit { time: label } OR the bare string — frontend accepts both
res.json({ date: ds, slots: byDate[ds].map(function (s){ return { time: toLabel(s.start) }; }) });
```

### Anti-Patterns to Avoid
- **Omitting `cal-api-version`** → silently get an older response shape. Always send the correct dated value per endpoint.
- **Returning ISO timestamps in `/slots`** → frontend regex expects "10:00 AM"; bare ISO renders broken. Convert.
- **Using `JSON.stringify(req.body)` for webhook HMAC** → likely mismatch; use `req.rawBody`.
- **Routing the Cal.com webhook through the API-key guard or referer guard** → Cal.com can't send `x-api-key`/Referer. Mount it so the existing `/webhooks/` exemption (`server.js:239`) applies, and confirm the referer guard at `server.js:363` doesn't block it.
- **Adding the Cal.com SDK** → unnecessary heavy dependency in an ES5 CommonJS app.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Confirmation/reminder emails | Custom SMTP mailer for booking emails | Cal.com's built-in emails (attendee + host) | The whole point — Railway blocks SMTP; Cal.com sends over HTTPS |
| Availability calculation | Per-day slot computation / conflict logic | `GET /v2/slots` (respects calendar, buffers, working hours) | Cal.com already accounts for connected calendars + rules |
| Webhook signature verify | New HMAC code from scratch | Mirror `lib/helcim.js#verifyWebhookSignature` (simplify to single hex header) | Proven `timingSafeEqual` + fail-open-when-unset pattern already in repo |
| HTTP client / retry | New fetch wrapper | Reuse `axios` + `withRetry` from `lib/zoho-api.js` | Consistency, already battle-tested |
| Time-of-day conversion | New AM/PM parser | Reuse `normalizeTimeTo24h` (for POST) + `toLocaleTimeString` w/ timeZone (for slots) | Avoid duplicate, subtly-wrong time math |

**Key insight:** Almost everything this phase needs already exists in the middleware. The net-new code is one adapter file plus shape-translation glue in the route.

## Runtime State Inventory

> Rename/refactor/migration phase — this is a backend provider swap. Inventory of state that a code change alone does NOT fix:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **Existing upcoming Zoho Bookings appointments** (e.g. Anne MacDougall, June 4 1:00 PM). Per CONTEXT these are few. | **Manual re-entry into Cal.com at cutover** (data task, not code). No migration script. |
| Live service config | **Cal.com account setup is dashboard-only:** create account, set username, create event types (ferment-in-store + ≥1 more), generate API key, create webhook with secret. None of this is in git. | **Manual setup steps in the plan** before any code can be tested. |
| OS-registered state | None — no OS-level scheduled tasks reference Zoho Bookings. (Verified: middleware is request-driven; no cron/Task Scheduler for bookings.) | None |
| Secrets/env vars | **Add** `CALCOM_API_KEY`, `CALCOM_EVENT_TYPE_FERMENT` (+ per extra type), `CALCOM_WEBHOOK_SECRET` to Railway (staging + prod) and `lib/validateEnv.js` OPTIONAL list. **Remove after cutover:** `ZOHO_BOOKINGS_SERVICE_ID`, `ZOHO_BOOKINGS_STAFF_ID` from Railway + validateEnv. | API patch (Railway dashboard) + code edit |
| Build artifacts | None — middleware is not compiled; no egg-info/bundle that caches Zoho Bookings. Frontend `main.js`/`main.min.js` are **NOT touched** (no frontend change). | None — but do NOT run frontend build for this phase (no module changes). |

**Code references to Zoho Bookings to remove after cutover (grep-verified):**
- `routes/bookings.js`: `bookingsGet`, `bookingsPost`, `normalizeTimeTo24h` import line, `process.env.ZOHO_BOOKINGS_SERVICE_ID`, `process.env.ZOHO_BOOKINGS_STAFF_ID`.
- `lib/zoho-api.js`: `bookingsGet`, `bookingsPost`, `BOOKINGS_API_BASE` (lines ~64, 178-214, exports ~305/313-315). `normalizeTimeTo24h` is **reused by the new POST path — keep it**.
- `lib/validateEnv.js`: `ZOHO_BOOKINGS_SERVICE_ID`, `ZOHO_BOOKINGS_STAFF_ID` (lines 51-52).

## Common Pitfalls

### Pitfall 1: Wrong / missing `cal-api-version` per endpoint
**What goes wrong:** Response shape differs from what the adapter parses; slots come back empty or fields are renamed.
**Why:** v2 defaults to an older endpoint version when the header is absent/wrong; each endpoint has its own dated version (`event-types: 2024-06-14`, `slots: 2024-09-04`, `bookings: confirm at build — possibly 2026-02-25`).
**How to avoid:** Centralize the version constants in `lib/calcom.js`; assert them in tests; confirm each against the live doc page during implementation.
**Warning signs:** Empty `data` (see Cal.com issue #23770), 400 errors, missing fields.

### Pitfall 2: Timezone drift on booking start time
**What goes wrong:** Booking lands an hour off; "10:00 AM" Squamish becomes 10:00 UTC.
**Why:** `POST /v2/bookings` wants `start` as a **UTC** ISO instant, but the contract provides local date+12h time. PST/PDT (-08/-07) makes naive concatenation wrong.
**How to avoid:** Combine `date` + `normalizeTimeTo24h(time)`, interpret in `America/Vancouver`, convert to UTC for `start`; always send `attendee.timeZone: "America/Vancouver"` and `timeZone=America/Vancouver` on `/slots`.
**Warning signs:** Test booking shows wrong hour in Cal.com; slot labels offset.

### Pitfall 3: Re-implementing the slow per-day availability fan-out
**What goes wrong:** Porting Zoho's batch-of-5-per-day loop wastes the rate budget.
**Why:** Zoho's `/availableslots` was per-date; Cal.com's `/v2/slots` returns a whole range in one call.
**How to avoid:** One month-range request, group by date. Keep the 5-min Redis cache.

### Pitfall 4: Webhook blocked or signature mismatch
**What goes wrong:** Cal.com webhook returns 401/403 (guard) or signature fails.
**Why:** API-key guard / referer guard reject external POSTs; or HMAC computed over the wrong body.
**How to avoid:** Ensure path starts with `/webhooks/` (covered by `server.js:239` exemption); verify the referer guard (`server.js:363`) doesn't reject no-referer requests to this path; HMAC over `req.rawBody`, hex, `timingSafeEqual`; **verify with a real staging delivery.**
**Warning signs:** Webhook log empty; "sig mismatch" warnings.

### Pitfall 5: `services` output depends on other event types in the account
**What goes wrong:** `GET /v2/event-types` returns unrelated event types, polluting `/api/bookings/services`.
**How to avoid:** Drive `services` from the known `CALCOM_EVENT_TYPE_*` env IDs (fetch each by id) rather than listing everything.

## Code Examples

### Adapter skeleton (mirror lib/zoho-api.js)
```js
// lib/calcom.js
var axios = require('axios');
var log = require('./logger');
var BASE = 'https://api.cal.com/v2';
var V = { eventTypes: '2024-06-14', slots: '2024-09-04', bookings: '2026-02-25' }; // CONFIRM bookings at build
function hdr(version){ return { Authorization: 'Bearer ' + (process.env.CALCOM_API_KEY||''), 'cal-api-version': version }; }
function getSlots(eventTypeId, start, end, tz){
  return axios.get(BASE + '/slots', { headers: hdr(V.slots), timeout: 15000,
    params: { eventTypeId: eventTypeId, start: start, end: end, timeZone: tz || 'America/Vancouver' } })
    .then(function(r){ return r.data; });
}
function createBooking(b){
  return axios.post(BASE + '/bookings', b, { headers: hdr(V.bookings), timeout: 15000 })
    .then(function(r){ return r.data; });
}
// listEventType(id), verifyWebhook(rawBody, signature) ... (see §6)
module.exports = { getSlots: getSlots, createBooking: createBooking, /* ... */ };
```
*Source: shapes from cal.com/docs/api-reference/v2 (event-types, slots, bookings) [CITED]; style mirrors existing `lib/zoho-api.js`.*

## Contract-Mapping Notes (Cal.com ↔ legacy Zoho shapes)

| Legacy endpoint / field | Zoho source | Cal.com source | Adapter bridge |
|-------------------------|-------------|----------------|----------------|
| `GET /services` → `{services, staff}` | `/services` + `/staffs` | `GET /v2/event-types` (or by-id) | Map event types → `services` array; `staff` likely becomes `[]` or a single synthetic entry (free plan = 1 user). **Confirm frontend tolerates empty `staff`** — `12c` does not read `staff`, so `[]` is safe. |
| `availability` → `dates:[{date, slots_count}]` | per-day `/availableslots` | one `GET /v2/slots` range | Group by date, count, filter to `available` days |
| `slots` → `{date, slots:[ "10:00 AM" \| {time} ]}` | Zoho slot list | `data[date]:[{start ISO}]` | Convert ISO → 12-hour America/Vancouver string |
| `POST /bookings` body | `{service_id, staff_id, from_time, customer_details, additional_fields}` | `{eventTypeId, start(UTC), attendee{name,email,timeZone}, metadata.notes}` | Combine date+time→UTC; phone → `metadata` (Cal.com attendee has no first-class phone — put in metadata or a booking field) |
| `POST /bookings` resp → `{ok, booking_id, timeslot}` | `appointment.booking_id` | `data.uid` / `data.id` | `booking_id ← data.uid`; `timeslot` ← original `date+' '+time` |

**Notable mismatches the adapter must absorb:**
1. **No `staff` concept** on the free single-user plan — emit `staff: []` (frontend ignores it).
2. **No first-class phone field** on Cal.com attendee — stash `customer.phone` in `metadata.phone` (or a custom booking field configured in the dashboard). `[ASSUMED]` metadata is acceptable for the shop's needs — confirm.
3. **Slots are timestamps, not labels** — conversion required.
4. **Month availability is derived, not fetched** — Cal.com has no "which dates have any slot" endpoint; derive from the range call.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Cal.com API v1 (`?apiKey=`) | API v2 (Bearer + dated `cal-api-version`) | v2 GA (2024) | Use v2; v1 legacy |
| Per-day availability calls | Single range `/v2/slots` call | v2 slots | Far fewer requests |

**Deprecated/outdated:** Cal.com API v1; the Zoho Bookings code paths being removed.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Webhooks + API keys are available on the **free** Cal.com plan | Free-tier / Webhooks | **HIGH** — phase premise. Pricing page lists Webhooks under "Advanced features"; multiple secondary sources say free includes them. **Must verify on a real free account.** (Open Q1) |
| A2 | Webhook HMAC is over the **raw body** string, hex | §6 Webhooks | MEDIUM — wrong → all webhooks 401. Verify with a real staging delivery. |
| A3 | `bookings` endpoint `cal-api-version` value | §4 Create Booking | MEDIUM — fetch returned 2026-02-25, search said 2024-08-13. Confirm at build. |
| A4 | Default attendee confirmation email is acceptable without a Workflow | §5 Emails | LOW-MED — may need branding/wording tweak; confirm with owner. |
| A5 | Phone stored in `metadata` is sufficient (no dedicated phone field) | §Contract Mapping | LOW — acceptable for a small shop; confirm. |
| A6 | Frontend tolerates `staff: []` in services response | §Contract Mapping | LOW — verified `12c` never reads `staff`; safe. |

## Open Questions

1. **Are webhooks + API keys actually on the free Cal.com Cloud plan? (BLOCKING-RISK)**
   - What we know: cal.com/pricing lists "Email & SMS notifications" and "Unlimited event types" on free, but groups **Webhooks** under "Advanced features" and **Custom APIs** as a premium/Teams feature. Several secondary sources (Rollout, dev.to, max-productive) state free includes webhooks + API.
   - What's unclear: whether the pricing-page "Advanced features" grouping means webhooks require a paid plan. The official help/pricing pages were ambiguous.
   - Recommendation: **Before locking the plan**, create a real free account and (a) generate an API key under Settings→Security, (b) create a webhook with a secret. If either is paywalled, the locked "free tier" decision needs revisiting (cheapest paid individual plan, or revisit self-host). Make this the **first task / a `checkpoint:human-verify`** in the plan.

2. **`bookings` endpoint version string** — confirm `cal-api-version` (2026-02-25 vs 2024-08-13) against the live doc at build time.

3. **Webhook raw-body vs stringify for HMAC** — confirm empirically with a staging delivery; have the verifier try raw body first (mirror helcim's multi-candidate approach if needed).

4. **Which additional event type(s)** beyond ferment-in-store? (e.g. consultation / tasting / equipment pickup) — owner to decide; affects how many `CALCOM_EVENT_TYPE_*` vars + dashboard event types to create.

5. **Staff/host notification target** — which email receives host notifications, and is the default email template acceptable or does a Workflow need configuring?

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `axios` | adapter HTTP | ✓ (in middleware) | per package.json | — |
| Node `crypto` | webhook HMAC | ✓ (built-in) | — | — |
| Redis | availability/slots cache | ✓ (existing) | — | degrades gracefully (existing `checkRedis`) |
| Cal.com free account + API key | all live calls | ✗ (must be created) | — | **none — blocking manual setup** |
| Cal.com webhook capability | webhook endpoint | **UNVERIFIED (Open Q1)** | — | log-only / polling if paywalled |

**Missing dependencies with no fallback:** Cal.com account + API key + event types (dashboard-only manual setup; must precede testing).
**Missing dependencies with fallback:** Redis (graceful degrade already handled).

## Validation Architecture

> `.planning/config.json` not present in repo root context; treating nyquist_validation as enabled (default).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest (middleware suite, node env) |
| Config file | `zoho-middleware/package.json` (jest config) / existing `__tests__` |
| Quick run command | `cd zoho-middleware && npm test -- bookings.test.js calcom.test.js` |
| Full suite command | `cd zoho-middleware && npm test` (then root `npm test` for frontend) |

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| BK-02 | services maps event types → legacy shape | unit | `cd zoho-middleware && npm test -- bookings.test.js` | ✅ extend |
| BK-03 | availability derives `{date,slots_count}` from one /slots call | unit | same | ✅ extend |
| BK-04 | slots converts ISO → "10:00 AM" | unit | same | ✅ extend |
| BK-05 | POST builds correct Cal.com body + maps `uid`→booking_id; offline fallback intact | unit | same | ✅ extend |
| BK-06 | verifyWebhook accepts valid hex sig, rejects bad | unit | `cd zoho-middleware && npm test -- calcom.test.js` | ❌ Wave 0 |
| BK-09 | both suites + lint green | suite | `cd zoho-middleware && npm test` + `npm run lint` | ✅ |

### Sampling Rate
- **Per task commit:** `cd zoho-middleware && npm test -- bookings.test.js calcom.test.js`
- **Per wave merge:** `cd zoho-middleware && npm test` (full middleware suite)
- **Phase gate:** middleware suite + `npm test` (frontend, to prove no regression) + `npm run lint` all green, plus the **manual staging acceptance booking with confirmed email arrival** (BK-07).

### Wave 0 Gaps
- [ ] `zoho-middleware/__tests__/calcom.test.js` — adapter + `verifyWebhook` (mock axios/https), covers BK-06.
- [ ] Mock Cal.com fixtures (event-type, slots-by-date, booking response) for `bookings.test.js` to assert legacy shapes (BK-02..BK-05).
- [ ] Per CLAUDE.md rule #3: write the regression test asserting the legacy response shape **before** rewriting handlers.

## Security Domain

> `security_enforcement` not explicitly false — included.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `CALCOM_API_KEY` server-side only (Railway env); never sent to browser |
| V5 Input Validation | yes | Keep existing strict validation in `routes/bookings.js` (date regex, email, length caps) unchanged |
| V6 Cryptography | yes | HMAC-SHA256 webhook verify via Node `crypto`, `timingSafeEqual` — never hand-roll compare |
| V9 Communications | yes | HTTPS to api.cal.com (axios default) |
| V13 API/Webhook | yes | Webhook endpoint signature-verified; respond 200 fast; process async |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged webhook (fake cancellation) | Spoofing/Tampering | `x-cal-signature-256` HMAC verify over raw body |
| API key leakage | Info disclosure | Server-side env only; not in `js/sheets-config.js`/frontend |
| Timing attack on sig compare | Info disclosure | `crypto.timingSafeEqual` |
| Webhook replay | Tampering | Idempotent handling (log/cache-invalidate only; no destructive side effects) |
| Referer/key-guard bypass of webhook | Elevation | Confirm `/webhooks/` exemption applies AND referer guard tolerates no-referer for this path |

## Project Constraints (from CLAUDE.md)
- Middleware is its own app — **always `cd zoho-middleware`** before running its commands.
- **Before every commit:** run `npm test` (frontend) AND `cd zoho-middleware && npm test`; run `npm run lint`; fix all lint errors.
- **Bug-fix discipline:** write the regression/shape-assertion test FIRST, then change code. One logical change per commit.
- **Read existing code + grep all usages** before modifying any function (esp. `bookingsGet`/`bookingsPost` removal).
- After changing any shared lib (`zoho-middleware/lib/*.js`), run the FULL suite for both frontend and middleware.
- ES5 style: `var`, function declarations, no ESM (matches `lib/zoho-api.js`/`lib/helcim.js`).
- **Do NOT edit `js/main.js`/`js/main.min.js`**; this phase makes **no frontend changes**, so no `npm run build` needed (and must not introduce frontend module changes).
- Never commit `.env`/credentials. `CALCOM_*` secrets go in Railway only.
- **Staging-first, mandatory:** `git push origin main` → verify on staging → human approval → then production.

## Sources

### Primary (HIGH confidence)
- cal.com/docs/api-reference/v2/introduction — base URL, Bearer auth, 120 req/min rate limit
- cal.com/docs/api-reference/v2/event-types/get-all-event-types — endpoint, `cal-api-version: 2024-06-14`, object fields, example
- cal.com/docs/api-reference/v2/slots/get-available-time-slots-for-an-event-type — `/v2/slots`, `cal-api-version: 2024-09-04`, params, date-keyed response
- cal.com/docs/api-reference/v2/bookings/create-a-booking — `/v2/bookings`, attendee body, response uid/id (version date to confirm)
- cal.com/docs/developing/guides/automation/webhooks — `x-cal-signature-256`, HMAC-SHA256, triggers list, dashboard config
- cal.com/pricing — free plan: 1 user, unlimited event types, Email & SMS notifications (webhooks grouping ambiguous → Open Q1)
- Local code: `routes/bookings.js`, `lib/zoho-api.js`, `routes/webhooks.js`, `lib/helcim.js`, `lib/validateEnv.js`, `server.js`, `js/modules/12c-checkout-scheduling.js`, `js/modules/12-checkout.js`

### Secondary (MEDIUM confidence)
- WebSearch (Cal.com docs links) — slots params/response, `cal-api-version` per-endpoint values
- Rollout / blog.elest.io / dev.to — free-plan webhook+API claims (contradict pricing-page grouping → flagged)

### Tertiary (LOW confidence)
- Community/forum threads on slots 400s + empty data (corroborate Pitfall 1)

## Metadata
**Confidence breakdown:**
- API mechanics (endpoints/auth/shapes): HIGH — official v2 docs, cross-checked
- Contract mapping: HIGH — verified against actual frontend parsing code
- Free-tier webhook/API inclusion: LOW — conflicting sources, must verify (Open Q1)
- Webhook HMAC body form + bookings version date: MEDIUM — confirm empirically at build

**Research date:** 2026-06-03
**Valid until:** ~2026-06-17 (Cal.com v2 dated versions move; re-confirm header values if implementing later)
