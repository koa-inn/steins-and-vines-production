---
phase: 52-fail-closed-sweep
verified: 2026-07-03T06:09:45Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
---

# Phase 52: Fail-Closed Sweep Verification Report

**Phase Goal:** Every remaining Redis-degradation and auth/validation gap that currently fails open now fails closed — no security or money-path guard silently permits an unsafe operation when Redis or an upstream service is unavailable.
**Verified:** 2026-07-03T06:09:45Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A single shared closed-on-Redis-error helper is applied to the promo FIRSTBATCH check (M1), the rate-limit store's mid-op error path (M4), and its loopback skip (M5) — a test asserts each guard returns closed when its Redis call throws | ✓ VERIFIED | `lib/redis-guard.js` exports `closedOnRedisError(fn, opts)` (discriminated `{status:'value'|'failclosed'}` contract, mirrors `lib/money-path.js`). `routes/checkout.js:369-390` routes both the promo lock (`cache.acquireLock`) and the redemption check (`cache.get`) through `closedOnRedisError({alwaysClosed:true})`, setting `promoDiscount=0` on failclosed. `server.js:415-442` routes the rate-limit store's `incr`/`expire`/`ttl` chain through `closedOnRedisError({alwaysClosed:true})`, falling to `countInProcess(key)` (never `totalHits:0`) on failclosed — `grep -n "totalHits: 0" server.js` returns no code match. `server.js:409` gates the loopback skip behind `process.env.NODE_ENV !== 'production'` (M5). Dedicated tests: `__tests__/redis-guard.test.js` (4 tests), `__tests__/promo-failclosed.test.js` (4 tests), `__tests__/ratelimit-failclosed-52.test.js` (4 tests) — all pass. |
| 2 | The legacy /api/pos/sale route is quarantined or deleted (M2), AND the hardcoded gift-card account_id fallback fails closed rather than silently using a default (M3) | ✓ VERIFIED | `routes/pos.js:1337-1350` — `POST /api/pos/sale` returns `410 Gone` with `{ error: 'Legacy POS sale endpoint retired — use /api/kiosk/sale' }` as the FIRST statement in the handler, before any `helcimLib` call. `grep -rn "pos/sale" js/` returns zero frontend callers (confirmed independently). `routes/pos.js:996-1008` — the gift-card clearing `account_id` pre-flight reads `process.env.ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID` with no `|| '109900...'` fallback; when a redemption is in play (`gcApplied>0 && gcCertNum`) and the env is unset, it voids any terminal charge and returns 503 rather than posting to a guessed ledger. `grep -rn "873231" routes/pos.js` returns nothing (only test fixtures and a stale doc-string in `lib/validateEnv.js` reference the old literal — see Anti-Patterns). Dedicated tests: `__tests__/pos-sale-quarantine.test.js` (4 tests), `__tests__/giftcard-account-failclosed.test.js` — all pass. |
| 3 | The csv_url fetch is restricted to https-only with a host allowlist, closing the SSRF vector (M6) | ✓ VERIFIED | `routes/taxes.js` `validateCsvUrl()` (lines 45-72): mandatory `CSV_MIGRATE_ALLOWED_HOSTS` allowlist (400 when unset, no fetch — fail closed by default, not opt-in), `new URL()` parse in try/catch, https-only enforcement, private/link-local/metadata-IP block (`isPrivateHost`), exact-host allowlist membership — all executed before `axios.get(csvUrl, ...)` at line 717. `zoho-middleware/.env.example:55-60` documents `CSV_MIGRATE_ALLOWED_HOSTS` and the fail-closed-until-set behavior. Test: `__tests__/taxes-ssrf.test.js` — passes. |
| 4 | The unauthenticated Apps-Script-backed GET routes are auth-guarded and cached (M7, M8) — an unauthenticated ?bust=1 request requires the key | ✓ VERIFIED | `routes/catalog.js:808-809` — `?bust=1` branch on `GET /api/kiosk/products` wrapped in `authTiers.requireTiers(['legacy','session'])`; the normal cached read stays public (verified: bust branch only). `routes/recipes.js:314` — `GET /api/recipes/:id/availability` wrapped in `authTiers.requireTiers(['legacy','device','session'])` + read-through cache (`cache.get`/`cache.set` around the Apps-Script call, `RECIPES_CACHE_TTL`). `routes/gift-cards.js:51,86` — both `next-number` (auth + 30s cache) and `lookup` (auth-only, deliberately uncached per documented stale-balance rationale, T-52-M8b) wrapped in the same `requireTiers`. Tests: `__tests__/catalog-bust-auth.test.js`, `__tests__/appsscript-proxy-auth-cache.test.js` — all pass. |
| 5 | Numeric :id path parameters are validated, closing the %2F path-pivot vector (M20) | ✓ VERIFIED | `routes/items.js:52-54` — local `isValidId(id){ return /^\d+$/.test(String(id)); }`, guarding `GET /api/inventory/items/:id` (line 126) and `GET /api/items/:item_id/image` (line 163) before any Zoho path concatenation — matches the audit's exact cited lines (items.js:117,151 in CONTEXT.md). Test: `__tests__/items-id-validation.test.js` — passes. See Anti-Patterns for a documented, in-scope residual note on the PUT handler on the same route. |
| 6 | A regression test asserts the promo is not repeatable during a simulated Redis outage | ✓ VERIFIED | `__tests__/promo-failclosed.test.js` "promo is NOT repeatable across two outage-time requests" — two sequential `POST /api/checkout` calls with `cache.acquireLock`/`cache.get` throwing (simulated outage); both assert `feeLine.rate === 45` (full rate, no $20-equivalent discount either time). Passes. |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `zoho-middleware/lib/redis-guard.js` | `closedOnRedisError(fn, opts)` discriminated-result helper | ✓ VERIFIED | Exists, exports function, 100% test coverage per 52-01 SUMMARY |
| `zoho-middleware/__tests__/redis-guard.test.js` | Unit test proving failclosed on throw | ✓ VERIFIED | 4 tests, all pass |
| `zoho-middleware/routes/checkout.js` | Promo routed through closedOnRedisError | ✓ VERIFIED | `require('../lib/redis-guard')`, both lock + redemption check wrapped |
| `zoho-middleware/server.js` | Rate-limit mid-op error falls to memStore; loopback gated | ✓ VERIFIED | `countInProcess`, `closedOnRedisError`, prod-gated loopback all present |
| `zoho-middleware/__tests__/promo-failclosed.test.js` | Regression: promo not repeatable during outage | ✓ VERIFIED | Contains `FIRSTBATCH`, asserts non-repeatability |
| `zoho-middleware/__tests__/ratelimit-failclosed-52.test.js` | Rate-limit fails closed, not totalHits:0 | ✓ VERIFIED | 4 tests, M4 + M5 both covered |
| `zoho-middleware/routes/pos.js` | Quarantined /api/pos/sale + env-required gift-card account | ✓ VERIFIED | 410 at line 1350; env check at 996-999 |
| `zoho-middleware/__tests__/pos-sale-quarantine.test.js` | Asserts 410, no terminal call | ✓ VERIFIED | 4 tests, all pass |
| `zoho-middleware/__tests__/giftcard-account-failclosed.test.js` | Asserts fail-closed on unset env | ✓ VERIFIED | Passes |
| `zoho-middleware/routes/items.js` | isValidId guard on both :id handlers | ✓ VERIFIED | Present on both GET handlers |
| `zoho-middleware/routes/taxes.js` | Mandatory host allowlist + https-only + private-range block | ✓ VERIFIED | `validateCsvUrl` fully implements the 5-step contract |
| `zoho-middleware/.env.example` | CSV_MIGRATE_ALLOWED_HOSTS documented | ✓ VERIFIED | Lines 55-60 |
| `zoho-middleware/__tests__/items-id-validation.test.js` | Asserts %2F / non-numeric → 400 | ✓ VERIFIED | Passes |
| `zoho-middleware/__tests__/taxes-ssrf.test.js` | Asserts SSRF vectors → 400, no fetch | ✓ VERIFIED | Passes |
| `zoho-middleware/routes/catalog.js` | bust=1 gated behind requireTiers | ✓ VERIFIED | Line 808-809 |
| `zoho-middleware/routes/recipes.js` | availability route auth-guarded + cached | ✓ VERIFIED | Line 314, cache.get/set present |
| `zoho-middleware/routes/gift-cards.js` | next-number/lookup auth-guarded | ✓ VERIFIED | Lines 51, 86 |
| `zoho-middleware/__tests__/catalog-bust-auth.test.js` | Asserts ?bust=1 unauth → 401/403 | ✓ VERIFIED | Passes |
| `zoho-middleware/__tests__/appsscript-proxy-auth-cache.test.js` | Asserts proxies require auth + cache | ✓ VERIFIED | Passes |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| checkout.js | lib/redis-guard.js | `require` + `closedOnRedisError` around promo lock/redemption | ✓ WIRED | Confirmed at lines 13, 369, 378 |
| server.js | in-process memStore fallback | mid-op catch routes to `countInProcess` | ✓ WIRED | Confirmed at lines 415-442 |
| pos.js | `process.env.ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID` | env-required pre-flight, no hardcoded fallback | ✓ WIRED | Confirmed at lines 996-1008; `grep "873231" routes/pos.js` empty |
| items.js | `req.params.id` / `req.params.item_id` | `isValidId` guard before `inventoryGet`/`axios.get` | ✓ WIRED | Confirmed at lines 126, 163 |
| taxes.js | `new URL(csv_url)` | mandatory allowlist + scheme + host + private-range validation | ✓ WIRED | Confirmed at lines 45-72, 709-717 |
| catalog.js | `lib/authTiers.requireTiers` | inline guard on bust branch only | ✓ WIRED | Confirmed at line 808-809 |
| recipes.js | `lib/cache` get/set | read-through cache around Apps-Script call | ✓ WIRED | Confirmed at lines 318-381 |

### Behavioral Spot-Checks (Automated Test Execution)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full middleware suite green | `cd zoho-middleware && npm test` | 71 suites / 1233 tests passed | ✓ PASS |
| Full frontend suite green | `npm test` | 53 suites / 947 tests passed | ✓ PASS |
| Middleware lint clean | `cd zoho-middleware && npm run lint` | 0 errors, 61 pre-existing warnings (no new) | ✓ PASS |
| All 9 phase-52 new test suites | `npx jest __tests__/{redis-guard,promo-failclosed,ratelimit-failclosed-52,pos-sale-quarantine,giftcard-account-failclosed,items-id-validation,taxes-ssrf,catalog-bust-auth,appsscript-proxy-auth-cache}.test.js` | 9 suites / 43 tests passed | ✓ PASS |
| Legacy /api/pos/sale callers | `grep -rn "pos/sale" js/` | zero matches | ✓ PASS |
| No `totalHits: 0` in server.js increment path | `grep -n "totalHits: 0" server.js` | no code match (only appears in a comment) | ✓ PASS |
| No hardcoded gift-card account fallback | `grep -n "873231" routes/pos.js` | no match | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| RESIL-01 | 52-01, 52-02, 52-03, 52-04, 52-05 | Fail-closed sweep of remaining Redis-degradation and auth/validation corners (M1-M8, M20) | ✓ SATISFIED | All 6 ROADMAP success criteria verified against merged code; all 5 plans' `requirements: [RESIL-01]` frontmatter accounted for; no orphaned requirements found for Phase 52 in REQUIREMENTS.md |

Note: `.planning/REQUIREMENTS.md` line 34/85 still shows RESIL-01 with an unchecked `[ ]` box and "Pending" status — this is a tracking-file lag (ROADMAP.md already marks Phase 52 `[x]` complete and STATE.md shows the phase executed), not a code gap. Recommend updating REQUIREMENTS.md's checkbox/status as part of phase close-out.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `zoho-middleware/lib/validateEnv.js` | 69 | Stale doc-string: `desc` field for `ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID` still says "falls back to hardcoded 109900000000873231 if unset" — no longer true after 52-03 (M3) removed the fallback | ℹ️ INFO | Cosmetic only — a boot-time env-doc string, not executable logic. Does not affect fail-closed behavior (verified: the actual guard in pos.js correctly fails closed with no fallback). Recommend a follow-up doc fix. |
| `zoho-middleware/routes/items.js` | 148 (PUT handler) | `PUT /api/inventory/items/:id` concatenates `req.params.id` into the Zoho path without the `isValidId` guard applied to the sibling GET handlers on the same route | ℹ️ INFO (documented, in-scope decision) | Same vulnerability class (%2F pivot) as M20, but explicitly out of the audit's cited scope (CONTEXT.md M20 finding cites only `items.js:117,151`, the two GET handlers) and this route already sits behind the global non-GET auth guard (`server.js:282` — every PUT requires a valid credential tier before reaching the handler), so exploitation requires an already-authenticated caller. 52-04-SUMMARY.md documents this as an attempted-then-reverted fix (reverted only because it broke a protected, do-not-edit existing test per CLAUDE.md rule 10) and flags it as a known follow-up. Not a blocker for ROADMAP SC-5, which is scoped to the M20 audit finding. |

No `TBD`/`FIXME`/`XXX` debt markers found in any of the 9 files modified by this phase. No placeholder/stub patterns, no empty handlers, no hardcoded-empty data flowing to a guard's decision path.

### Deviation Review (per verifier task instructions)

Two documented executor deviations were reviewed against the actual diffs:

1. **52-05: `x-api-key` headers added to `recipes.test.js`/`gift-cards.test.js` success-path requests.** Confirmed via `git show fe8e094` — every pre-existing `expect(...)` assertion is byte-identical; only `headers: { 'x-api-key': ... }` was added to request objects, plus net-new 401-without-key tests. This is the necessary and correct consequence of closing M8 (these two routes were provably unauthenticated before this phase — that unauthenticated-success behavior is the exact vulnerability being closed). Matches the cited precedent (commit `313b91a`, Phase 45-01 D-09). **Legitimate — not masking a regression.**

2. **52-02: one assertion flipped in `redis-failclosed.test.js`.** Confirmed via `git show 91eb7bd` — the old Test 3 drove an impossible-in-production mock combination (`isConnected():true` while `getClient()` resolves `null`) and asserted the limiter "never trips" (`totalHits:0` forever), which was pinning the M4 fail-open bug as correct. The new version instead verifies the healthy-connected-client path is genuinely exercised (`incr()` called, 6th request trips at 429) — a stronger, not weaker, assertion. The exact fail-open corner removed by this flip (connected-but-absent-client race) is independently covered by new regression tests in `ratelimit-failclosed-52.test.js` ("paymentLimiter still trips ... when the Redis client is absent while connected"). **Legitimate — the invariant is preserved and additionally regression-tested elsewhere, not weakened.**

### Human Verification Required

None. This phase is entirely server-side (Express middleware) security/resilience hardening with no UI, visual, or real-time-behavior surface. All 6 success criteria are verifiable via code inspection and automated test execution, both of which were performed directly against the merged codebase (not SUMMARY.md claims).

### Gaps Summary

No gaps found. All 6 ROADMAP success criteria are independently verified in the actual merged code (not just plan/summary claims): the shared `closedOnRedisError` helper exists and is applied at all three M1/M4/M5 call sites with passing fail-closed tests; the legacy `/api/pos/sale` route is quarantined (410, pre-charge) and the gift-card `account_id` fallback is removed in favor of a fail-closed env-required check; the `csv_url` SSRF vector is closed via a mandatory https-only host allowlist; the `?bust=1` and Apps-Script GET proxies are auth-guarded and appropriately cached; the `%2F` path-pivot is closed on both audit-cited item routes; and a dedicated regression test proves the FIRSTBATCH promo is not repeatable across two Redis-outage checkout requests. The full middleware (71/1233) and frontend (53/947) test suites are green, lint is clean, and both reviewer-flagged test deviations were traced to their diffs and confirmed to strengthen (not weaken or mask) the invariants they touch. Two informational (non-blocking) notes are recorded above: a stale doc-string in `validateEnv.js` and a documented, audit-out-of-scope residual on the PUT sibling of the M20-guarded GET routes.

---

*Verified: 2026-07-03T06:09:45Z*
*Verifier: Claude (gsd-verifier)*
