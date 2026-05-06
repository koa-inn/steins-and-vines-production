---
phase: 10-checkout-payment-safety
plan: 04
subsystem: checkout-payment
tags: [security, payment-safety, idempotency, postMessage]
dependency_graph:
  requires: [10-01, 10-02, 10-03]
  provides: [payment-state-machine-fixes, atomic-idempotency, origin-validation]
  affects: [js/modules/12-checkout.js, zoho-middleware/routes/checkout.js]
tech_stack:
  patterns: [SETNX-atomic-lock, postMessage-origin-validation, bfcache-state-reset]
key_files:
  modified:
    - js/modules/12-checkout.js
    - zoho-middleware/routes/checkout.js
    - tests/frontend/checkout-payment-safety.test.js
    - js/main.js
    - js/main.min.js
decisions:
  - acquireLock already prepends lock: prefix internally so key passed without prefix
  - Tasks 2 and 6 committed together since H5 fix modifies same onError callback as C2 fix
metrics:
  tasks_completed: 8
  tasks_total: 8
  files_modified: 5
  tests_added: 3
  completed: 2026-05-05
---

# Phase 10 Plan 04: Payment Safety Critical Fixes Summary

Fixed 6 critical/high-priority payment flow bugs preventing double charges, blocked orders, TOCTOU races, postMessage spoofing, stale state, and duplicate dual-cart orders.

## Completed Tasks

| Task | Name | Commit | Key Change |
|------|------|--------|------------|
| 1 | Fix C1 - chargeInFlight bypass | 4644759 | Allow postMessage re-dispatch when transactionId exists |
| 2 | Fix C2 - Preserve transactionId on error | 0b5f2cb | Remove _helcimTransactionId = null from error paths |
| 3 | Fix H1 - Atomic idempotency via SETNX | eb84cf4 | acquireLock before processCheckout; 409 on race |
| 4 | Fix H4 - postMessage origin validation | 4628020 | Only accept from secure.helcim.app / myhelcim.com |
| 5 | Fix H3 - Clear state on success + bfcache | 858263d | pageshow handler + success path cleanup |
| 6 | Fix H5 - Dual-cart partial success | 0b5f2cb | Clear only ferment cart when it succeeded |
| 7 | Unit tests for safety behaviors | 80b235f | 3 new tests verifying C2 fix and state helpers |
| 8 | Full test suite + lint + build | c3cf7e1 | 301 frontend + 447 middleware tests pass |

## Verification Results

1. `grep "event.origin"` - H4 origin check confirmed at line 1741
2. `grep "acquireLock"` - H1 atomic check confirmed at line 129
3. `_helcimTransactionId = null` - appears ONLY in: declaration, bfcache handler, ABORTED handler, and success paths (NOT in error .catch blocks)
4. `grep "pageshow"` - H3 bfcache handler confirmed at line 39
5. All test suites green (301 + 447 = 748 tests passing)

## Deviations from Plan

### Combined Commits

Tasks 2 and 6 were committed together since both modify the same dual-cart onError callback. The C2 fix (remove transactionId nulling) and H5 fix (partial success handling) are logically intertwined in that code block.

### acquireLock key prefix

Plan suggested `var lockKey = 'lock:' + idempotencyKey` but `cache.acquireLock()` already prepends `lock:` internally (line 109 of cache.js). Passed raw idempotencyKey to avoid double-prefixing.

## Known Stubs

None - all fixes are complete implementations.

## Self-Check: PASSED
