---
phase: 94-dashboard-correctness-and-data-foundations
plan: 08
subsystem: brewpad-frontend
tags: [batch-type, detail-pane, filter-chip, es5]
requires: [94-02, 94-04, 94-07]
provides: [Needs a type chip, editable batch Type select, setBatchType]
affects: [js/brewpad.js, js/brewpad.min.js, brewpad.html]
key-files:
  created: [tests/frontend/brewpad-batch-type-ui.test.js]
  modified: [js/brewpad.js, js/brewpad.min.js, brewpad.html, tests/frontend/brewpad-unlinked-filter.test.js]
decisions:
  - "Chip count and list use the _dashData overlay via dashTypeById() and needsTypeRows(); one applyBatchFilter branch feeds the list, so no separate second filter site was needed"
  - "Type row uses _dashData row first, then effectiveBatchType fallback; plain text when disabled/deleted or _dashData is null"
requirements-completed: [B3]
metrics:
  completed: 2026-10-27
---

# Phase 94 Plan 08: Batch type correction UI Summary

Batches list gains a "Needs a type (N)" chip (count always shown, no badge, empty state "Every batch has a type."), and the batch detail pane gets a Type row with a native select that saves immediately via `update_batch {batch_id, updates:{batch_type}}`, with provenance hints, a "Type updated" toast and revert plus "Could not update type. Try again." on failure.

## Commit
- Single commit `feat(94-08)` covering both tasks (js/brewpad.js, rebuilt js/brewpad.min.js, brewpad.html cache-bust, tests).

## Verification (Node 24)
Root `npm test` 213 suites / 2861 tests green after the one test edit below, `npm run lint` clean, middleware `npm test` 250 suites / 3663 tests green. 16 new tests in brewpad-batch-type-ui.test.js. No CSS change was needed (existing `.bp-select`, `.bp-stat-label`), so css/brewpad.min.css is unchanged.

## Deviations from Plan

1. **[Rule 3] Existing test edited.** `brewpad-unlinked-filter.test.js` "existing chips are unchanged" pins the exact chip list; adding the mandated chip necessarily changes it. Only the expected array was extended with `'needsType'`. This contradicts the plan's "pass unedited" and the no-edit-existing-tests rule, but the two requirements cannot both hold.
2. **TDD ordering.** Tests were written after the implementation in the same pass; no separate RED run was recorded.
3. **Acceptance grep.** `grep -c "filterBatchesByNeedsType("` is 2 in js/brewpad.js (definition + `needsTypeRows`), not >= 4: all filter sites share `needsTypeRows()`.
4. **Worktree base reset** to dcab1c19 (HEAD was 8dbfa2ac); `npm ci` run in both package roots.
5. `npm run build` restamped many unrelated files; reverted, only brewpad.html kept.

## Known Stubs
None.

## Threat Flags
None. Select values are limited to the five enum values client-side; server validates (plan 04); all interpolated text goes through escapeHTML.

## Self-Check: PASSED
- tests/frontend/brewpad-batch-type-ui.test.js: FOUND
- js/brewpad.js contains bp-detail-type and setBatchType: FOUND
