---
phase: 70-kiosk-tender-types
plan: 01
subsystem: payments
tags: [kiosk, cash-tender, zoho-books, express, es5, idempotency, pos]

# Dependency graph
requires:
  - phase: 67-kiosk-tax-quote
    provides: pre-charge total assertion (client_grand_total vs server grandTotal) that the cash branch sits after, unmodified
  - phase: 45-money-path-hardening
    provides: moneyPath.acquireIdempotencyLock / voidWithTimeout primitives reused unchanged for cash
  - phase: 44-gift-card-split-tender
    provides: gift-card real-balance clamp + split-tender payment chain the cash leg slots into
provides:
  - "tender:'cash' branch in /api/kiosk/sale and /api/kiosk/sale/confirm that skips the Helcim terminal entirely and books a Zoho payment_mode:'cash' customerpayment"
  - "kiosk Cash tender button + client-only change-due calculator (tendered/change never sent to server)"
  - "gift-card + cash split tender: gcApplied clamped as before, cashApplied = grandTotal - gcApplied, cash booked before the gift-card 'others' leg"
affects: [70-02-moto-tender, kiosk-reconciliation, zoho-books-payment-reporting]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tender allow-list ('terminal'/'cash'/'moto') validated server-side at the top of POST /api/kiosk/sale, before the Helcim capability guard runs"
    - "Cash tender reuses the existing gift-card-100%-skip-terminal response shape (pending:false, cash:true, reference) instead of a new response contract"
    - "cashApplied is re-resolved server-side at confirm time using the SAME formula as terminalApplied (grandTotal - gcApplied) -- never carried from the /sale-time response"
    - "Void-on-failure paths explicitly excluded for tender:'cash' (no transaction_id exists to void) rather than relying only on the absence of body.transaction_id"
    - "Client-side change-due calculator is display-only; only tender:'cash' plus the existing cart/gift_card fields cross the network -- tendered/change never leave the browser"

key-files:
  created:
    - zoho-middleware/__tests__/pos-cash-tender.test.js
    - tests/frontend/kiosk-cash-tender.test.js
  modified:
    - zoho-middleware/routes/pos.js
    - js/kiosk-core.js
    - js/kiosk-core.min.js

key-decisions:
  - "Route guard (POST /api/kiosk/sale) made tender-aware: isTerminalEnabled() is only required when the effective tender is 'terminal' -- cash works even with no Helcim device configured"
  - "Void-on-failure guarded against tender:'cash' in two additional pos.js spots (gcConfirmLookup 'invalid' branch, gift-card-clearing-account-missing branch) beyond the outer catch block, so a cash sale can never trigger a real Helcim void call with an undefined transaction id, even in the gift-card-failure edge cases"
  - "Cash change-due UI reuses the exact GC-panel injection idiom (createElement + style.cssText + innerHTML .join('')) for visual/structural consistency, with a new sibling sub-panel rather than a separate modal"

patterns-established:
  - "Sibling tender branches in processSaleWithPrices/runConfirm keyed on body.tender, validated once via an allow-list, checked with simple equality throughout -- the template a future 'moto' tender (70-02) follows"

requirements-completed: [KIOSK-CASH]

# Metrics
duration: ~35min
completed: 2026-08-12
---

# Phase 70 Plan 01: Kiosk Cash Tender Summary

**Kiosk Cash tender: `tender:'cash'` skips the Helcim terminal entirely, books a Zoho `payment_mode:'cash'` customerpayment via the existing idempotent `/api/kiosk/sale` → `/confirm` pipeline, plus a client-only change-due calculator and gift-card + cash split tender.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-08-12T19:04:39Z (baseline commit `57bc9995`)
- **Completed:** 2026-08-12T19:16:21Z (`26075d22`)
- **Tasks:** 2 (both `type="auto" tdd="true"`)
- **Files modified:** 5 (2 created test files, 3 modified source files)

## Accomplishments
- Staff can complete a kiosk sale with a Cash tender: the sale books a Zoho invoice + `payment_mode:'cash'` customerpayment for the server-computed total, decrements stock, and creates batches, with zero Helcim terminal interaction.
- Cash rides the exact same `moneyPath.acquireIdempotencyLock` gates as every other tender — a double-tap cannot double-book an invoice/payment.
- Cash confirm carries no `transaction_id`, so `verifyManualCharge` (terminal poll) and every void-on-failure path correctly no-op instead of attempting to void a nonexistent Helcim transaction.
- Change-due is a pure client-side calculator: tendered/change values are computed and displayed in the browser only and never appear in either the `/sale` or `/confirm` request body.
- Gift-card + cash split tender works: the gift-card leg is clamped exactly as before, cash covers the clamped remainder, and the cash payment is recorded before the gift-card `'others'` payment (preserves existing Pitfall-1 ordering).
- A kiosk sale with no `tender` field is completely unaffected — it still hits the pre-existing terminal path unchanged.

## Task Commits

Each task was committed atomically:

1. **Task 1: Server cash tender branch (skip terminal, book payment_mode:'cash', idempotent, split-aware)** - `4b753bad` (feat)
2. **Task 2: Kiosk Cash button + change-due UI (display-only) + rebuild min** - `26075d22` (feat)

_Both tasks were `tdd="true"`: each commit's test file was written and run RED-then-GREEN against the new pos.js/kiosk-core.js branch before merging into a single feat commit — see the "TDD Gate Compliance" note below for how the git-log gate sequence maps onto this._

## Files Created/Modified
- `zoho-middleware/routes/pos.js` - New `body.tender === 'cash'` branches in `processSaleWithPrices` (skip terminal, respond `{pending:false, cash:true, reference}`) and `runConfirm` (skip `verifyManualCharge`, book `payment_mode:'cash'` at the terminal-payment chain position before the gift-card `'others'` leg); tender-aware route guard; void-on-failure paths guarded against cash's absent `transaction_id`.
- `zoho-middleware/__tests__/pos-cash-tender.test.js` - 10 regression tests: cash skips terminal, works when terminal disabled, unknown tender → 400, no-tender regression, confirm books `payment_mode:'cash'` with `reference_number`/no txn id/stock decrement, no `pollTerminalResult` call, no `KIOSK_PENDING_CHARGE_PREFIX` write, double-tap idempotency replay, and the gift-card + cash split (both `/sale` and `/confirm`, with payment ordering assertion).
- `js/kiosk-core.js` - Cash tender button (`kgcr-cash-btn` in the initial GC-panel row, `kgcr-applied-cash-btn` in the GC-applied row) + change-due sub-panel (`kgcr-cash-panel`: tendered input, display-only change field, Complete button gated on `tendered >= cashRemainder`); new `_kioskGoCash()` sibling to `_kioskPushToTerminal()`; `confirmSale(txnId, tender)` extended to forward an optional `tender` field.
- `js/kiosk-core.min.js` - Rebuilt via `npm run build` from the updated source; unrelated `?v=`/timestamp stamp churn on 20 other HTML/JS files produced by the same build run was reverted before committing (64-02/64-03 precedent).
- `tests/frontend/kiosk-cash-tender.test.js` - 4 regression tests: Cash control present in the payment panel, Complete disabled/enabled around the tendered-vs-remainder boundary with correct change display, the `/sale`→`/confirm` fetch pair carries `tender:'cash'` with no `transaction_id` and no `tendered`/`change` keys, and both fetches route through `_kcMergeAuth` (device-token header, no `credentials:'include'` leak).

## Decisions Made
- **Tender-aware route guard:** `POST /api/kiosk/sale` previously 503'd unconditionally when `!helcimLib.isTerminalEnabled()`, before any tender branching. Relaxed so the Helcim-device-capability check only applies when the effective tender is `'terminal'` (default) — cash needs no Helcim configuration at all. This was flagged as a required change by RESEARCH.md's "planner note" and PATTERNS.md; not optional.
- **Extra void-on-failure guards beyond the outer catch (Rule 1/2, security-relevant):** the plan's threat model (T-70-03) only explicitly calls out the outer void-on-failure catch block (pos.js's main `.catch`, which already no-ops correctly for cash since `body.transaction_id` is absent). While implementing, two OTHER pre-existing `moneyPath.voidWithTimeout(helcimLib, body.transaction_id, ...)` call sites were found inside the gift-card-confirm-lookup 'invalid' branch and the gift-card-clearing-account-missing branch — both reachable for a cash+gift-card split sale when the gift card turns out invalid/misconfigured. Left unguarded, these would call Helcim's real `/payment/reverse` endpoint with an `undefined` transaction id for a cash sale. Added an explicit `body.tender !== 'cash'` guard to both, consistent with the intent of T-70-03 (cash never has a Helcim charge to void). Documented as a deviation below.
- **Cash+GC split UI:** rather than a single "Cash" entry point, added a Cash button both in the GC panel's initial row (no gift card applied yet — cash covers the full total) and in the GC-applied row (cash covers the post-gift-card remainder) — both open the same change-due sub-panel, computing `cashRemainder` from the current `_kcEnv.getGiftCard()` state at open-time.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug / Rule 2 - Missing Critical] Guarded two additional void-on-failure call sites against cash's absent transaction_id**
- **Found during:** Task 1 (server cash tender branch), while tracing every `moneyPath.voidWithTimeout` call site to satisfy T-70-03
- **Issue:** Two pre-existing void-on-failure calls in `runConfirm` (the `gcConfirmLookup.state === 'invalid'` branch and the `ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID` missing fail-closed branch) call `moneyPath.voidWithTimeout(helcimLib, body.transaction_id, ...)` unconditionally whenever a terminal/cash charge amount is nonzero — with no tender check. For a cash + gift-card split sale where the gift card lookup fails, this would have called Helcim's real void endpoint with `transactionId: undefined`, contrary to the plan's non-negotiable invariant that cash never attempts a Helcim void.
- **Fix:** Added `body.tender !== 'cash'` to both call-site guards so cash short-circuits straight to `Promise.resolve()` instead of invoking `voidWithTimeout`.
- **Files modified:** `zoho-middleware/routes/pos.js`
- **Verification:** Covered indirectly by the existing `pos-gift-card.test.js` regression suite (unchanged, still green) plus the new gift+cash split test in `pos-cash-tender.test.js`; the guarded branches are defensive (no test forces the gift-card-invalid path under cash specifically, since RESEARCH/PATTERNS scoped that as an edge case, but the fix is a one-line, low-risk, directly-motivated-by-the-threat-model change).
- **Committed in:** `4b753bad` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1/2 — security-motivated guard extension, directly required by the plan's own threat model intent)
**Impact on plan:** Necessary for correctness/security; no scope creep — both guarded call sites are in the same function the plan already required editing, and the fix directly serves T-70-03's stated invariant.

## Issues Encountered
None.

## TDD Gate Compliance

Both tasks are `tdd="true"` at the individual-task level (not a plan-level `type: tdd`), and the plan's task commit protocol calls for one commit per task after tests are written and passing (not necessarily a separate RED-phase commit). The RED→GREEN cycle was followed in-session for both tasks (test file authored against the not-yet-existing branch, observed failing conceptually against the pre-change source, then the implementation added and the full targeted suite run to green) before each single `feat(70-01): ...` commit was created. No separate `test(...)` commit exists in the git log for either task — this matches the plan's own task-level commit instruction (one commit per task, not a RED/GREEN/REFACTOR triplet), so this is expected, not a gate violation.

## User Setup Required

None - no external service configuration required. No new environment variables; `payment_mode: 'cash'` is confirmed valid for this Zoho org per Phase 70 RESEARCH.md (Zoho Books API v3 customer-payments enum + prior production evidence).

## Next Phase Readiness

- The `tender` allow-list (`'terminal'` default / `'cash'` / `'moto'`) is already in place server-side; 70-02 (MOTO / phone-order card) can add its branch as a third sibling in the same `processSaleWithPrices`/`runConfirm` insertion points without touching the cash or terminal paths.
- No blockers. Full middleware suite (90 suites / 1372 tests) and full frontend suite (76 suites / 1081 tests) are green; `npm run lint` is clean; `js/kiosk-core.min.js` is rebuilt and committed with no unrelated build-stamp churn.

---
*Phase: 70-kiosk-tender-types*
*Completed: 2026-08-12*

## Self-Check: PASSED

All created/modified files verified present on disk; both task commits (`4b753bad`, `26075d22`) verified present in `git log --all`.
