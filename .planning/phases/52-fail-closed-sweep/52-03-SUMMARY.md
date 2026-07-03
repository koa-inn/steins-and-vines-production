---
phase: 52-fail-closed-sweep
plan: 03
subsystem: payments
tags: [express, zoho-books, helcim, fail-closed, gift-cards, kiosk-pos]

# Dependency graph
requires: []
provides:
  - Legacy `POST /api/pos/sale` quarantined (410 Gone, no terminal call reachable)
  - Gift-card clearing customerpayment fails closed when `ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID` is unset (no hardcoded ledger fallback)
affects: [52-01, 52-02, 52-04, 52-05, kiosk-money-path, gift-card-lifecycle]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Quarantine-not-delete for dead money-path routes: hard-error BEFORE any terminal/charge call, preserve the old body (unreachable) below the early return for audit trail"
    - "Env-required fail-closed pre-flight check placed immediately after the guarded value (gcApplied) is finalized, before any Zoho/terminal side effect — mirrors the adjacent CR-02 discriminated-result void-then-reject precedent instead of introducing a new failure idiom"

key-files:
  created:
    - zoho-middleware/__tests__/pos-sale-quarantine.test.js
    - zoho-middleware/__tests__/giftcard-account-failclosed.test.js
  modified:
    - zoho-middleware/routes/pos.js

key-decisions:
  - "M2: grep-confirmed dead (`grep -rn \"pos/sale\" js/` → zero frontend callers) → quarantined to 410 Gone, not deleted (audit trail); old orphan-prone body left unreachable below the early return per plan guidance (no-unreachable is not an enabled lint rule in this repo's eslint.config.js, so this doesn't trip `npm run lint`)"
  - "M3: pre-flight fail-closed check placed in the /confirm handler right after gcApplied is finalized (before invoice creation), not in /sale — the physical terminal charge (if any) has already happened by the time /confirm runs (pushed by a prior /sale request), so true pre-charge prevention isn't architecturally available within /confirm; the code mirrors the CR-02 gcConfirmLookup 'invalid' precedent immediately above it (void the terminal charge via moneyPath.voidWithTimeout, then reject) rather than the giftCardActivationFailed post-invoice flag idiom, because this check runs BEFORE the Zoho invoice is created — so no invoice/payment is ever posted to a guessed ledger, and any terminal charge already pushed is unwound"

requirements-completed: [RESIL-01]

# Metrics
duration: 25min
completed: 2026-07-03
---

# Phase 52 Plan 03: Legacy POS Sale Quarantine + Gift-Card Clearing Account Fail-Closed Summary

**Quarantined the dead legacy `/api/pos/sale` orphan-charge route to a pre-charge 410, and made the kiosk gift-card clearing customerpayment refuse to post to a guessed Zoho ledger account when `ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID` is unset — voiding any terminal charge already pushed instead.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-03 (worktree HEAD f1ad157)
- **Completed:** 2026-07-03
- **Tasks:** 2/2 completed
- **Files modified:** 1 (`zoho-middleware/routes/pos.js`)
- **Files created:** 2 (test files)

## Accomplishments

- **M2 — Legacy `/api/pos/sale` quarantined.** Grep-confirmed dead (`grep -rn "pos/sale" js/` → zero frontend callers; only docs/openapi/server.js-mount/route-def reference it). The route now returns `410 Gone` with `{ error: 'Legacy POS sale endpoint retired — use /api/kiosk/sale' }` before any `helcimLib` call, eliminating the class of invisible orphan charge the old "non-fatal" Zoho-failure swallow produced. The `paymentLimiter` mount on `/api/pos/sale` in `server.js` stays (now harmlessly rate-limits a 410 endpoint).
- **M3 — Gift-card clearing account fails closed.** Removed the hardcoded fallback ledger `'109900000000873231'` from the `/api/kiosk/sale/confirm` Payment-2 block. Added a pre-flight check: when a gift-card redemption is in play (`gcApplied > 0 && gcCertNum`) but the env var is unset, the handler voids any terminal charge already pushed (`moneyPath.voidWithTimeout`) and returns `503` before ever creating the Zoho invoice — no customerpayment can post to a guessed account. The env-set path is byte-behavior-identical (same account_id value, now read once into `gcClearingAccount`).
- Both fixes are covered by new regression tests; the full middleware suite grew from the 62-suite/1187-test baseline to 64 suites / 1195 tests, all green.

## Task Commits

Each task was committed atomically:

1. **Task 1: M2 — grep-confirm dead, then quarantine legacy /api/pos/sale** — `2d6c3e9` (fix)
2. **Task 2: M3 — gift-card clearing account fails closed when env unset** — RED `5527b13` (test) → GREEN `b04e4d0` (fix)

_TDD task (Task 2) has two commits: failing test (RED) then implementation (GREEN), per plan spec._

## Files Created/Modified

- `zoho-middleware/routes/pos.js` — quarantined `POST /api/pos/sale` (410 before any `helcimLib` call, old body left unreachable for audit trail); added the M3 pre-flight fail-closed check in `/api/kiosk/sale/confirm` (right after `gcApplied`/`terminalApplied` are computed) and removed the hardcoded `109900000000873231` fallback from the Payment-2 `customerpayments` call
- `zoho-middleware/__tests__/pos-sale-quarantine.test.js` — asserts `POST /api/pos/sale` returns 410, never calls `helcimLib.isTerminalEnabled`/`terminalPurchase`, and never calls `zohoApi.zohoPost` (no orphan-charge write path reachable), including with a malformed/empty body
- `zoho-middleware/__tests__/giftcard-account-failclosed.test.js` — asserts (env unset) no customerpayment ever carries the literal `109900000000873231` account_id, no Zoho invoice is created at all, and the already-pushed terminal charge is voided via `moneyPath.voidWithTimeout`; asserts (env set) the clearing payment still posts with the real env `account_id` — preserved behavior

## Deviations from Plan

None — plan executed exactly as written. Both M2 and M3 followed the grep-first / TDD-first sequencing and acceptance criteria specified in `52-03-PLAN.md`.

One implementation-detail note (not a deviation, documented for traceability): the plan's M3 action text said "prefer the pre-charge position... if the code structure forces a post-charge discovery, mirror the `giftCardActivationFailed` idiom." Investigation of the confirm handler showed the terminal charge (when `terminalApplied > 0`) has always already been pushed by a prior `/api/kiosk/sale` request before `/confirm` runs — true pre-charge prevention isn't available from within `/confirm` alone. The chosen implementation instead mirrors the CR-02 `gcConfirmLookup === 'invalid'` void-then-reject pattern immediately above the insertion point, which is strictly better than the `giftCardActivationFailed` flag-and-proceed idiom: it runs **before** Zoho invoice creation (so nothing ever posts, not even a paid-but-flagged invoice) and actively unwinds the terminal charge via `moneyPath.voidWithTimeout` rather than merely flagging for manual review after the money has already moved through Zoho. This satisfies the acceptance criteria (no invoice created, no customerpayment with the hardcoded account_id, redemption fails closed) with a stronger guarantee than the fallback idiom the plan anticipated as a fallback.

## Verification Results

- `cd zoho-middleware && npx jest __tests__/pos-sale-quarantine.test.js __tests__/giftcard-account-failclosed.test.js` — 2 suites / 8 tests pass
- `cd zoho-middleware && npm test` — 64 suites / 1195 tests pass (full baseline green; grew from 62/1187 by the 2 new suites/8 new tests)
- `cd zoho-middleware && npm run lint` — 0 errors (60 pre-existing warnings, none introduced by this plan, none in files touched by this plan's line changes)
- `grep -n "873231" zoho-middleware/routes/pos.js` — no matches (hardcoded fallback fully removed)

## Known Stubs

None.

## Threat Flags

None. Both fixes close existing threat-register entries (T-52-M2, T-52-M3) from this plan's own `<threat_model>` — no new surface introduced.

## Issues Encountered

- `zoho-middleware/node_modules` was absent in this fresh worktree (`npm test` initially failed with `Cannot find module 'express'`). Ran `npm install` (restoring already-declared `package.json` dependencies, not introducing any new package) — this is standard environment setup, not a Rule-3-excluded new-package install.

## Next Phase Readiness

- M2 and M3 (the two `pos.js` findings from Phase 52's RESIL-01 audit sweep) are closed. Remaining Phase 52 wave-1 plans (52-04: items.js `:id` validation + taxes.js SSRF allowlist; 52-05: catalog.js `?bust=1` auth + recipes/gift-cards auth+cache) are independent, file-disjoint, and unaffected by this plan's changes.
- 52-02 (wave 2, depends on 52-01's shared `redis-guard` helper) is unaffected by this plan.
