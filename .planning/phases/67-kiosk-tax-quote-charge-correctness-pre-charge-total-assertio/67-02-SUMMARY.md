---
phase: 67-kiosk-tax-quote-charge-correctness-pre-charge-total-assertio
plan: 02
subsystem: kiosk-frontend
tags: [tax, fail-closed, kiosk-core, catalog-freshness, client-totals, jest, tdd]

# Dependency graph
requires:
  - phase: 67-01
    provides: middleware pre-charge assertion + pinned interface contract (client_grand_total asserted / client_tax_total observability-only)
  - phase: 57-03
    provides: phantom-item guard shape ("detect bad cart line, name it, block checkout" via kioskShowError) and keep-last-good kioskLoadProducts resilience
  - phase: 48 (de-fork)
    provides: kiosk-core.js single source of truth for cart/payment logic across kiosk.js/admin.js
provides:
  - "Client-side fail-closed missing-tax gate: missing/unparseable tax_percentage flags the item by name in kioskCalcTotals (totals.missingTaxItem) and blocks checkout in kioskProceedToPayment via kioskShowError — the silent 5% fallback (KIOSK_TAX_RATE_DEFAULT) is deleted"
  - "kioskItemTax consistency: missing tax returns NaN (visible data error), never a silent $0.00; explicit 0% remains valid"
  - "standardSaleBody carries client_grand_total (= totals.total) and client_tax_total (= totals.tax) for the 67-01 server pre-charge assertion"
  - "Cart-lifecycle catalog freshness: kioskStartCheckout fires kioskLoadProducts(true) so a parked kiosk re-fetches before quoting checkout; keep-last-good on failure inherited"
affects: [phase-67-verification, kiosk-deploy-ordering]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Detect-in-pure-calc, block-at-checkout-entry: kioskCalcTotals (runs on every render) only DETECTS and returns missingTaxItem; the UI block lives in kioskProceedToPayment, mirroring the 57-03 phantom guard"
    - "Gate ordering: missing-tax gate runs AFTER the phantom-item guard so an item absent from the catalog reports its root cause (Item Unavailable) before the derived symptom (Tax Unavailable)"

key-files:
  created:
    - tests/frontend/kiosk-missing-tax.test.js
  modified:
    - js/kiosk-core.js
    - js/kiosk-core.min.js
    - kiosk.html
    - admin.html
    - tests/frontend/kiosk-catalog-freshness.test.js
    - tests/frontend/kiosk-sale-beacon-servererror.test.js
    - tests/frontend/kiosk-html-escaping.test.js

key-decisions:
  - "Totals field name: missingTaxItem (name/id of the FIRST offending cart line, null when all lines have a valid numeric tax_percentage incl. 0) — encoded first in the RED tests as the contract, then implemented"
  - "Cart-lifecycle hook wired at kioskStartCheckout (cart→customer transition), placed after the empty-cart guard and BEFORE the terminal-ready check so any genuine checkout attempt refreshes even while terminal status is being sorted"
  - "Missing-tax gate placed AFTER the 57-03 phantom guard in kioskProceedToPayment — a phantom item reports 'Item Unavailable' (root cause) rather than 'Tax Unavailable' (symptom)"
  - "kioskItemTax returns NaN for the missing case — safe because it has NO live invocation (exported as itemTax, aliased in kiosk.js:82 / admin.js:9927, never called)"
  - "client_grand_total/client_tax_total added to standardSaleBody ONLY — recipeSaleBody untouched (assertion scoped to /api/kiosk/sale per plan/CONTEXT)"

patterns-established:
  - "Fail-closed client tax: tax is only ever computed from a numeric tax_percentage; a missing value blocks the sale by name — never a default guess (matches 67-01 server doctrine)"

requirements-completed: [KIOSK-TAX-QUOTE-01]

# Metrics
duration: ~25min (incl. session-limit interruption and resume)
completed: 2026-08-04
---

# Phase 67 Plan 02: Kiosk Frontend Tax Correctness + Client Totals + Catalog Freshness Summary

**Removed the kiosk client's silent 5% tax fallback (missing tax now flags the item by name and blocks checkout fail-closed), put the displayed totals (client_grand_total/client_tax_total) on every standard sale POST for the 67-01 server pre-charge assertion, and wired a force catalog refresh at checkout entry so a parked kiosk can no longer quote from a stale snapshot — closing the client half of the INV-000160 quote≠charge seam.**

## Performance

- **Duration:** ~25 min wall (interrupted by an API session limit mid-read and resumed; commit-to-commit ~4 min)
- **Completed:** 2026-08-04
- **Tasks:** 3 (TDD: RED → GREEN → GREEN)
- **Files modified:** 8 (1 created, 7 modified)

## Accomplishments

- `kioskCalcTotals` no longer guesses 5% when a cart line's `tax_percentage` is missing/unparseable: the line contributes 0 tax and the returned totals object carries `missingTaxItem` (the item's name/id). Detection is calc-side only — `kioskCalcTotals` runs on every cart render and must stay pure; the block happens at checkout entry.
- `kioskProceedToPayment` blocks checkout via `kioskShowError('Tax Unavailable', ...)` naming the item with staff-actionable copy ("Refresh the product list and re-add it, then try again", retry-enabled) — the exact 57-03 phantom-guard shape, placed immediately after that guard.
- `kioskItemTax` reconciled: `parseFloat(item.tax_percentage) || 0` → NaN-preserving; a missing value now returns `NaN` instead of silently rendering `$0.00`. Grep-verified NO live invocation exists (exported as `itemTax`, aliased in `kiosk.js:82` / `admin.js:9927`, never called) so the return-contract change is safe.
- `KIOSK_TAX_RATE_DEFAULT` deleted (declaration + its only reader); `grep KIOSK_TAX_RATE_DEFAULT js/kiosk-core.js` returns nothing.
- `standardSaleBody` now sends `client_grand_total: totals.total` and `client_tax_total: totals.tax` — exact field names pinned by the 67-01 interface contract. `recipeSaleBody` intentionally untouched. Deploys cleanly after 67-01 (the live middleware already asserts when the fields are present, ignores when absent).
- `kioskStartCheckout` fires `kioskLoadProducts(true)` (fire-and-forget) on the cart→customer transition — the cart-lifecycle point the New Sale button does not cover. Keep-last-good on a failed refresh is inherited from `kioskLoadProducts` (no new error handling; a failed refresh never wipes the grid — regression-pinned by freshness Test E's post-refresh assertions). No periodic polling added (CONTEXT decision; 30-min server cache TTL respected).
- `js/kiosk-core.min.js` regenerated via terser (`npm run build`), never hand-edited; single-line minified output containing `client_grand_total` verified.

## Task Commits

Each task was committed atomically (TDD plan: Task 1 RED, Tasks 2-3 GREEN):

1. **Task 1: RED — failing tests for missing-tax block, client totals, cart-lifecycle refresh** - `409ec4a3` (test)
2. **Task 2: remove 5% fallback, missing-tax gate, kioskItemTax NaN, client totals on sale body** - `93eedd91` (feat)
3. **Task 3: cart-lifecycle catalog refresh + terser-rebuilt min artifact + scoped stamps** - `5bbeafe8` (feat)

## TDD Gate Compliance

- RED gate: `409ec4a3` (`test(...)`) — 6 assertions failed against unmodified kiosk-core.js (missing tax computed 5%; itemTax returned 0; no block; no client_* fields; no checkout-time refresh), all pre-existing tests green.
- GREEN gates: `93eedd91` + `5bbeafe8` (`feat(...)`) — all 13 tests in the two target suites pass; full suites green.
- No REFACTOR commit needed.

## Files Created/Modified

- `js/kiosk-core.js` — 5% fallback removed; `missingTaxItem` detection in `kioskCalcTotals`; checkout block in `kioskProceedToPayment`; NaN-preserving `kioskItemTax`; `client_grand_total`/`client_tax_total` on `standardSaleBody`; `kioskLoadProducts(true)` at `kioskStartCheckout`; dead constant deleted
- `js/kiosk-core.min.js` — regenerated by terser via `npm run build`
- `kiosk.html` / `admin.html` — `kiosk-core.min.js?v=` cache-buster bumps ONLY (all other assets' stamp bumps reverted per 64-02/64-03 precedent)
- `tests/frontend/kiosk-missing-tax.test.js` (new) — 8 tests: calc flags missing/non-numeric tax by name + 0 contribution; valid 0% never flagged; itemTax NaN consistency; checkout blocked via kioskShowError naming the item, no sale POST; well-taxed cart not blocked
- `tests/frontend/kiosk-catalog-freshness.test.js` — extended with Test D (sale body carries client_grand_total/client_tax_total matching displayed totals through the real GC-panel→terminal-push path) and Test E (kioskStartCheckout fires the ?bust=1 force refresh; grid kept)
- `tests/frontend/kiosk-sale-beacon-servererror.test.js` / `tests/frontend/kiosk-html-escaping.test.js` — fixture-only updates (see Deviations)

## Decisions Made

- **`missingTaxItem` as the totals-object contract field** — defined in the RED tests first, first-offender-wins (one blocking error at a time, matching how the phantom guard reports one item per attempt).
- **Hook point = `kioskStartCheckout`, before the terminal-ready check** — refresh fires on any genuine checkout attempt (non-empty cart), even if the terminal check bounces the user; by the time staff finish the customer step the fresh catalog has typically landed, and the missing-tax/phantom gates at `kioskProceedToPayment` then run against fresh data.
- **Gate ordering (missing-tax AFTER phantom guard)** — the plan allowed placement "right where the phantom guard runs"; running after it means an item that is both absent from the catalog AND tax-less reports the root cause ("Item Unavailable") instead of the derived symptom.
- **Kept `?v=` stamps scoped** — the project stamp scripts bump every asset in kiosk.html/admin.html to one version; the non-kiosk-core bumps were reverted so the shipped diff is exactly the plan's declared files (64-02/64-03 precedent).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixture-only updates to two pre-existing test files**
- **Found during:** Task 2 (full-suite run before commit)
- **Issue:** `kiosk-sale-beacon-servererror.test.js` and `kiosk-html-escaping.test.js` use cart fixtures that incidentally lack `tax_percentage` (they previously rode the silent 5% fallback). The new fail-closed gate blocked checkout before the orthogonal behaviors those tests pin (server-error beacon pass-through; payment-screen HTML escaping) could execute.
- **Fix:** Added explicit `tax_percentage: 5` to the fixtures (preserving the exact totals the old fallback produced) with a 67-02 comment. NO assertions were changed — the pinned contracts are untouched and still exercised.
- **CLAUDE.md rule 10 note:** These are fixture repairs required by the phase's deliberate behavior change, the same class of update 67-01 applied middleware-side under the 67-CONTEXT-approved exception ("Remove all three silent 5% fallbacks" necessarily invalidates fixtures that depended on the fallback). Flagging here for the verifier.
- **Files modified:** tests/frontend/kiosk-sale-beacon-servererror.test.js, tests/frontend/kiosk-html-escaping.test.js
- **Commit:** `93eedd91`

No other deviations — tasks otherwise executed as written.

## Issues Encountered

- Execution was interrupted mid-read by an API session limit and resumed cleanly (no lost work; worktree intact at base).
- The plan's acceptance grep (`grep KIOSK_TAX_RATE_DEFAULT` returns nothing) initially failed because my explanatory comments named the removed constant — reworded to avoid the literal identifier.

## Known Stubs

None — no placeholder values, empty-data wirings, or TODO/FIXME markers introduced.

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary surface beyond the plan's threat model (T-67-06 covers the new client_* fields: display values asserted, never trusted).

## User Setup Required

None. Deploy ordering only: this frontend change must reach staging/production AFTER 67-01's middleware (already the case — 67-01 shipped in wave 1 and is backward-compatible; an old server would simply ignore the extra fields).

## Verification

- Full frontend suite: **1046/1046 pass** (70 suites), incl. the 13 tests across kiosk-missing-tax + kiosk-catalog-freshness.
- Full middleware suite: **1340/1340 pass** (86 suites) — unchanged, run per CLAUDE.md rule 1.
- `npm run lint` (`eslint js/ --max-warnings 0`): clean.
- `grep KIOSK_TAX_RATE_DEFAULT js/kiosk-core.js` → nothing; `client_grand_total`/`client_tax_total` present in `standardSaleBody` only; `missingTax` detection + block present; `kioskLoadProducts(true)` at `kioskStartCheckout` (line 2415).
- `js/kiosk-core.min.js` is single-line terser output (0 newlines) containing `client_grand_total`; final diff limited to the declared files + the two fixture files (deviation), zero deletions, zero untracked leftovers.

## Next Phase Readiness

- Both halves of the INV-000160 fix are now code-complete: server asserts (67-01, live-ready), client sends displayed totals + fail-closed tax + checkout-time freshness (this plan).
- 67-03 (or phase verification) can proceed; no blockers. Deploy staging-first per repo policy.

## Self-Check: PASSED

All created/modified files verified present; all 3 task commit hashes (`409ec4a3`, `93eedd91`, `5bbeafe8`) verified in git log.

---
*Phase: 67-kiosk-tax-quote-charge-correctness-pre-charge-total-assertio*
*Completed: 2026-08-04*
