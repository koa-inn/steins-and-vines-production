---
phase: 32-fail-closed-hardening-access-control
verified: 2026-06-17T00:00:00Z
status: human_needed
score: 5/5
overrides_applied: 0
human_verification:
  - test: "Confirm Railway dashboard: NODE_ENV=production explicitly set on svmiddleware-production service"
    expected: "NODE_ENV=production visible in Railway Variables tab for the middleware service"
    why_human: "Railway dashboard env var configuration cannot be verified programmatically from the repository; this is a live-service config step (Plan 32-03 Task 3 is a checkpoint:human-action gate)"
  - test: "Confirm Railway dashboard: RAILWAY_ENVIRONMENT is injected (present) on the middleware service"
    expected: "RAILWAY_ENVIRONMENT variable visible in Railway Variables or confirmed auto-injected"
    why_human: "Platform-injected var — must be confirmed on the live service, not in code"
  - test: "Confirm Railway dashboard: all four prod secrets are set — RECAPTCHA_SECRET_KEY, HELCIM_WEBHOOK_SECRET, CALCOM_WEBHOOK_SECRET, REDIS_ENCRYPTION_KEY"
    expected: "All four appear in Railway Variables for svmiddleware-production with non-empty values"
    why_human: "Env var presence on the live service cannot be tested from the repo. Without these set, the validateEnv.js D-06 boot gate will hard-fail on next deploy (intended behavior, but must be armed before deploying)"
---

# Phase 32: Fail-Closed Hardening & Access Control Verification Report

**Phase Goal:** Every security gap on the money path that currently fails open now fails closed — unauthenticated checkout attempts, unsigned webhook events, duplicate charges when Redis is down, and PII exposure via unauthenticated GET routes are all rejected.

**Verified:** 2026-06-17T00:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | POST /api/checkout in production without a valid reCAPTCHA token (or RECAPTCHA_SECRET_KEY unset) returns 4xx before the charge step (HARDEN-01) | VERIFIED | `checkout-helpers.js:48-53`: `isProd` gate — unset key returns `{success:false,score:0}` in prod, fail-open in dev. `checkout.js:154-185`: `captcha.success` check at line 156 returns 400 before `proceed()`; route-level catch (line 177-184) also returns 400 in prod. No call to `processCheckout()` before these guards. All 16 checkout-route tests pass including HARDEN-01 prod assertions. |
| 2 | A Helcim or Cal.com webhook event when the corresponding signing secret env var is absent in production returns 400/403 — no event accepted or processed (HARDEN-02) | VERIFIED | `helcim.js:311-313`: `if (!secret) { var isProd = ...; if (isProd) return false; }`. `calcom.js:141-143`: identical pattern. `webhooks.js:38-41` and `:224-226`: both consume sites return `res.status(403)` on `false` return. All HARDEN-02 `test.todo` markers converted to real assertions; 7 test suites pass. |
| 3 | A second POST /api/checkout with the same transactionId when Redis is unavailable returns 409 — no duplicate Zoho order (HARDEN-03) | VERIFIED | `checkout.js:225-236`: `checkTransactionIdAndProceed` Redis-down `catch(e)` returns `res.status(409)` unconditionally (no `runCheckout()` in that catch). `checkout.js:138-148`: idempotency-key Redis-down catch returns 409 when `isProdIdem`, fail-open in dev. HARDEN-03 test.todo converted to real assertion; checkout-route.test.js: 16 tests pass. |
| 4 | GET /api/contacts, /api/invoices, /api/items/inspect, /api/snapshot require the MW_API_KEY header — request without it returns 401/403 regardless of Referer (PII-01) | VERIFIED | `server.js:410-417`: `PII_GET_ROUTES` exact-match list; `requirePiiApiKey` returns 403 without valid `x-api-key`. Mounted after `requireAllowedReferer` (line 384) and before route modules (line 423). `pii-access.test.js`: 29 tests covering all 4 routes + Referer-bypass test + public route check. |
| 5 | POST /api/items, PUT /api/items, POST /api/taxes/apply, POST /api/upload-catalog reject missing/malformed required body fields before forwarding to Zoho (PII-02) | VERIFIED | `validate.js:95-137`: `validateBody()` exported alongside existing `validateLineItems`/`classifyZohoError`. `items.js:66-80`: POST uses `ITEM_CREATE_SCHEMA` (required: `name`); forwards `result.clean` not `req.body`. `items.js:132-143`: PUT uses `ITEM_UPDATE_SCHEMA` (no required — partial update); forwards `result.clean`. `taxes.js:315-323`: rejects non-object body before reading `body.apply`. `catalog.js:993-999`: existing array+non-empty validation confirmed. All 80 scoped tests pass. |

**Score:** 5/5 truths verified

### HARDEN-04 Verification (Boot Gate)

| Check | Status | Evidence |
|-------|--------|----------|
| validateEnv hard-fails on missing RECAPTCHA_SECRET_KEY/HELCIM_WEBHOOK_SECRET/CALCOM_WEBHOOK_SECRET/REDIS_ENCRYPTION_KEY in prod | VERIFIED | `validateEnv.js:13-17`: `REQUIRED_IN_PROD` array; lines 105-116: gated on `isProd`, calls `process.exit(1)` on any missing secret. 22 tests in `validateEnv.test.js` all pass. |
| Asserts NODE_ENV=production when RAILWAY_ENVIRONMENT is set | VERIFIED | `validateEnv.js:77-81`: D-02 assertion before REQUIRED check. `if (process.env.RAILWAY_ENVIRONMENT && process.env.NODE_ENV !== 'production') ... process.exit(1)`. |
| Dead GP_* vars removed | VERIFIED | `grep -n "GP_" validateEnv.js` returns zero results. All six GP vars (GP_ENVIRONMENT, GP_APP_ID, GP_APP_KEY, GP_MERCHANT_ID, GP_TERMINAL_ENABLED, GP_DEPOSIT_AMOUNT) are absent. |
| Live Helcim and REDIS_ENCRYPTION_KEY present | VERIFIED | `validateEnv.js:14-17` (REQUIRED_IN_PROD) and lines 35-37 (OPTIONAL): both HELCIM_WEBHOOK_SECRET and REDIS_ENCRYPTION_KEY present in both arrays. |
| Railway env config (NODE_ENV + 4 prod secrets) | HUMAN NEEDED | Code is correct; Railway dashboard must be configured by a human before deploying (Plan 32-03 Task 3). |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `zoho-middleware/lib/checkout-helpers.js` | isProd-gated verifyRecaptcha | VERIFIED | Contains `process.env.NODE_ENV === 'production'`; both unset-key and timeout branches return `{success:false,score:0}` in prod |
| `zoho-middleware/routes/checkout.js` | 409 on Redis-down (txnId + idem key) | VERIFIED | `checkTransactionIdAndProceed` catch returns 409 unconditionally; `proceed()` idem-key catch returns 409 when `isProdIdem` |
| `zoho-middleware/lib/helcim.js` | isProd-gated verifyWebhookSignature | VERIFIED | Contains `process.env.NODE_ENV === 'production'` in unset-secret branch; returns false in prod |
| `zoho-middleware/lib/calcom.js` | isProd-gated verifyWebhook | VERIFIED | Contains `process.env.NODE_ENV === 'production'` in unset-secret branch; returns false in prod |
| `zoho-middleware/routes/webhooks.js` | 403 on invalid/unsigned events | VERIFIED | Both consume sites return `res.status(403)` (changed from 401) |
| `zoho-middleware/lib/validateEnv.js` | REQUIRED_IN_PROD + D-02 + no GP_* | VERIFIED | REQUIRED_IN_PROD array with 4 secrets; D-02 boot assertion; zero GP_ references |
| `zoho-middleware/server.js` | requirePiiApiKey on 4 PII GET paths | VERIFIED | PII_GET_ROUTES exact-match list; guard mounted at line 417 (after requireAllowedReferer:384, before route modules:423) |
| `zoho-middleware/lib/validate.js` | validateBody exported alongside existing exports | VERIFIED | `module.exports` contains `validateLineItems`, `classifyZohoError`, and `validateBody` |
| `zoho-middleware/routes/items.js` | POST/PUT call validateBody before Zoho | VERIFIED | POST uses ITEM_CREATE_SCHEMA (required:name); PUT uses ITEM_UPDATE_SCHEMA (no required); both forward `result.clean` |
| `zoho-middleware/routes/taxes.js` | POST /api/taxes/apply rejects non-object body | VERIFIED | Line 319: `validateBody` with `allowed:['apply']` before reading `body.apply` |
| `zoho-middleware/__tests__/checkout-route.test.js` | No test.todo for HARDEN-01/03 | VERIFIED | Zero `test.todo` markers remain; 16 tests pass |
| `zoho-middleware/__tests__/helcim-webhook.test.js` | HARDEN-02 real assertions | VERIFIED | Real test at lines 106 and 291; no test.todo remaining |
| `zoho-middleware/__tests__/calcom.test.js` | HARDEN-02 prod-gate assertion | VERIFIED | Real test at line 211 |
| `zoho-middleware/__tests__/calcom-webhook.test.js` | 403 assertions | VERIFIED | 403 assertions at lines 114, 149, 166 |
| `zoho-middleware/__tests__/validateEnv.test.js` | 22 tests covering D-02/D-06 | VERIFIED | File exists; 22 tests pass in scoped run |
| `zoho-middleware/__tests__/pii-access.test.js` | 29 tests for PII-01/02 | VERIFIED | File exists; 29 tests pass |
| `zoho-middleware/__tests__/validate.test.js` | validateBody tests appended | VERIFIED | Existing assertions intact; new validateBody tests added (45 new); 80 total pass |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `routes/checkout.js` reCAPTCHA gate | `lib/checkout-helpers.js#verifyRecaptcha` | `await verifyRecaptcha(rcToken)` -> `{success:false}` triggers `res.status(400)` before `proceed()` | WIRED | Lines 155-185 of checkout.js; verifyRecaptcha at checkout-helpers.js:47 |
| `routes/checkout.js#checkTransactionIdAndProceed catch` | `res.status(409)` | Redis-down catch returns 409 instead of `runCheckout()` | WIRED | `checkout.js:232-235` |
| `routes/checkout.js#proceed idempotency-key catch` | `res.status(409)` (prod only) | `isProdIdem` gate; returns 409 in prod, `processCheckout()` in dev | WIRED | `checkout.js:141-147` |
| `routes/webhooks.js (helcim)` | `lib/helcim.js#verifyWebhookSignature` | false return -> `res.status(403)` | WIRED | `webhooks.js:38-41` |
| `routes/webhooks.js (calcom)` | `lib/calcom.js#verifyWebhook` | false return -> `res.status(403)` | WIRED | `webhooks.js:224-226` |
| `server.js requirePiiApiKey` | 4 PII GET routes | `app.get(p, requirePiiApiKey)` mounted before route modules | WIRED | `server.js:417`; route modules at line 423 |
| `routes/items.js POST /api/items` | `lib/validate.js#validateBody` | `validateBody(req.body, ITEM_CREATE_SCHEMA)` -> 400 on error before `zohoPost` | WIRED | `items.js:67-71` |
| `routes/items.js PUT /api/inventory/items/:id` | `lib/validate.js#validateBody` | `validateBody(req.body, ITEM_UPDATE_SCHEMA)` -> 400 on error before `inventoryPut` | WIRED | `items.js:133-137` |
| `routes/taxes.js POST /api/taxes/apply` | `lib/validate.js#validateBody` | `validateBody(req.body, ...)` -> 400 before reading `body.apply` | WIRED | `taxes.js:319-322` |

### Behavioral Spot-Checks

| Behavior | Verified By | Result |
|----------|-------------|--------|
| Full middleware test suite (771 tests) | `cd zoho-middleware && npm test` | 37 suites, 771 tests — all PASS |
| No test.todo markers in HARDEN-01/03/HARDEN-02 test files | grep on test files | Zero remaining test.todo for any HARDEN requirement |
| No GP_ references in validateEnv.js | grep | Zero results confirmed |
| 403 (not 401) at both webhook reject sites | grep on webhooks.js | Lines 40 and 226 both show `status(403)` |
| validateBody exported alongside existing exports | lib/validate.js:139-143 | All three exports present |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| HARDEN-01 | 32-01 | reCAPTCHA verification fails closed in production | SATISFIED | verifyRecaptcha prod gate + route-level catch both return 400/fail-closed in prod |
| HARDEN-02 | 32-02 | Webhook verifiers reject unsigned events in prod | SATISFIED | helcim.js + calcom.js isProd gates; webhooks.js returns 403 |
| HARDEN-03 | 32-01 | Replay guard returns 409 when Redis unavailable | SATISFIED | checkTransactionIdAndProceed catch + idem-key catch both fail-closed |
| HARDEN-04 | 32-03 | validateEnv validates live secrets; drops GP_* | SATISFIED (code) | validateEnv.js REQUIRED_IN_PROD + D-02 + no GP_* refs; Railway config pending human action |
| PII-01 | 32-04 | 4 PII GET routes require API key | SATISFIED | requirePiiApiKey mounted on exact 4 paths in server.js |
| PII-02 | 32-04 | Mutating item/tax routes validate body before Zoho | SATISFIED | validateBody wired in items.js POST/PUT, taxes.js apply; upload-catalog existing validation confirmed |

### Anti-Patterns Found

None. No TBD/FIXME/XXX markers in any modified file. No stub implementations. No hardcoded empty data in the hardening paths.

### Human Verification Required

#### 1. Railway Dashboard: NODE_ENV=production

**Test:** Open Railway dashboard -> `svmiddleware-production` service -> Variables. Confirm `NODE_ENV` is explicitly set to `production` (do NOT rely on Nixpacks default).

**Expected:** `NODE_ENV=production` visible in the Variables tab.

**Why human:** Railway dashboard env configuration is not inspectable from the repository. The D-02 boot assertion in `validateEnv.js` (line 77) only fires when `RAILWAY_ENVIRONMENT` is set but `NODE_ENV !== 'production'`. If NODE_ENV is missing entirely, the D-02 assertion does NOT fire (RAILWAY_ENVIRONMENT must also be present), and the REQUIRED_IN_PROD check still applies. Setting NODE_ENV=production explicitly is required to arm all fail-closed gates.

#### 2. Railway Dashboard: RAILWAY_ENVIRONMENT Presence

**Test:** Confirm `RAILWAY_ENVIRONMENT` appears in Railway Variables (or is confirmed as auto-injected by the platform).

**Expected:** Variable is present with any non-empty value (Railway injects it automatically into all services).

**Why human:** Platform-injected variable presence must be confirmed on the live service. The D-02 boot assertion keys on this variable's presence.

#### 3. Railway Dashboard: All Four Prod Secrets Set

**Test:** Confirm all four variables are set in Railway Variables for `svmiddleware-production`:
1. `RECAPTCHA_SECRET_KEY`
2. `HELCIM_WEBHOOK_SECRET`
3. `CALCOM_WEBHOOK_SECRET`
4. `REDIS_ENCRYPTION_KEY` (also satisfies long-standing #106)

**Expected:** All four appear in Railway Variables with non-empty values, BEFORE this phase's changes are deployed.

**Why human:** Env var values on the live Railway service cannot be read from the repository. If any is missing when the deploy lands, `validateEnv.js` will call `process.exit(1)` at boot (the intended fail-closed behavior — but the intent is "green and armed," not "boot-broken"). This is the Plan 32-03 Task 3 `checkpoint:human-action` gate.

---

### Gaps Summary

No code gaps. All five success criteria are implemented, wired, and verified by a green test suite (771/771 tests pass). The single pending item is the Railway dashboard configuration — a human-action checkpoint that was explicitly called out in Plan 32-03 as a non-automatable step. The code implementation is complete and tested.

---

_Verified: 2026-06-17T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
