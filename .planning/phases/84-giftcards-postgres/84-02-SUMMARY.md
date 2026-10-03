---
phase: 84-giftcards-postgres
plan: 02
subsystem: api
tags: [apps-script, google-sheets, gift-cards, jest, tdd]

# Dependency graph
requires:
  - phase: 78-brewpad-waitlist-tracking
    provides: ensureWaitlistSheet empty-tab guard pattern (getLastColumn() === 0), reused verbatim
      for the GiftCardTransactions tab
  - phase: 51-gift-card-ledger-integrity
    provides: GiftCardTransactions 12-column ledger schema, acquireScriptLock/findRowById/
      sanitizeInput/normalizeCertNumber/roundGiftCardAmount helpers, GiftCards 10-column schema
provides:
  - ensureGiftCardLedgerSheet no longer throws on an existing-but-empty GiftCardTransactions tab
  - mirror_gift_card_state server_token Apps Script action — the D-04 post-flip copy-state mirror
    that 84's gift-card-store facade (other 84 plans) will call after GIFT_CARDS_STORE flips to
    postgres
affects: [84-03, 84-05, 84-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fake Apps Script runtime via new Function(src, ...globalShadows) for behavioural (not
      source-shape-only) Jest coverage of SpreadsheetApp/LockService/Utilities-dependent code"
    - "Idempotent ledger append keyed on (cert_number, tx_ref): scan existing rows via
      sheetToObjects(sheet, true) before appendRow, skip on match"

key-files:
  created:
    - tests/frontend/adminapi-giftcard-ledger-ensure-sheet.test.js
    - tests/frontend/adminapi-giftcard-mirror.test.js
  modified:
    - apps-script/adminApi.gs

key-decisions:
  - "mirrorGiftCardState validation errors map to the three contract codes exactly:
    missing_fields (cert_number absent or not /^GC-[0-9]{6}$/), invalid_amount (face_value or
    current_balance not numeric), invalid_status (outside active/depleted/void) — no new error
    codes invented beyond the documented contract"
  - "On a known-cert update, only current_balance/status/last_updated/zoho_invoice_number/
    last_tx_ref are written by header index; face_value/issued_date/issued_by are never touched,
    matching D-04's 'copy state, not business logic' boundary"
  - "last_tx_ref is only updated when ledger_entry is present — an invoice-number-only mirror call
    (ledger_entry: null) leaves the existing last_tx_ref untouched rather than clearing it"
  - "All text fields (issued_date, issued_by, zoho_invoice_number, notes, ledger tx_ref/kind/
    actor, the mirror: postgres note) are routed through sanitizeInput — the same mitigation
    every other gift-card write path in this file already uses, per T-84-09"

patterns-established:
  - "Pattern: extend the Task-1 fake-Sheets-runtime technique (SpreadsheetApp/Logger as
    new Function params) with LockService/Utilities fakes when a function under test needs a
    lock or Utilities.getUuid — keeps the whole call behaviourally testable outside Google's
    runtime instead of falling back to source-shape-only assertions"

requirements-completed: [DB-03]

# Metrics
duration: ~10min
completed: 2026-10-03
---

# Phase 84 Plan 02: Apps Script gift-card fixes Summary

**Fixed the `ensureGiftCardLedgerSheet` empty-tab crash and added the `mirror_gift_card_state` post-flip copy-state Apps Script action (D-04), both regression-tested with a fake Sheets/Lock/Utilities runtime.**

## Performance

- **Duration:** ~10 min (commit span 12:11:49–12:16:55 PT)
- **Tasks:** 2 completed (4 commits: test/fix for Task 1, test/feat for Task 2)
- **Files modified:** 3 (1 modified, 2 created)

## Accomplishments

- `ensureGiftCardLedgerSheet` no longer throws `"The number of columns in the range must be at
  least 1."` when the `GiftCardTransactions` tab exists but is completely empty — the exact Phase
  78 (`ensureWaitlistSheet`) fix pattern applied to the gift-card ledger tab. This closes the
  folded todo `giftcard-ledger-empty-tab-crash.md`; it matters immediately because D-01's dual
  window re-runs every real gift-card op against the sheet, so this crash would otherwise fire on
  every live redeem/reload/issue during `dual`.
- New `mirror_gift_card_state` server_token action: a pure row-upsert into `GiftCards` plus an
  idempotent ledger-row append into `GiftCardTransactions`, with zero Phase 51 business logic
  (no claim/settle, no balance arithmetic, no status rules). This is the mechanism D-04 needs once
  `GIFT_CARDS_STORE` flips to `postgres` — the sheet becomes a read-only mirror fed by this one
  action instead of by the real redeem/reload/issue/void/update handlers.
- No `adjust_gift_card` action was added (D-07 — confirmed by both the implementation and a
  dedicated negative test).

## Task Commits

Each task was committed atomically (RED/GREEN pairs per the plan's `tdd="true"` requirement):

1. **Task 1: Regression test then fix for ensureGiftCardLedgerSheet empty-tab crash**
   - `e2ca62ed` test(84-02): reproduce ensureGiftCardLedgerSheet empty-tab crash (RED)
   - `83efc074` fix(84-02): guard ensureGiftCardLedgerSheet against an empty tab (GREEN)
2. **Task 2: mirror_gift_card_state copy-state action (D-04)**
   - `0cab69ce` test(84-02): add behavioural coverage for mirror_gift_card_state (D-04) (RED)
   - `2881c74c` feat(84-02): add mirror_gift_card_state copy-state action (D-04) (GREEN)

_No separate plan-metadata commit — the orchestrator owns STATE.md/ROADMAP.md writes for this
wave; this SUMMARY.md and the final self-check are committed together below._

## Files Created/Modified

- `apps-script/adminApi.gs` — `ensureGiftCardLedgerSheet` empty-tab guard (insert-if-missing THEN
  a single `getLastColumn() === 0` guard, covering both the just-created and existing-blank
  cases); new `mirrorGiftCardState(payload)` function; new `mirror_gift_card_state` dispatch
  entry in `doPost`'s `server_token` block, registered next to the other gift-card actions
- `tests/frontend/adminapi-giftcard-ledger-ensure-sheet.test.js` — fake-Sheets-runtime regression
  suite for the four `ensureGiftCardLedgerSheet` bootstrap branches (missing tab, empty-but-existing
  tab, correctly-headered tab, drifted-header fail-closed case)
- `tests/frontend/adminapi-giftcard-mirror.test.js` — fake Sheets/LockService/Utilities runtime
  covering every `<behavior>` line: unknown-cert insert, known-cert update (and which columns stay
  untouched), idempotent skip on a repeated `(cert_number, tx_ref)`, `ledger_entry: null`
  invoice-only update, all three validation failure codes, `sanitizeInput` routing for a
  formula-injection `notes` value, and the dispatch/no-`adjust_gift_card` source assertions

## Decisions Made

See `key-decisions` in frontmatter. No decisions required deviating from the plan's `<action>`
instructions — the fix pattern, function shape, and dispatch wiring all matched the plan's
explicit prescriptions (which were themselves drawn from the existing `ensureWaitlistSheet` /
`updateGiftCardInvoice` analogs in this same file).

## Deviations from Plan

None - plan executed exactly as written. Both tasks' `<action>` blocks specified the exact fix
pattern, function behavior, and dispatch registration; no gaps, bugs, or missing-functionality
decisions arose during implementation.

## Issues Encountered

None. Middleware `node_modules` was absent in this worktree (as expected per a fresh worktree
checkout) and was installed via `npm ci` under Node 20.20 before running `cd zoho-middleware &&
npm test`, per the environment notes — not a deviation, just the documented setup step.

## User Setup Required

None - no external service configuration required. This plan's Apps Script changes are source-only;
the live redeploy (and recording the new/rollback version numbers in `docs/RUNBOOK.md`) is an
explicit human step deferred to plan 84-10, as called out in both the plan objective and the
`mirrorGiftCardState` JSDoc.

## Next Phase Readiness

- `mirror_gift_card_state` exists in source and is fully tested, ready to ride the single Apps
  Script redeploy that 84-10 will perform alongside any other phase-84 Apps Script changes.
- The empty-tab fix removes a standing landmine for the D-01 dual window — every sheet-leg
  gift-card op can now safely re-run against `GiftCardTransactions` regardless of its prior state.
- Blocker/concern for 84-10: this action does not exist in the LIVE Apps Script deployment until
  redeployed — no gift-card-store facade work in sibling plans can exercise it against a real
  Google Sheet until then. The live redeploy + probe is explicitly out of this plan's scope.

## Self-Check: PASSED

- FOUND: apps-script/adminApi.gs (modified, both fixes present)
- FOUND: tests/frontend/adminapi-giftcard-ledger-ensure-sheet.test.js
- FOUND: tests/frontend/adminapi-giftcard-mirror.test.js
- FOUND commit e2ca62ed143382ddf20094fc7a511281bbf25397
- FOUND commit 83efc074fb042b0a6dd6227351631cc29502c5e5
- FOUND commit 0cab69ce0ac025301df7f05b1cc3cb9003b167d3
- FOUND commit 2881c74c9b0102aef9c196be78521c72e06c5ffb
- Root `npm test`: 143/143 suites, 2063/2063 tests passed
- `npm run lint`: clean (0 warnings)
- `cd zoho-middleware && npm test` (Node 20.20): 136/136 suites, 2129/2129 tests passed
- `grep -c "action === 'mirror_gift_card_state'"` → 1
- `grep -c "adjust_gift_card"` → 0
- `grep -c "^function mirrorGiftCardState"` → 1

---
*Phase: 84-giftcards-postgres*
*Completed: 2026-10-03*
