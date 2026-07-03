---
phase: 52-fail-closed-sweep
plan: 02
subsystem: infra
tags: [redis, fail-closed, resilience, tdd, jest, rate-limiting, money-path]

# Dependency graph
requires:
  - phase: 52-fail-closed-sweep (plan 01)
    provides: zoho-middleware/lib/redis-guard.js exporting closedOnRedisError(fn, opts) — shared fail-closed-on-Redis-error helper
provides:
  - "checkout.js FIRSTBATCH promo re-validation (lock + redemption check) routed through closedOnRedisError — no repeatable $20 discount during a Redis outage (M1)"
  - "server.js makeRedisStore.increment() falls through to shared countInProcess() memStore accounting on any connected-but-failed Redis path (mid-op incr() throw, absent client) instead of totalHits:0 (M4)"
  - "server.js loopback rate-limit skip gated to NODE_ENV !== 'production' — a spoofed X-Forwarded-For loopback address can no longer defeat PIN/payment throttling in prod (M5)"
affects: [52-03, 52-04, 52-05, obs-01-money-path-observability]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "countInProcess(key) as the single per-limiter in-process accounting function — called by both the Redis-disconnected branch and the connected-but-failed branch, so a fail-closed decision never drifts into a separate silent totalHits:0 state"
    - "closedOnRedisError({ alwaysClosed: true }) applied at both a money guard (promo) and a security guard (rate-limit store) call site, confirming the 52-01 helper's contract generalizes across guard classes"

key-files:
  created:
    - zoho-middleware/__tests__/promo-failclosed.test.js
    - zoho-middleware/__tests__/ratelimit-failclosed-52.test.js
  modified:
    - zoho-middleware/routes/checkout.js
    - zoho-middleware/server.js
    - zoho-middleware/__tests__/redis-failclosed.test.js

key-decisions:
  - "Both checkout.js promo call-sites (lock acquisition AND redemption check) route through closedOnRedisError with alwaysClosed:true — a money guard, so the invariant holds in every environment, not just production"
  - "M4's fix extracts a shared countInProcess(key) helper and applies it to BOTH the mid-op incr() throw AND the connected-but-absent-client race (isConnected():true while getClient() resolves null), per the plan's explicit instruction and the grep verification requiring zero totalHits:0 remaining in makeRedisStore"
  - "M5's loopback skip is gated on process.env.NODE_ENV read at request time inside increment() (not cached at store-creation time), so per-test/per-request env mutation works correctly without re-requiring the server module"
  - "Deviation (Rule 1): updated __tests__/redis-failclosed.test.js Test 3, which had asserted the exact fail-open combination (connected:true + client:null → totalHits:0 forever) that M4 closes; the test now mocks a healthy connected Redis client and asserts the real Redis path is used and enforces normally, preserving its original protective intent without pinning the bug as correct"

patterns-established:
  - "countInProcess(key): shared in-process rate-limit accounting reused across every Redis-unavailable-or-failed corner within a single makeRedisStore instance"

requirements-completed: [RESIL-01]

# Metrics
duration: 10min
completed: 2026-07-03
---

# Phase 52 Plan 02: M1/M4/M5 Fail-Closed Sweep Summary

**Applied the shared `closedOnRedisError` helper to close three remaining fail-open corners: checkout.js's FIRSTBATCH promo re-validation (M1 — no more repeatable $20 discount during a Redis outage), server.js's rate-limit store mid-op error path (M4 — falls through to in-process memStore accounting instead of `totalHits:0`), and the loopback rate-limit skip (M5 — prod-gated so a spoofed `X-Forwarded-For` can't defeat PIN throttling).**

## Performance

- **Duration:** 10 min (commit-to-commit; task work itself)
- **Started:** 2026-07-02T22:52:59-07:00 (first commit)
- **Completed:** 2026-07-02T23:02:52-07:00 (last commit)
- **Tasks:** 2/2 completed
- **Files modified:** 5 (2 new test files, 2 source files, 1 pre-existing test updated)

## Accomplishments
- Closed the repeatable-promo-during-outage money hole (M1): both the promo lock acquisition and the redemption-check Redis read in `checkout.js` now route through `closedOnRedisError({ alwaysClosed: true })`; on failclosed, `promoDiscount` stays `0` and the lock is never acquired — no discount is granted, and this holds across repeated requests during an outage.
- Closed the rate-limit fail-open corner (M4): `makeRedisStore.increment()` extracted a shared `countInProcess(key)` helper, and both the mid-op `incr()` throw and the connected-but-absent-client race now fall through to it instead of returning `{ totalHits: 0 }` (which express-rate-limit itself rejects as invalid, and which previously silently disabled the limiter).
- Closed the loopback-spoof gap (M5): the loopback rate-limit skip (`127.x`/`::1` → `totalHits:1` forever) is now gated to `NODE_ENV !== 'production'` — in production, a spoofed `X-Forwarded-For: ::1` accumulates like any other key and still trips PIN/payment throttling.
- TDD RED→GREEN throughout: `promo-failclosed.test.js` (4 tests) and `ratelimit-failclosed-52.test.js` (4 tests) both went red against the pre-fix code, then green after each fix. M4 and M5 shipped as separate commits (CLAUDE.md Rule 4).
- Full middleware suite green: 71 suites / 1233 tests (baseline 70/1229 from wave 1 + 8 new tests across the two new files). `npx eslint server.js routes/checkout.js __tests__/*.js` clean (0 errors; only pre-existing unrelated warnings).
- Grep confirms zero `totalHits: 0` remains in `makeRedisStore` (only a doc-comment mentions the string).

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — promo repeatable during Redis outage** - `e269934` (test)
2. **Task 1: GREEN — promo FIRSTBATCH fails closed via redis-guard (M1)** - `5a5e468` (fix)
3. **Task 2: RED — rate-limit store fails open on mid-op error and loopback** - `a14c062` (test)
4. **Task 2: GREEN — rate-limit store fails closed to memStore on mid-op error (M4)** - `91eb7bd` (fix)
5. **Task 2: GREEN — prod-gate the loopback rate-limit skip (M5)** - `96160fa` (fix)

**Plan metadata:** (this commit, immediately following)

_Note: TDD plan — RED→GREEN per corner; Task 2 additionally splits M4 and M5 into separate fix commits per CLAUDE.md Rule 4 (one logical change per commit), as directed by the plan._

## Files Created/Modified
- `zoho-middleware/routes/checkout.js` - Requires `lib/redis-guard`; routes the FIRSTBATCH promo lock acquisition and redemption-check Redis read through `closedOnRedisError({ alwaysClosed: true })`; on `failclosed`, skips the lock and leaves `promoDiscount = 0`. Removed the old fail-open catch blocks (`lockAcquired = true`, `promoDiscount = 20` on throw).
- `zoho-middleware/__tests__/promo-failclosed.test.js` - New file (4 tests): baseline preserved (discount applies when Redis is up and unredeemed; rejected when already redeemed), plus the M1 regression (no discount on Redis throw; not repeatable across two outage-time requests). Verifies via the Zoho payload's Maker's Fee line-item rate (45 full vs. 36 discounted).
- `zoho-middleware/server.js` - Requires `lib/redis-guard`; `makeRedisStore` extracts `countInProcess(key)` and routes the connected path (incr/expire/ttl) through `closedOnRedisError({ alwaysClosed: true })`, falling through to `countInProcess` on failclosed instead of `{ totalHits: 0 }` (M4). The loopback short-circuit is gated to `process.env.NODE_ENV !== 'production'` (M5).
- `zoho-middleware/__tests__/ratelimit-failclosed-52.test.js` - New file (4 tests): M4 — limiter still trips when `incr()` throws mid-op, and when the client resolves absent while `isConnected()` reports true; M5 — a loopback key accumulates in production (skip disabled), and the skip is preserved in non-production.
- `zoho-middleware/__tests__/redis-failclosed.test.js` - Updated Test 3 (see Deviations below) to mock a healthy connected Redis client instead of the now-impossible "connected but client-null" combination, preserving its original protective intent (Redis path used, not bypassed) without asserting the pre-fix fail-open behavior as correct.

## Decisions Made
- Both checkout.js promo call-sites route through the shared helper with `alwaysClosed: true` (money guard — no dev/prod distinction), matching the pattern established by `money-path.js`'s `assertTxnNotReplayed`.
- M4's fix intentionally covers both the mid-op `incr()` throw AND the connected-but-absent-client race, per the plan's explicit action text and the top-level verification's grep check (`totalHits: 0` must not remain anywhere in `makeRedisStore`).
- M5's `NODE_ENV` check reads `process.env.NODE_ENV` at request time inside `increment()`, not once at `makeRedisStore()` construction — required for correct behavior in both production and the test suite (which toggles `NODE_ENV` per test against a single `require('../server')`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated one pre-existing test assertion that pinned the M4 fail-open bug as "correct" behavior**
- **Found during:** Task 2, M4 fix — running the full suite after the fix
- **Issue:** `__tests__/redis-failclosed.test.js` Test 3 ("in-process Map NOT used when Redis is connected — no spurious 429") drove a mock combination that cannot occur with real Redis — `cache.isConnected()` returning `true` while `cache.getClient()` resolves `null` — and asserted 6 requests never trip the limiter (relying on the old `{ totalHits: 0 }` fail-open return). That exact combination is precisely the race-window corner M4 closes (a connected-but-absent-client state, e.g. from an `'end'` event firing between the check and the resolve). Fixing M4 (as the plan explicitly directs, including this corner) made the limiter correctly trip on the 6th request, breaking the old assertion.
- **Fix:** Replaced the mock with a genuinely healthy, connected Redis client (`incr`/`expire`/`ttl` all succeed, tracked per-key). Updated the test's assertions to verify its real original intent — that the Redis path is used, not bypassed by the in-process Map — by checking the mock's `incr()` was actually invoked, and that the limiter enforces normally via that path (6th request trips at 429, matching production behavior). Test description and inline comments updated to explain the change and point to the new M4 regression coverage in `ratelimit-failclosed-52.test.js`.
- **Files modified:** `zoho-middleware/__tests__/redis-failclosed.test.js`
- **Verification:** `npx jest __tests__/redis-failclosed.test.js` — 7/7 pass. Full suite: 71/1233 pass.
- **Committed in:** `91eb7bd` (M4 fix commit — test update ships alongside the fix that necessitated it)

---

**Total deviations:** 1 auto-fixed (1 bug-driven test correction, Rule 1)
**Impact on plan:** Necessary and in-scope — the updated assertion was testing the exact defect this task closes. No scope creep: only the one test in the one describe block affected by the M4 change was touched; all other tests in that file (and the rest of the suite) are untouched.

## Issues Encountered
- While writing the M5 RED test, an initial attempt used `X-Forwarded-For: ::1` and found it never matched `LOOPBACK_RE` — express-rate-limit v7's default IPv6 key generator normalizes IPv6 addresses to a `/56` subnet (`::/56`) for privacy before the store ever sees the key, so the raw `::1` string the loopback regex expects never reaches `increment()`. Switched the test to an IPv4 loopback address (`127.0.0.1`), which express-rate-limit does not subnet-normalize, matching how `LOOPBACK_RE` is actually exercised in practice. No production code was affected (the loopback regex itself already handles the `127.` prefix correctly); this only affected which fixture address the new test used.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- M1/M4/M5 are closed; the shared `closedOnRedisError` helper now backs one money guard (promo) and one security guard (rate-limit store), alongside the idempotency-lock pattern it already mirrors from `lib/money-path.js`.
- Remaining fail-closed sweep items (M2 legacy `/api/pos/sale` quarantine, M3 gift-card account fallback, M6 `csv_url` allowlist, M7/M8 Apps-Script GET auth+cache, M20 `:id` validation) are scoped to other 52-0x plans per the phase's wave structure — no blockers surfaced here that affect them.
- Full middleware regression (71/1233) and lint are green; ready for wave-completion merge.

---
*Phase: 52-fail-closed-sweep*
*Completed: 2026-07-03*

## Self-Check: PASSED

- FOUND: zoho-middleware/routes/checkout.js
- FOUND: zoho-middleware/server.js
- FOUND: zoho-middleware/__tests__/promo-failclosed.test.js
- FOUND: zoho-middleware/__tests__/ratelimit-failclosed-52.test.js
- FOUND: zoho-middleware/__tests__/redis-failclosed.test.js
- FOUND: .planning/phases/52-fail-closed-sweep/52-02-SUMMARY.md
- FOUND: e269934 (test — promo RED commit)
- FOUND: 5a5e468 (fix — promo M1 GREEN commit)
- FOUND: a14c062 (test — rate-limit RED commit)
- FOUND: 91eb7bd (fix — rate-limit M4 GREEN commit)
- FOUND: 96160fa (fix — rate-limit M5 GREEN commit)
- FOUND: e8105b3 (docs — summary commit)
