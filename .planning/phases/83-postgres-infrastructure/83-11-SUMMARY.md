---
phase: 83-postgres-infrastructure
plan: 11
subsystem: database
tags: [backfill, exceljs, data-validation, jest, tdd]

# Dependency graph
requires:
  - phase: 83-postgres-infrastructure
    provides: "Plan 83-06/83-07 backfill pipeline (normalize.js, read-xlsx.js, specs/) and the VerificationReview CR-03 finding this plan closes"
provides:
  - "normalizeText that rejects non-string, non-finite-number input instead of String()-coercing it"
  - "cellToPrimitive that fails closed on sharedFormula, no-result formulas, text-less hyperlinks and any unrecognised exceljs shape"
  - "readSheet header validation that rejects unreadable (error/Date/boolean) header cells"
  - "Two new regression test files pinning the CR-03 reproduction cases"
affects: [84-postgres-promotion, backfill-rehearsal]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fail-closed normalisation: every normaliser in normalize.js now rejects with a typed reason rather than coercing (D-12) — normalizeText joins normalizeTimestamp/normalizeId/normalizeBoolean/normalizeNumeric/normalizeJson in this contract"
    - "cellToPrimitive never returns null for a value it doesn't understand — null is reserved for genuinely empty/undefined cells so the empty-row skip in readSheet keeps working"

key-files:
  created:
    - zoho-middleware/__tests__/backfill/normalize-no-coercion.test.js
    - zoho-middleware/__tests__/backfill/read-xlsx-cell-shapes.test.js
  modified:
    - zoho-middleware/scripts/backfill/normalize.js
    - zoho-middleware/scripts/backfill/read-xlsx.js

key-decisions:
  - "Reject reasons stay type-only ('expected text, got boolean', 'cell error: #REF!') and never echo the raw cell value, per T-83-11-03 — the PII rejects file is the only place raw values surface (D-13)"
  - "Unreadable header cells throw a hard Error from readSheet (whole-sheet failure) rather than producing a per-row reject, matching the existing blank-header/duplicate-header behavior in the same loop"
  - "sharedFormula is handled by the same branch as formula (both unwrap .result or become a cellError) rather than a parallel code path, to keep the fail-closed contract in one place"

patterns-established:
  - "Each normaliser function's leading comment states its fail-closed contract and cites D-12/CR-03, so a future normaliser (e.g. for a new column type) has a clear contract to copy"

requirements-completed: [DB-02]

duration: ~20min
completed: 2026-10-02
---

# Phase 83 Plan 11: Backfill normaliser/reader fail-closed (CR-03) Summary

**normalizeText and cellToPrimitive now reject every cell they cannot confidently convert instead of coercing it to a misleading string or a silent null, closing verification gap 2 (CR-03/D-12).**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-10-02T19:31:31Z
- **Tasks:** 2
- **Files modified:** 2 source files, 2 new test files

## Accomplishments
- `normalizeText` in `normalize.js` now accepts only strings (trimmed) and finite numbers (stringified); a cell-error object, a `Date`, a boolean, or any other object/type produces a typed reject reason instead of `String(raw)` producing `"[object Object]"`, a locale-dependent date string, or `"true"`/`"false"`.
- `cellToPrimitive` in `read-xlsx.js` now treats `sharedFormula` the same as `formula`, recurses into a hyperlink's rich-text display text, and returns `{ cellError: '...' }` — never `null` — for a formula with no cached result, a hyperlink with no display text, or any other unrecognised shape (bigint, symbol, function, empty/unknown object).
- `readSheet`'s header loop now throws `unreadable header in column N of sheet "..."` when a header cell is an error object, a `Date`, or a boolean, instead of silently stringifying it to `"[object Object]"`.
- The verifier's exact reproduction (`vessel_id: true, notes: { cellError: '#REF!' }`) now returns `ok:false` with exactly 2 typed reasons, matching the plan's must-have truth.
- Two new regression test files (`normalize-no-coercion.test.js`, `read-xlsx-cell-shapes.test.js`) pin every CR-03 case, including a real `.xlsx` round trip through `readSheet` + `normalizeRow`.

## Task Commits

Each task followed RED → GREEN:

1. **Task 1: normalizeText rejects cell errors, Dates, booleans and objects**
   - `6d99f226` test(83-11): add failing tests for text-column coercion in backfill normaliser (RED)
   - `e1bcc63a` fix(83-11): reject non-text cells in backfill text columns instead of coercing (CR-03) (GREEN)
2. **Task 2: cellToPrimitive fails closed on unknown exceljs shapes**
   - `11e0a84b` test(83-11): add failing tests for unhandled exceljs cell shapes (RED)
   - `43a71f37` fix(83-11): fail closed on unknown exceljs cell shapes in backfill reader (CR-03) (GREEN)

**Plan metadata:** (pending — this commit)

## Files Created/Modified
- `zoho-middleware/scripts/backfill/normalize.js` - `normalizeText` rewritten to reject non-text/non-finite-number cells with a typed reason
- `zoho-middleware/scripts/backfill/read-xlsx.js` - `cellToPrimitive` fails closed on unknown shapes; `readSheet` header loop rejects unreadable header cells
- `zoho-middleware/__tests__/backfill/normalize-no-coercion.test.js` - new CR-03 regression tests for text-column coercion
- `zoho-middleware/__tests__/backfill/read-xlsx-cell-shapes.test.js` - new CR-03 regression tests for exceljs cell shapes, including a real `.xlsx` round trip and an unreadable-header case

## Decisions Made
- Kept `normalizeRow`'s dispatch order and empty-check untouched, per the plan's interface notes — only `normalizeText`'s internal body changed.
- Combined the header-loop "unreadable" check into one boolean (`(raw !== null && typeof raw === 'object') || typeof raw === 'boolean'`) rather than two separate `Date`/`object` branches, since `typeof (Date instance) === 'object'` already covers dates.

## Deviations from Plan

None - plan executed exactly as written. `node_modules` was missing in this worktree (fresh worktree checkout); ran `npm ci` in `zoho-middleware/` before the first test run, as the parallel-execution instructions anticipate — not a plan deviation.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Verification gap 2 (CR-03) can be re-verified as VERIFIED: the verifier's spot-check now returns `ok:false` with 2 reasons.
- `cd zoho-middleware && npx jest __tests__/backfill/` exits 0 (9 suites, 104 tests).
- `cd zoho-middleware && npm test` exits 0 (131 suites, 1915 tests). `cd zoho-middleware && CI=true npm run test:db` exits 0, 0 skipped (26 tests). Root `npm test` exits 0 (141 suites, 2048 tests). `npm run lint` (root and middleware) both exit 0.
- Phase 84+ can now promote rows from this pipeline without inheriting silently-coerced text or silently-NULLed exceljs shapes.

---
*Phase: 83-postgres-infrastructure*
*Completed: 2026-10-02*
