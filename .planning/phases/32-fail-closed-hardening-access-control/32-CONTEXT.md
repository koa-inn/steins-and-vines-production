# Phase 32: Fail-Closed Hardening & Access Control - Context

**Gathered:** 2026-06-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Close every fail-OPEN security gap on the money path so it fails CLOSED. Six requirements (HARDEN-01..04, PII-01..02), all middleware-level:

**In scope:**
- **HARDEN-01** — `POST /api/checkout` reCAPTCHA fails closed in production: unset `RECAPTCHA_SECRET_KEY`, missing token, OR network error/timeout → reject (4xx) before the charge step. (Today `verifyRecaptcha()` returns `{success:true}` when key unset *and* on timeout — both must flip in prod.)
- **HARDEN-02** — Helcim and Cal.com webhooks reject events when their signing secret is unset in production (400/403). (Today both `verifyWebhookSignature()`/`verifyWebhook()` return `true` when the secret is unset.)
- **HARDEN-03** — The `transactionId` replay/idempotency guard returns **409** when Redis is unavailable, instead of calling `runCheckout()` in the catch (the current fail-open at `routes/checkout.js:219`).
- **HARDEN-04** — `validateEnv.js` validates live Helcim/Cal.com/`REDIS_ENCRYPTION_KEY` vars and drops dead Global Payments vars; also enforces the prod-secret + NODE_ENV boot checks (see D-02, D-06).
- **PII-01** — The 4 named PII GET routes (`/api/contacts`, `/api/invoices`, `/api/items/inspect`, `/api/snapshot`) require the API key, regardless of Referer.
- **PII-02** — Mutating routes (`POST/PUT /api/items`, `POST /api/taxes/apply`, `upload-catalog`) validate request body shape via a shared whitelist helper before forwarding to Zoho (today `items.js:33` forwards raw `req.body`).

**Out of scope (deferred):**
- Decomposing `processCheckout()` (still deferred from Phase 31).
- A real staging-middleware environment / sandbox Zoho+Helcim — Phase 33 territory (see Deferred).
- CI test-gating of deploys, deploy tagging, uptime monitoring — Phase 33 (DEPLOY/MONITOR).
- reCAPTCHA **score-threshold** rejection — NOT in scope; criteria cover unset-key / missing-token / network-error only. Do not add new score gates (avoids rejecting legit low-score customers).
</domain>

<decisions>
## Implementation Decisions

All decisions below are LOCKED.

### Production detection (cross-cutting — drives HARDEN-01, HARDEN-02)
- **D-01:** Production is detected via `process.env.NODE_ENV === 'production'`. The fail-closed branches activate only when this is true; dev/CI/laptop (NODE_ENV unset) stays fail-open for convenience. Pattern: `var isProd = process.env.NODE_ENV === 'production'; if (!secret) return isProd ? reject : allow;`
- **D-02:** **Guarantee the gate can't be silently off** ("pin it + assert at boot"):
  - **Human action (Railway):** explicitly set `NODE_ENV=production` on the single middleware service (do NOT rely on the Nixpacks default). Track alongside #96/#106.
  - **Code:** `validateEnv.js` startup check refuses to boot (`process.exit(1)`) if the deploy *looks like* production but `NODE_ENV !== 'production'`. The "looks like prod" signal MUST be independent of NODE_ENV (else circular) — use a Railway-injected platform var (e.g. `RAILWAY_ENVIRONMENT` / `RAILWAY_PROJECT_ID`); researcher to confirm which var is reliably present. This converts a silent fail-open into a loud boot failure.
- **Context:** There is exactly ONE middleware instance (`svmiddleware-production.up.railway.app`) shared by both the staging and production GitHub Pages frontends — there is no separate staging middleware. So `NODE_ENV=production` on that one service is unambiguous; the only non-prod runtime is a dev laptop / CI.

### reCAPTCHA fail-closed (HARDEN-01)
- **D-03:** In prod, flip BOTH fail-open paths in `lib/checkout-helpers.js#verifyRecaptcha`: (a) unset `RECAPTCHA_SECRET_KEY` (line ~47, currently `{success:true}`) and (b) the 5s timeout/network-error catch (line ~77, currently returns `{success:true}`) → reject. Dev keeps the graceful fallback. Rejection happens before the charge step in `routes/checkout.js` (returns 4xx, request never reaches charge).

### Webhook fail-closed (HARDEN-02)
- **D-04:** In prod, when the signing secret is unset, return false (→ route returns 400/403). Applies to BOTH `lib/helcim.js#verifyWebhookSignature` (line ~311) and `lib/calcom.js#verifyWebhook` (line ~141). Dev keeps the "skip verification" warning path.

### Replay-guard fail-closed (HARDEN-03)
- **D-05:** In `checkTransactionIdAndProceed()` (`routes/checkout.js:205`), the Redis-down `catch` must return **409** (`{ error: 'Payment already processed' }` or similar) instead of `runCheckout()`. The guard fails closed so a Redis outage cannot let a duplicate `transactionId` create a second Zoho order. (Note: the idempotency-key lock path at ~219/352 and the promo lock at ~352 also fail open today — scope is the `transactionId` guard per the success criterion; researcher to confirm whether the idempotency-key path needs the same treatment to honor "no duplicate Zoho order".)

### Misconfig handling (HARDEN-04 + startup safety)
- **D-06:** **Both** — startup hard-fail AND runtime reject. `validateEnv.js` refuses to boot in prod if any required prod secret is missing: `RECAPTCHA_SECRET_KEY`, `HELCIM_WEBHOOK_SECRET`, `CALCOM_WEBHOOK_SECRET`, `REDIS_ENCRYPTION_KEY`. This means a missing secret breaks the *deploy loudly* rather than silently rejecting every customer at runtime — while the runtime gates (D-03/D-04/D-05) still fail closed as defense in depth. Also remove dead Global Payments vars from validateEnv.

### PII GET-route auth (PII-01)
- **D-07:** **Targeted guard on the 4 named routes only** — `/api/contacts`, `/api/invoices`, `/api/items/inspect`, `/api/snapshot` require the API key (401/403 without it, regardless of Referer). Do NOT invert the global GET bypass. Rationale: there are 34 GET `/api/*` routes; ~12+ are legitimately called by the public storefront/booking/kiosk pages with no API key (`/api/products`, `/api/ingredients`, `/api/services`, `/api/recipes*`, `/api/bookings/*`, `/api/payment/config`, etc.). Inverting the default = high blast radius (any missed allowlist entry 401s in prod). The targeted guard literally satisfies the success criterion with near-zero blast radius. The current global `if (req.method === 'GET') return next()` (`server.js:254`) stays for all other GET routes.

### Body-shape validation (PII-02)
- **D-08:** **Strict whitelist via a shared helper** (e.g. `zoho-middleware/lib/validate.js`). Each mutating route declares an allowed-field schema; required fields are checked for presence/type and the request is rejected 400 *before* any Zoho call; unknown/extra fields are stripped so Zoho only ever receives vetted fields (no field smuggling). Applies to `POST/PUT /api/items`, `POST /api/taxes/apply`, `upload-catalog`. Helper must be ES5/vanilla (no new runtime deps) to match codebase ethos. Researcher/planner to define the exact allowed-field set per route from current Zoho payloads.

### Claude's Discretion
- Exact shape of the `lib/validate.js` helper API and per-route allowed-field lists (derive from existing Zoho payload usage).
- Exact error response bodies/messages (status codes are fixed by the success criteria: 4xx recaptcha, 400/403 webhook, 409 replay, 401/403 PII, 400 body-shape).
- Which Railway platform var to key the "looks like prod" boot assertion on (confirm `RAILWAY_ENVIRONMENT` vs `RAILWAY_PROJECT_ID` presence).
- Test file organization for the new fail-closed tests (the Phase 31 `test.todo`/`skip` markers become real assertions — set `NODE_ENV=production` in those tests to exercise the prod gate).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` §"Phase 32: Fail-Closed Hardening & Access Control" — goal + 5 success criteria (the literal acceptance gates: status codes & routes are non-negotiable).
- `.planning/REQUIREMENTS.md` — HARDEN-01..04, PII-01..02 wording.
- `.planning/phases/31-money-path-test-coverage/31-CONTEXT.md` — Phase 31 built the safety net these changes land on; the `test.todo`/`skip` markers it left (unauthenticated checkout, unsigned webhook accepted, duplicate charge when Redis down) become this phase's real assertions.

### Code to change
- `zoho-middleware/lib/checkout-helpers.js` — `verifyRecaptcha()` (~line 47 unset-key fail-open, ~line 77 timeout fail-open) → HARDEN-01.
- `zoho-middleware/routes/checkout.js` — reCAPTCHA gate (~line 120), `checkTransactionIdAndProceed()` (line 205, Redis-down fail-open at line 219), idempotency-key/lock path (~219/352) → HARDEN-01/HARDEN-03.
- `zoho-middleware/lib/helcim.js:311` — `verifyWebhookSignature()` unset-secret fail-open → HARDEN-02.
- `zoho-middleware/lib/calcom.js:141` — `verifyWebhook()` unset-secret fail-open → HARDEN-02.
- `zoho-middleware/routes/webhooks.js:38,224` — webhook routes that consume the verify result → HARDEN-02.
- `zoho-middleware/lib/validateEnv.js` — required-prod-secret + NODE_ENV boot checks; drop Global Payments vars → HARDEN-04 + D-02/D-06.
- `zoho-middleware/server.js:253-273` — global API-key middleware (`if GET return next()` at :254) and `requireAllowedReferer` (:72,:384); add targeted guard on the 4 PII routes → PII-01.
- `zoho-middleware/routes/items.js:32-33` (`POST /api/items` forwards raw `req.body`), `routes/items.js` PUT, `routes/taxes.js:314` (`/api/taxes/apply`), `upload-catalog` route → PII-02.
- `zoho-middleware/lib/validate.js` — NEW shared body-shape whitelist helper (D-08).

### Test infrastructure (safety net — must stay green)
- `zoho-middleware/__tests__/checkout.test.js` + the Phase 31 supertest route tests — the real-app/supertest harness exercises the middleware these changes live in.
- `zoho-middleware/__tests__/calcom-webhook.test.js` — HMAC webhook test analog.
- `zoho-middleware/jest.config.js` — money-path per-file coverage floors (checkout/payments/webhooks/helcim) set in Phase 31; must not regress.
- `CLAUDE.md` (repo root) — non-negotiable rules: regression test FIRST when changing behavior; run both `npm test` and `cd zoho-middleware && npm test` before commit.

### Deploy reality
- Single middleware service `svmiddleware-production.up.railway.app` (`js/sheets-config.js:60`) serves BOTH frontends — no staging middleware. Middleware changes go LIVE on `railway up`; the Phase 31 test suite is the stand-in for a soak environment.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `process.env.NODE_ENV` prod-gate pattern (D-01) — new, but reused identically across recaptcha + both webhook verifiers.
- `lib/validateEnv.js` + `lib/checkRedis.js` — existing startup-check infrastructure (4 required / 40+ optional vars); extend rather than re-invent.
- `crypto.timingSafeEqual` + base64 HMAC pattern already in `lib/helcim.js` and `lib/calcom.js` — unchanged; only the unset-secret branch flips.
- `consignment.js:25-26` shows an existing per-route `x-api-key` check pattern that can model the targeted PII guard.

### Established Patterns
- ES5 (`var`, `function`), Jest node env, tests in `zoho-middleware/__tests__/**`. New `lib/validate.js` must follow suit (no schema-lib deps).
- API-key middleware currently exempts ALL GET (`server.js:254`) — PII-01 adds a narrow override, not a rewrite.

### Integration Points
- The prod gate (D-01) is read inside lib functions (`verifyRecaptcha`, `verifyWebhookSignature`, `verifyWebhook`) and at boot (`validateEnv.js`) — tests must set `NODE_ENV=production` to exercise the closed path.
- Targeted PII guard mounts before the route modules in `server.js`, after `requireAllowedReferer`.
</code_context>

<specifics>
## Specific Ideas

- Status codes are HARD requirements from the success criteria — 4xx (recaptcha), 400/403 (webhook), 409 (replay), 401/403 (PII GET), 400 (body-shape). Do not deviate.
- "Fail closed" must be genuine: reject BEFORE the charge / BEFORE forwarding to Zoho, not after.
- Defense in depth: keep BOTH the loud-at-boot check (D-06) and the runtime rejects (D-03/04/05) — neither replaces the other.
</specifics>

<deferred>
## Deferred Ideas

- **Real staging middleware (+ sandbox Zoho/Helcim)** — Phase 33. A second Railway service/environment so middleware hardening can be soak-tested before hitting real customers. Cost is modest (usage-based, ~a few $/mo idle) but the real work is sandbox Zoho/Helcim credentials and repointing the staging frontend's `MIDDLEWARE_URL`; the automated "promote tested build to prod" flow IS DEPLOY-01. Captured per user curiosity during discussion; not Phase 32.
- **reCAPTCHA score-threshold gating** — explicitly out of scope (would risk rejecting legitimate low-score customers); only success/unset/network-error handling is in scope.

</deferred>

---

*Phase: 32-fail-closed-hardening-access-control*
*Context gathered: 2026-06-17*
