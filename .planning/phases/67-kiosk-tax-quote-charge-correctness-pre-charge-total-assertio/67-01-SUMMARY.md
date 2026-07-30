---
phase: 67-kiosk-tax-quote-charge-correctness-pre-charge-total-assertio
plan: 01
subsystem: payments
tags: [tax, fail-closed, idempotency, helcim, zoho-invoice, jest, tdd]

# Dependency graph
requires:
  - phase: 52-fail-closed-sweep
    provides: fail-closed money-path doctrine (never guess, reject closed and name the cause)
  - phase: 45
    provides: void-on-failure machinery (moneyPath.voidWithTimeout), WR-03 idempotency-lock-release pattern, CR-02 discriminated-result idiom
provides:
  - "computeTax fail-closed: no silent KIOSK_TAX_RATE 5% guess; NaN-preserving tax_percentage resolution; discriminated result ({taxTotal}|{error,itemName})"
  - "Sale-path (pre-charge) early 400 on unresolved tax, naming the item"
  - "Confirm-path tagged __taxUnresolved throw routed through the existing void-on-failure .catch — never a bare 400 after a real terminal charge"
  - "Pre-charge total assertion: server rejects when client_grand_total diverges from server grandTotal by more than $0.01, before any Helcim charge, releasing the idempotency lock on reject"
  - "Interface contract (client_grand_total, client_tax_total) pinned in pos.js doc comment for 67-02 (frontend) to consume"
affects: [67-02-kiosk-frontend-tax-and-totals]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Discriminated async result for a sub-computation that may legitimately fail (computeTax mirrors the existing gcRealBalanceLookup CR-02 idiom)"
    - "Tagged-error-into-promise-chain for pre-charge-vs-post-charge branching (computeTax's __taxUnresolved mirrors the existing __manualVerify idiom)"

key-files:
  created:
    - zoho-middleware/__tests__/pos-precharge-assertion.test.js
  modified:
    - zoho-middleware/routes/pos.js
    - zoho-middleware/__tests__/pos-tax.test.js
    - zoho-middleware/__tests__/catalog.test.js

key-decisions:
  - "Field name is client_grand_total (asserted) + client_tax_total (observability only, never asserted) — pinned in the interface_contract for 67-02 to send."
  - "computeTax's pct read changed from `catalogItem.tax_percentage || 0` to NaN-preserving `parseFloat(catalogItem.tax_percentage)` — an explicit 0 stays a valid resolved rate; only a truly missing value trips the unresolved branch."
  - "Sale path (no charge yet) rejects unresolved tax with an early 400; confirm path (charge may already exist) throws a tagged __taxUnresolved error into the promise chain so it reaches the existing void-on-failure .catch instead of bypassing it with an early return."
  - "Pre-charge assertion sits in processSaleWithPrices, after the existing grandTotal bounds guards and before the gift-card balance lookup / Helcim terminal push — the earliest point where both the client-declared total and the idempotency lock are in scope."
  - "CLAUDE.md rule 10 exception (approved in 67-CONTEXT.md): the two pos-tax.test.js tests pinning the old KIOSK_TAX_RATE 5%-fallback were updated, not left conflicting with the new fail-closed contract."

patterns-established:
  - "Fail-closed tax resolution: a catalog item's tax is only ever computed from tax_percentage (NaN-preserving), sales_tax_rule_id override, or a present tax_id (Zoho-side 0%) — never a server-side default guess."
  - "Path-aware fail-closed rejection: pre-charge call sites may early-return 400; post-charge-possible call sites must throw a tagged error into the existing void-on-failure catch."

requirements-completed: [KIOSK-TAX-QUOTE-01]

# Metrics
duration: 9min
completed: 2026-07-30
---

# Phase 67 Plan 01: Kiosk Tax Quote-Charge Correctness — Middleware Fail-Closed Tax + Pre-Charge Assertion Summary

**Removed the middleware's silent 5% tax-rate guess and added a pre-charge assertion comparing the kiosk's displayed grand total to the server's computed total — closing the money-path half of the INV-000160 kiosk quote-vs-charge seam (KIOSK-TAX-QUOTE-01), backward-compatible with the currently-deployed kiosk JS so it can ship to prod ahead of the frontend fix (67-02).**

## Performance

- **Duration:** ~9 min (commit-to-commit; started from the pattern-map baseline commit `0abf9cd2`)
- **Started:** 2026-07-30T09:37:52-07:00
- **Completed:** 2026-07-30T09:46:39-07:00
- **Tasks:** 3
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments
- `computeTax` no longer falls back to `KIOSK_TAX_RATE` (default 5%) when a catalog item's tax can't be resolved — it now returns a discriminated result and the sale fails closed, naming the item, instead of silently under-taxing.
- The `pct` read is NaN-preserving (`parseFloat`, no `|| 0`), so a genuinely missing `tax_percentage` is distinguishable from a legitimate explicit `0` — the exact ambiguity that let the live incident's `0`-coerced-to-`5%` fallback logic exist in the first place.
- Sale path (pre-charge) rejects unresolved tax with an early 400. Confirm path (a real terminal charge may already exist) instead throws a tagged `__taxUnresolved` error into the promise chain, which is caught by the *existing* void-on-failure machinery — voiding the charge before responding when `body.transaction_id` is set, and returning a plain 400 only when nothing was charged. Never a bare-400-after-a-charge (the pos.js:816-819 invariant).
- New pre-charge total assertion: when the kiosk sends `client_grand_total`, the server compares it to its own computed `grandTotal` (tolerance $0.01) before any gift-card lookup or Helcim terminal push. Mismatch → 400, no charge, idempotency lock released (WR-03 shape) so a corrected re-ring can retry immediately. Absent or non-finite `client_grand_total` skips the assertion (back-compat with old cached kiosk JS).

## Task Commits

Each task was committed atomically (TDD: RED → GREEN → GREEN):

1. **Task 1: RED — write failing middleware tests + update the two pinned 5%-fallback tests** - `568c312b` (test)
2. **Task 2: computeTax fail-closed — remove the silent 5% guess, NaN-preserving resolution, discriminated result, path-aware caller handling** - `9df7ebeb` (feat)
3. **Task 3: pre-charge assertion — compare client_grand_total to server grandTotal before charging** - `3f2fa659` (feat)

_TDD plan: Task 1 is RED (tests only, no production code touched), Tasks 2 and 3 are GREEN (implementation, driving those tests to pass). No REFACTOR commit was needed — no post-GREEN cleanup._

## Files Created/Modified
- `zoho-middleware/routes/pos.js` - `computeTax` fail-closed rewrite (discriminated result, NaN-preserving pct); sale-path early-400 caller; confirm-path tagged-throw caller; outer `.catch` `__taxUnresolved` branch; pre-charge `client_grand_total` assertion in `processSaleWithPrices`; doc comment updates (both `/api/kiosk/sale` route doc blocks)
- `zoho-middleware/__tests__/pos-tax.test.js` - updated the two tests pinning the old 5%-fallback (CLAUDE.md rule 10 exception, per 67-CONTEXT.md); added a legitimate-0%-item regression test; added a genuinely-unresolvable-item fixture (`item-zero` now has no `tax_percentage`/`tax_id`/rule) and a real-zero-rate fixture (`item-zero-rated`)
- `zoho-middleware/__tests__/catalog.test.js` - added a dedicated BC PST+GST compound-tax (`tax_percentage === 12`) pin test in the existing "tax rule enrichment" describe block, using the live INV-000160 item shape
- `zoho-middleware/__tests__/pos-precharge-assertion.test.js` (new) - pre-charge assertion suite (mismatch/match/absent/non-finite) + confirm-path orphan-guard suite (unresolved tax with/without an existing terminal charge); mock block cloned from `pos-money-defects.test.js`

## Decisions Made
- **Field names:** `client_grand_total` (asserted, tolerance $0.01) and `client_tax_total` (sent for observability only, never asserted or trusted for pricing) — pinned in the `interface_contract` block of the plan and in the pos.js doc comment so 67-02 (frontend) has an exact contract to implement against.
- **NaN-preserving resolution over `|| 0`:** an explicit `tax_percentage: 0` (real zero-rated item) must never be conflated with a missing value. This is the root ambiguity the live incident exposed — the old code treated both as "falsy" and applied the 5% guess.
- **Path-split fail-closed handling:** the sale path (`processSale`) has no charge yet, so an early `res.status(400)` is correct and simplest. The confirm path (`runConfirm`) may be reconciling a charge that already ran on the physical terminal, so the same "early return" pattern would silently orphan money — a tagged throw into the chain, landing in the existing outer `.catch`'s void-on-failure logic, was required instead.
- **Assertion placement:** inside `processSaleWithPrices`, immediately after the existing `grandTotal <= 0` / `> 10000` guards and before the gift-card balance lookup / Helcim terminal push — the earliest point with both `grandTotal` and `idempotencyKey` in scope, matching the WR-03 "safe-to-retry-immediately" rejection shape used for terminal-push failures.
- **CLAUDE.md rule 10 exception applied:** the two `pos-tax.test.js` tests asserting the old 5%-fallback contract were updated (not left as-is) per the explicit owner-approved exception in `67-CONTEXT.md` — they were pinning behavior the phase's decision "Remove all three silent 5% fallbacks" explicitly removes.

## Deviations from Plan

None — plan executed exactly as written (REVISED version, with the confirm-path tagged-throw handling already specified). No Rule 1-4 auto-fixes were needed; the plan's `<read_first>` sections and pattern map were accurate enough that no blocking issues, missing functionality, or architectural surprises came up during implementation.

## Issues Encountered

None. The RED phase (Task 1) produced exactly the expected 5 failing tests against unmodified `pos.js` (2 updated pinned tests, 1 pre-charge mismatch test, 2 confirm-path void tests) with all other new tests (legitimate-0%, match-within-tolerance, absent, non-finite) already passing since they were back-compat scenarios. Task 2's implementation turned all of those green except the pre-charge assertion test (by design, since Task 2 doesn't touch that code path). Task 3 closed the remaining gap. No `npm ci` or dependency issues — the worktree had no `node_modules` and both root and `zoho-middleware` installed cleanly from the existing lockfiles.

## User Setup Required

None — no external service configuration required. This is a pure middleware code change with no new environment variables, no new dependencies, and no infrastructure changes.

## Next Phase Readiness

- **This plan is safe to deploy to production ahead of the frontend (67-02):** every change is backward-compatible with the currently-deployed kiosk JS. `client_grand_total`/`client_tax_total` are optional — the assertion is a no-op until 67-02 starts sending them. The `computeTax` fail-closed change only rejects sales for catalog items that were already broken (unresolvable tax data); it does not change behavior for any correctly-configured item, including legitimate 0%-taxed items.
- **67-02 (frontend) can now implement against a pinned contract:** send `client_grand_total: totals.total` (and `client_tax_total: totals.tax` for observability) on `POST /api/kiosk/sale`, matching the `interface_contract` in `67-01-PLAN.md` and the pos.js doc comment above the route.
- **Full middleware suite green:** 86 suites / 1340 tests, `pos.js` line coverage 81.58% (floor 80%). Root `npm run lint` and `npm test` (69 suites / 1036 tests) also green. `cd zoho-middleware && npm run lint` clean.
- No blockers for 67-02. The client-side missing-tax detection, cart-lifecycle catalog freshness hooks, and frontend regression tests are scoped to that plan and were intentionally left untouched here.

## Self-Check: PASSED

All created/modified files verified present; all 4 task/summary commit hashes (`568c312b`, `9df7ebeb`, `3f2fa659`, `b4fffec3`) verified in git log.

---
*Phase: 67-kiosk-tax-quote-charge-correctness-pre-charge-total-assertio*
*Completed: 2026-07-30*
