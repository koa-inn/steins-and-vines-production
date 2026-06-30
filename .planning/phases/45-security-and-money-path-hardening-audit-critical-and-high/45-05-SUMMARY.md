---
phase: 45-security-and-money-path-hardening-audit-critical-and-high
plan: "05"
subsystem: money-path
tags: [money-path, shared-lib, refactor, d11, tdd]
dependency_graph:
  requires: []
  provides: [lib/money-path.js, money-path-primitives]
  affects: [routes/checkout.js, routes/pos.js (45-06/07/08)]
tech_stack:
  added: [zoho-middleware/lib/money-path.js]
  patterns: [lazy-require, discriminated-result, tdd-red-green]
key_files:
  created:
    - zoho-middleware/lib/money-path.js
    - zoho-middleware/__tests__/money-path.test.js
  modified:
    - zoho-middleware/routes/checkout.js
decisions:
  - "D-11: money-path primitives extracted to shared lib so pos.js can consume same guards as checkout.js (plans 45-06/07/08 wire pos.js)"
  - "rejectWithVoid passes checkout.js's helcimLib + mailer explicitly as deps (vs lazy-require) to ensure Jest mocks work correctly in checkout-route.test.js scope"
  - "voidWithTimeout: timeout = log-only (no mailer alert), matching checkout.js:846 behavior; non-timeout error = CRITICAL log + sendVoidFailureAlert"
  - "acquireIdempotencyLock discriminated result: replay/acquired/contention/failclosed — callers map to HTTP without branching on Redis internals"
metrics:
  duration: "~12 min"
  completed: "2026-06-30"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 3
---

# Phase 45 Plan 05: Extract Shared lib/money-path.js Summary

Extracted the four checkout.js safety primitives into a shared `lib/money-path.js` (D-11) via TDD, then refactored `checkout.js` to consume the shared lib with zero behaviour change. All 82 pre-existing checkout money-path tests pass unchanged; full 1073-test suite is green.

## What Was Built

### lib/money-path.js (241 lines)

Shared money-path safety primitives ready for pos.js adoption in plans 45-06/07/08:

| Export | Source | Purpose |
|--------|--------|---------|
| `acquireIdempotencyLock(cache, key, ttl, opts)` | checkout.js:158-185 | Idempotency lock gate; returns discriminated result (replay/acquired/contention/failclosed); fail-CLOSED-in-prod on Redis throw |
| `assertTxnNotReplayed(cache, transactionId, suffix)` | checkout.js:248-270 | Helcim txn replay guard; always fails closed on Redis error |
| `markTxnUsed(cache, transactionId, suffix, ttl=86400)` | checkout.js:718-724 | Marks `helcim:txn:<id><suffix>` = 'used' with 24h TTL |
| `rejectWithVoid(res, body, status, errorMsg, deps)` | checkout.js:45-61 | Void already-charged payment before 4xx; sendVoidFailureAlert on void failure; deps lazily defaulted to lib/helcim + lib/mailer |
| `voidWithTimeout(helcimLib, token, amount, opts)` | checkout.js:825-873 | Void with 8s timeout; timeout=log-only; non-timeout error=CRITICAL+mailer alert |
| `CHECKOUT_IDEMPOTENCY_TTL` | checkout.js:35 | 600 (10 min); exported so checkout.js/pos.js share the constant |

**Key interface contract for 45-06/07/08 executors:**

```js
// acquireIdempotencyLock result mapping (checkout.js pattern):
var lockResult = await moneyPath.acquireIdempotencyLock(cache, key, ttl);
if (lockResult.status === 'replay')    → 201 lockResult.cached
if (lockResult.status === 'contention'
 || lockResult.status === 'failclosed') → 409
// else 'acquired' → proceed

// assertTxnNotReplayed result mapping:
var txnResult = await moneyPath.assertTxnNotReplayed(cache, transactionId, suffix);
if (txnResult.status !== 'ok') → 409 'Payment already processed'

// rejectWithVoid — pass deps explicitly in routes for Jest-safe mocking:
moneyPath.rejectWithVoid(res, body, 400, 'msg', { helcim: helcimLib, mailer: mailer })

// voidWithTimeout — fire-and-forget, send response in .then():
moneyPath.voidWithTimeout(helcimLib, transactionId, depositAmount, {
  mailer: mailer, eventLog: eventLog
}).then(function() { res.status(status).json({ error: msg, payment_voided: true }); });
```

### __tests__/money-path.test.js (24 tests)

TDD RED commit (ff95f1f) followed by GREEN commit (9b71031):

- Test 1: `acquireIdempotencyLock` returns replay with cached body
- Test 2: returns contention when lock not acquired (→ 409)
- Test 3a/b/c: fails CLOSED in prod / open in dev on Redis throw; reads NODE_ENV when `isProd` not supplied
- Test 4a: `assertTxnNotReplayed` signals replay when key exists; always fails closed on Redis error
- Test 4b: `markTxnUsed` writes `helcim:txn:<id><suffix>` with 86400s TTL
- Test 5a: `rejectWithVoid` calls `helcim.voidTransaction` for valid token
- Test 5b: calls `mailer.sendVoidFailureAlert` when void rejects
- Test 6a: `voidWithTimeout` resolves when void completes within timeout
- Test 6b: timeout caught without mailer alert (log-only path, matches checkout.js:846)
- Test 6c: non-timeout error triggers void-failure alert
- Plus: void declined, default 8000ms timeout, CHECKOUT_IDEMPOTENCY_TTL=600

### routes/checkout.js refactoring (refactor commit 49a576b)

- `require('../lib/money-path')` added
- `withTimeout` import removed (no longer needed at route level)
- `CHECKOUT_IDEMPOTENCY_TTL` sourced from `moneyPath.CHECKOUT_IDEMPOTENCY_TTL`
- `rejectWithVoid` replaced with thin wrapper calling `moneyPath.rejectWithVoid` (passes `helcimLib` + `mailer` explicitly)
- Idempotency lock gate (158-185) → `moneyPath.acquireIdempotencyLock`
- Txn replay check (248-270) → `moneyPath.assertTxnNotReplayed`
- Txn mark (718-724) → `moneyPath.markTxnUsed`
- Void-on-failure block (825-873) → `moneyPath.voidWithTimeout` with module-scope deps passed

## Commits

| Hash | Type | Description |
|------|------|-------------|
| ff95f1f | test(45-05) | Add failing tests for money-path primitives (RED) |
| 9b71031 | feat(45-05) | Create shared lib/money-path.js with checkout safety primitives (GREEN) |
| 49a576b | refactor(45-05) | Wire checkout.js to consume lib/money-path.js (no behaviour change) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Explicit deps required in checkout.js for Jest mock correctness**
- **Found during:** Task 2 — first test run after refactoring
- **Issue:** When `rejectWithVoid` called `getHelcim()` = `require('./helcim')` lazily from lib/money-path.js, Jest's module mock resolution (from checkout-route.test.js scope) did not fire `voidTransaction` — `helcimLib.voidTransaction` call count remained 0, failing the "void-on-early-reject" test
- **Fix:** Replaced `var rejectWithVoid = moneyPath.rejectWithVoid` with a thin wrapper that passes `{ helcim: helcimLib, mailer: mailer }` explicitly; same pattern applied to `voidWithTimeout` call with `{ mailer: mailer, eventLog: eventLog }`
- **Files modified:** zoho-middleware/routes/checkout.js
- **Commit:** 49a576b (included in the refactor commit)

The lazy-require pattern in money-path.js is correct and sufficient for pos.js (45-06/07/08) and the money-path unit tests; checkout.js just needs to pass its own module-scope references to guarantee Jest mock transparency across test file boundaries.

## Verification Results

- `cd zoho-middleware && npm test -- money-path`: 24/24 tests PASS
- `cd zoho-middleware && npm test -- checkout`: 82/82 tests PASS (all pre-existing, zero changes to test files)
- `cd zoho-middleware && npm test`: 1073/1073 tests PASS
- `npm test` (frontend jsdom): 928/928 tests PASS
- `npm run lint`: 0 errors (pre-existing warnings only)
- `lib/money-path.js`: 241 lines (>60 minimum), exports all 5 functions + CHECKOUT_IDEMPOTENCY_TTL
- `checkout.js`: requires `'../lib/money-path'`, no inline rejectWithVoid/lock-gate/replay-guard/void-block

## Known Stubs

None. All primitives are fully wired.

## Threat Flags

None. This is a pure refactor (D-11). No new network endpoints, auth paths, or schema changes introduced. The existing threat mitigations (T-45-05-REG, T-45-05-DUP, T-45-05-SC) are all satisfied:
- T-45-05-REG: Existing checkout tests remain green (regression guardrail held)
- T-45-05-DUP: Single shared lib eliminates checkout/pos money-path divergence
- T-45-05-SC: No new packages installed (pure extraction from existing code)

## Self-Check: PASSED

- [x] zoho-middleware/lib/money-path.js exists (241 lines)
- [x] zoho-middleware/__tests__/money-path.test.js exists (24 tests)
- [x] zoho-middleware/routes/checkout.js modified (requires money-path)
- [x] Commits ff95f1f, 9b71031, 49a576b exist in git log
- [x] Full test suite 1073/1073 green
