---
phase: 100-limited-releases-page-and-online-deposits
plan: 03
subsystem: zoho-middleware shared libs
tags: [zoho, helcim, checkout, refactor]
requires: []
provides:
  - zohoDelete and zohoPostOnce in lib/zoho-api.js
  - helcim.initializeCheckout(amount, currency, opts) with invoiceRequest.invoiceNumber
  - checkout-helpers.resolveOrCreateContact(args, deps)
affects: [100-05, 100-06, 100-07]
key-files:
  created:
    - zoho-middleware/__tests__/zoho-api-delete-postonce.test.js
    - zoho-middleware/__tests__/helcim-initialize-invoice.test.js
    - zoho-middleware/__tests__/resolve-or-create-contact.test.js
  modified:
    - zoho-middleware/lib/zoho-api.js
    - zoho-middleware/lib/helcim.js
    - zoho-middleware/lib/checkout-helpers.js
    - zoho-middleware/routes/checkout.js
decisions:
  - "resolveOrCreateContact takes an optional deps arg; checkout.js passes its bound cache/zohoGet/zohoPost"
metrics:
  tasks: 3
  completed: 2026-10-29
---

# Phase 100 Plan 03: Shared lib capabilities Summary

Added a no-retry Zoho POST, a Zoho DELETE, an optional Helcim invoiceNumber nonce binding, and extracted checkout's contact find-or-create into a shared helper, with /api/checkout behaviour unchanged.

## Commits
- e4cad6d8: feat(100): zohoDelete and no-retry zohoPostOnce
- d390371b: feat(100): optional invoiceNumber binding on Helcim initialize
- 0f9ea803: refactor(100): extract checkout contact find-or-create into checkout-helpers (no behaviour change)

## Deviations from Plan

**1. [Rule 3 - Blocking] resolveOrCreateContact accepts optional `deps`**
- **Found during:** Task 3
- **Issue:** With purely lazy `require` inside the helper, existing `checkout-route.test.js` ("accepts a 0.57 kg ingredient line") failed (502): that file resets the module registry mid-run, so the helper's lazy require got a fresh mock instance, not the one the test configured.
- **Fix:** Helper takes `deps` ({cache, zohoGet, zohoPost}); checkout.js passes its load-time bindings. Without deps the helper falls back to lazy require (used by the new preorder callers). Logic remains a verbatim move.
- **Files:** zoho-middleware/lib/checkout-helpers.js, zoho-middleware/routes/checkout.js
- **Commit:** 0f9ea803

Also removed the now-unused `buildContactPayload` and `zohoGet` locals from checkout.js (lint). No existing test file was modified.

No spike results file existed, so the default `invoiceRequest.invoiceNumber` field is used (D-17).

## Deferred Issues
- `zoho-middleware/__tests__/vancouver-timezone.test.js` fails 2 tests on local Node 20.20 (tzdata; prod runs Node 24). Pre-existing and unrelated; fails identically on every task.

## Verification
Frontend: 3206 tests pass; lint clean. Middleware: all pass except the pre-existing timezone failures above.

## Self-Check: PASSED
