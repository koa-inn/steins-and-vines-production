# Phase 25: Cal.com Booking Migration - Context

**Gathered:** 2026-06-03
**Status:** Ready for planning
**Source:** Interactive discussion (booking-provider migration)

<domain>
## Phase Boundary

Replace the **Zoho Bookings** backend with **Cal.com Cloud (free tier)** for appointment booking, WITHOUT changing the website frontend. The middleware keeps the same `/api/bookings*` HTTP contract; only the implementation behind it swaps from Zoho Bookings to Cal.com.

**In scope:**
- New Cal.com adapter in the middleware (auth, list event types/"services", availability, slots, create booking).
- Keep the existing endpoints and response shapes: `GET /api/bookings/services`, `GET /api/bookings/availability`, `GET /api/bookings/slots`, `POST /api/bookings`.
- Multiple Cal.com **event types** set up now (ferment-in-store + at least one other appointment type).
- Preserve the offline-fallback behavior currently in `routes/bookings.js`.
- Remove/disable Zoho Bookings code paths once Cal.com is verified.
- Tests for the new adapter (Jest, middleware suite) + lint.

**Out of scope:**
- Changing the checkout/payment flow (Helcim stays as-is; booking remains a step in the existing flow).
- Migrating historical Zoho Bookings data programmatically (handled manually — see decisions).
- Replacing the broken SMTP layer (separate concern; Cal.com sends its own booking emails over HTTPS, which sidesteps it for booking confirmations).
</domain>

<decisions>
## Implementation Decisions

### Provider & Hosting
- **Cal.com Cloud, free tier** (NOT self-hosted). Rationale: zero infra to manage, free, and the free plan includes API + webhooks + unlimited bookings/event types. Self-hosting (Railway/Fly) was rejected for this phase due to cost + maintenance of a heavy Next.js+Postgres app. Revisit self-host only if free-tier API rate limits become a problem.
- Cal.com credentials (API key, event-type IDs, webhook signing secret) live in **Railway env vars** for the middleware, mirroring the existing `ZOHO_BOOKINGS_*` pattern. New vars likely: `CALCOM_API_KEY`, `CALCOM_EVENT_TYPE_FERMENT` (+ one per additional type), `CALCOM_WEBHOOK_SECRET`. Add them to `lib/validateEnv.js` OPTIONAL list.

### Contract preservation (critical)
- The frontend MUST NOT change. The middleware `/api/bookings*` endpoints keep identical request/response shapes. The Cal.com calls are an internal implementation detail behind an adapter (suggest `lib/calcom.js` mirroring `lib/zoho-api.js` bookings helpers).
- `POST /api/bookings` still accepts `{ customer: { name, email, phone }, date, time, notes }` and returns `{ ok, booking_id, timeslot }`. Map `customer.email` into the Cal.com attendee so Cal.com sends the confirmation.

### Appointment types
- Set up **multiple Cal.com event types in this phase**: the ferment-in-store slot (parity with today) PLUS at least one additional type (e.g. consultation / tasting / equipment pickup — exact list to confirm during planning). `GET /api/bookings/services` should return these event types in the same shape the frontend expects from the old Zoho "services" response.

### Data migration / cutover
- **Manual re-entry.** Existing upcoming Zoho Bookings appointments (e.g. Anne MacDougall, June 4 1:00 PM) are few — re-create them by hand in Cal.com at cutover. No migration script.
- Cutover is a clean switch (not dual-run): once Cal.com is verified on staging, production points at Cal.com and Zoho Bookings is disabled.

### Emails
- Customer booking confirmation now comes from **Cal.com** (sent from Cal.com's servers over HTTPS) — this is desirable because Railway blocks outbound SMTP (see [[online-order-email-flow]]). Staff notification of new appointments should also be handled via Cal.com's notifications where possible, rather than the broken middleware SMTP path.

### Webhooks
- Wire Cal.com **HMAC-signed webhooks** (booking created / cancelled / rescheduled) to a new middleware endpoint (suggest `POST /api/webhooks/calcom`, signature-verified, exempt from the API-key guard like the existing terminal webhook). Use them to keep any local state / staff notifications in sync. Scope of webhook side-effects to be set by the planner (at minimum: verify signature + log; ideally cancellation handling).

### Removal of Zoho Bookings
- After verification, remove or disable: `bookingsGet`/`bookingsPost` usage in `routes/bookings.js`, the `ZOHO_BOOKINGS_SERVICE_ID`/`ZOHO_BOOKINGS_STAFF_ID` env references, and any now-dead helpers. No dead references left behind.

### Claude's Discretion
- Exact module layout for the Cal.com adapter (e.g. `lib/calcom.js` + thin `routes/bookings.js`).
- Cal.com API v2 endpoint/version specifics (researcher to confirm: auth header, event-types list, available-slots/availability, create-booking payload, webhook signature scheme).
- How `GET /api/bookings/availability` (month view) and `/slots` (day view) map onto Cal.com's slots API.
- Caching strategy for availability/slots (mirror existing cache TTLs/keys where sensible).
- Test doubles for Cal.com (follow existing `__tests__` patterns: mock `https`/the adapter).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing booking implementation (the contract to preserve)
- `zoho-middleware/routes/bookings.js` — current endpoints, request validation, offline-fallback, response shapes to replicate
- `zoho-middleware/lib/zoho-api.js` — `bookingsGet`/`bookingsPost` helpers being replaced (pattern reference for the new `lib/calcom.js`)
- `zoho-middleware/routes/checkout.js` — how `appointment_id`/`timeslot` are consumed downstream (booking is created before checkout)
- `zoho-middleware/routes/webhooks.js` — existing HMAC-verified webhook pattern (terminal webhook) to mirror for Cal.com webhooks

### Conventions / infra
- `zoho-middleware/lib/validateEnv.js` — where new `CALCOM_*` env vars register (OPTIONAL list)
- `zoho-middleware/lib/checkMailer.js` + [[online-order-email-flow]] — why email moved off SMTP (context for relying on Cal.com email)
- `zoho-middleware/__tests__/bookings.test.js` — existing test patterns for the booking routes
- Project `CLAUDE.md` — non-negotiable rules (regression test first, run both suites + lint before commit, staging-first deploy)

### External
- Cal.com API v2 docs + webhooks docs (researcher to pull exact endpoints/auth/signing)
</canonical_refs>

<specifics>
## Specific Ideas

- Adapter shape suggestion: `lib/calcom.js` exporting `listEventTypes()`, `getAvailability(month)`, `getSlots(date)`, `createBooking({name,email,phone,date,time,notes,eventType})`, `verifyWebhook(rawBody, signature)`.
- Keep `routes/bookings.js` thin — same validation + offline fallback, delegating to `lib/calcom.js`.
- Verify end-to-end on staging with a real test booking → confirm the Cal.com email actually arrives (this is the acceptance proof that closes the original "customer didn't get a confirmation" thread).
</specifics>

<deferred>
## Deferred Ideas

- Self-hosting Cal.com (only if free-tier rate limits bite).
- Programmatic migration of historical Zoho Bookings data.
- Replacing/repairing the middleware SMTP layer for non-booking staff alerts (tracked separately).
- Deep webhook side effects beyond signature-verify + cancellation handling (e.g. syncing reschedules into any local store) if not needed for parity.
</deferred>

## Requirement crosswalk (ROADMAP BOOK ↔ RESEARCH BK)

RESEARCH.md uses its own BK-01..09 labels (no formal REQ-IDs existed at research time). Mapping, to keep plan `requirements:` fields honest:

- **BOOK-01** Contract/adapter + Cal.com auth ↔ BK-01 (Plans 01, 02)
- **BOOK-02** End-to-end booking + customer confirmation email on staging ↔ BK-02 (services), BK-05/07 (POST booking + email) (Plans 02, 03, 04)
- **BOOK-03** ≥1 additional event type + availability ↔ BK-03 (Plans 02, 04)
- **BOOK-04** `GET /api/bookings/slots` day-view ↔ BK-04 (Plan 02 builds it; Plan 04 re-verifies on staging)
- **BOOK-05** Webhook + adapter/route tests + lint ↔ BK-06 (webhook), BK-09 (tests) (Plans 01, 02, 03, 04)

---

*Phase: 25-calcom-booking-migration*
*Context gathered: 2026-06-03 via interactive discussion*
