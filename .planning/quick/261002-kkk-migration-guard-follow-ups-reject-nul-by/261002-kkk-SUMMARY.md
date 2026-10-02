---
phase: quick-261002-kkk
plan: 01
subsystem: database
tags: [eslint, jest, libpg-query, migrations, deploy-gate]

# Dependency graph
requires:
  - phase: 83-postgres-infrastructure
    provides: migration-allowlist.js (fail-closed parser-backed migration guard) and its backslash pre-parse gate pattern
provides:
  - NUL-byte pre-parse gate in checkSql() closing WR-01 (deploy-gate fail-closed guarantee no longer depends on incidental NUL-termination backstops)
  - Middleware lint scope extended to scripts/ (both migration guards + backfill tooling), closing IN-01
affects: [83-postgres-infrastructure, migration-guard, deploy-gate]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pre-parse string gates in checkSql() (indexOf-based) run in a fixed order before pg.parseSync — NUL gate now precedes the existing backslash gate"
    - "Optional catch binding (catch { }) for unused catch params under ESLint no-unused-vars, ES2019+"

key-files:
  created:
    - zoho-middleware/__tests__/migration-allowlist-nul.test.js
  modified:
    - zoho-middleware/scripts/migration-allowlist.js
    - zoho-middleware/migrations-manual/README.md
    - zoho-middleware/package.json
    - zoho-middleware/eslint.config.js
    - zoho-middleware/scripts/backfill/backfill.js
    - zoho-middleware/scripts/backfill/normalize.js
    - zoho-middleware/scripts/import-vessels.js
    - zoho-middleware/scripts/replay-collect-webhook.js
    - zoho-middleware/scripts/sync-images.js
    - zoho-middleware/scripts/tag-subcategories.js

key-decisions:
  - "NUL gate placed immediately before the existing backslash gate in checkSql() — a payload containing both NUL and backslash now reports 'nul-byte', not 'backslash' (NUL gate runs first, matching the plan's required ordering)"
  - "scripts/migration-guard.js required zero lint edits and zero eslint override — planner's trial lint prediction held exactly; no ignores entry was needed"

patterns-established:
  - "Pre-parse gate pattern (NUL alongside backslash): ban a character class outright in the raw Up section before any parsing, with a comment citing the review/owner-decision source"

requirements-completed: [83-REVIEW-WR-01, 83-REVIEW-IN-01]

# Metrics
duration: 27min
completed: 2026-10-02
---

# Quick Task 261002-kkk: Migration Guard Follow-ups (Reject NUL, Lint scripts/) Summary

**Added a NUL-byte pre-parse gate to migration-allowlist.js's fail-closed deploy guard (WR-01) and extended middleware ESLint coverage to scripts/, fixing all 7 warnings it surfaced (IN-01) with zero behaviour change.**

## Performance

- **Duration:** 27 min
- **Started:** 2026-10-02T21:28:00Z (approx, first tool action)
- **Completed:** 2026-10-02T21:55:47Z
- **Tasks:** 2
- **Files modified:** 10 (1 new, 9 modified)

## Accomplishments

- `checkSql()` in `migration-allowlist.js` now rejects any NUL byte anywhere in a migration's raw Up section with rule `nul-byte`, before `pg.parseSync` ever sees the text — closing the gap where `CREATE TABLE ok (a int);\0DROP TABLE gift_cards;` previously parsed as a single accepted `CreateStmt` and silently hid everything after the NUL.
- New regression test file (`migration-allowlist-nul.test.js`, 8 tests) proves RED→GREEN: NUL at start/middle/end of the Up section, NUL+backslash precedence (NUL wins), NUL confined to the Down section (no false positive), a NUL-free control, and a CLI exit-1 case.
- `cd zoho-middleware && npm run lint` now covers `scripts/` (both migration guards and the backfill/import/sync tooling) and exits 0 with `--max-warnings 0` — previously these deploy-gating and deploy-adjacent scripts had zero lint coverage.
- The 7 warnings the planner's lint trial predicted were the exact 7 surfaced (no drift since planning) and were fixed behaviour-preservingly: 3 unused `catch (e)` bindings → optional catch bindings, 3 `!= null` loose-equality checks → explicit `!== null && !== undefined`, and 1 unused `KIT_CATEGORIES` declaration removed.
- `scripts/migration-guard.js` required **zero** edits and **zero** eslint override — it was already lint-clean under the existing rule set, confirmed both before and after the Task 2 config change.

## Task Commits

1. **Task 1: WR-01 — NUL-byte pre-parse gate in migration-allowlist.js (regression test first)** - `7dae8f8a` (fix, TDD)
2. **Task 2: IN-01 — extend middleware lint to scripts/ and fix the 7 surfaced warnings** - `801ef66e` (chore)

_No separate RED/GREEN/REFACTOR commits — Task 1's RED evidence (failing-then-passing assertions) is captured below and in the committed test file; the plan specified a single combined commit per task (TDD test+implementation+docs together), not TDD-gate-style separate commits._

## RED Evidence (Task 1)

Before the GREEN fix, `npx jest __tests__/migration-allowlist-nul.test.js` reported:

```
✕ rejects a NUL byte hiding a DROP after an accepted CREATE TABLE
    Expected: 1
    Received: 0
✕ rejects the 83-REVIEW payload (CREATE TABLE + NUL + CREATE OR REPLACE FUNCTION)
    Expected value: "nul-byte"   Received array: []
✕ rejects a NUL as the very first character of the Up section
    Expected value: "nul-byte"   Received array: []
✕ rejects a NUL as the very last character of the Up section
    Expected value: "nul-byte"   Received array: []
✕ rejects with nul-byte (not backslash) when the Up section has both a NUL and a backslash
    Expected value: "nul-byte"   Received array: ["backslash"]
✓ does not trigger on a NUL that appears only in the Down section
✓ accepts a NUL-free control (clean Up section)
✕ CLI exits 1 with a nul-byte line for a migrations dir containing a NUL-bearing .sql file
```

6 failed / 2 passed — exactly the predicted RED shape (the two Down-section/control cases already passed because they don't depend on the new gate; all 5 NUL-triggering assertions plus the CLI case failed as expected). After the gate was added, all 8 tests in this file pass, and the full allowlist/guard suite (`migration-allowlist-nul`, `migration-allowlist`, `migration-allowlist-wiring`, `migration-guard`, `migration-guard-hardening`) — 233 tests across 5 suites — passes with zero modifications to the four pre-existing, owner-protected files.

## Files Created/Modified

- `zoho-middleware/__tests__/migration-allowlist-nul.test.js` - new regression test file for the NUL gate (8 tests); existing allowlist test files/fixtures untouched per owner constraint
- `zoho-middleware/scripts/migration-allowlist.js` - NUL pre-parse gate added to `checkSql()` (runs before the backslash gate); one-line fail-closed/owner-decisions header note added, labeled as a review follow-up (no renumbering of owner decisions 1-3)
- `zoho-middleware/migrations-manual/README.md` - new bullet next to the backslash bullet + `nul-byte` row in the Rule names table (directly under `backslash`)
- `zoho-middleware/package.json` - `lint` script extended to `eslint routes/ lib/ scripts/ server.js --max-warnings 0`
- `zoho-middleware/eslint.config.js` - flat-config `files` glob extended with `'scripts/**/*.js'`
- `zoho-middleware/scripts/backfill/backfill.js` - `catch (e)` → `catch` (unused binding)
- `zoho-middleware/scripts/backfill/normalize.js` - two `!= null` checks → explicit `!== null && !== undefined` (undefined-coverage preserved)
- `zoho-middleware/scripts/import-vessels.js` - `catch (e)` → `catch`
- `zoho-middleware/scripts/replay-collect-webhook.js` - `!= null` → explicit `!== null && !== undefined`
- `zoho-middleware/scripts/sync-images.js` - `catch (e)` → `catch`
- `zoho-middleware/scripts/tag-subcategories.js` - removed unused `KIT_CATEGORIES` declaration and its comment

## Decisions Made

- NUL gate ordering: placed before the backslash gate exactly as the plan's behavior bullets required, so a payload with both NUL and backslash reports `nul-byte` only (verified by a dedicated test).
- No `eslint.config.js` `ignores` entry was needed for `migration-guard.js` — it produced zero warnings both before and after extending the lint scope, matching the planner's trial-lint prediction exactly. No owner flag required for this item.

## Deviations from Plan

None - plan executed exactly as written. Both tasks matched their `<behavior>`/`<action>` specs precisely; the lint trial's predicted 7 warnings were the exact 7 surfaced with no additions or drift.

## Owner Flag (per plan instruction, informational only — no action taken)

`tag-subcategories.js` declared `KIT_CATEGORIES` with a comment claiming it mirrors the kit filter in `routes/catalog.js`, but never actually applied it — the script may be tagging kit items it was meant to exclude. Removing the dead variable (this commit) preserves current behaviour exactly; whether the filter should actually be applied to the script's logic is a separate decision for the owner.

## Optional Follow-up (scope note, not acted on)

The 83-REVIEW's "ideally validate UTF-8" aside (T-kkk-03 in the plan's threat model, disposition `accept`) is out of this task's requested scope. A migration file containing non-UTF-8 byte sequences other than NUL is not addressed here; flagged as a possible future follow-up only.

## Issues Encountered

None.

## Gates Run (all green)

- `cd zoho-middleware && npx jest __tests__/migration-allowlist-nul.test.js __tests__/migration-allowlist.test.js __tests__/migration-allowlist-wiring.test.js __tests__/migration-guard.test.js __tests__/migration-guard-hardening.test.js` — 233/233 passed
- `cd zoho-middleware && npm test` — 136 suites / 2129 tests passed
- `cd zoho-middleware && npm run lint` — exit 0, covers `scripts/`
- `cd zoho-middleware && npx eslint scripts/migration-allowlist.js scripts/migration-guard.js --max-warnings 0` — exit 0 (both guards clean)
- Root `npm test` — 141 suites / 2048 tests passed
- Root `npm run lint` — exit 0
- `git diff --quiet HEAD` on `scripts/migration-guard.js`, `__tests__/migration-guard.test.js`, `__tests__/migration-guard-hardening.test.js`, `__tests__/migration-allowlist.test.js`, `__tests__/migration-allowlist-wiring.test.js`, `__tests__/fixtures/migration-allowlist-cases.js` — confirmed byte-identical after both task commits

## User Setup Required

None - no external service configuration required. No push, no deploy (per hard constraints).

## Next Phase Readiness

- WR-01 and IN-01 from `83-REVIEW.md` are closed; `migration-allowlist.js`'s fail-closed guarantee no longer relies on incidental NUL-termination backstops, and `scripts/` is now under the same pre-commit lint gate as `routes/`/`lib/`.
- No blockers. The two commits (`7dae8f8a`, `801ef66e`) are local to this worktree branch; nothing pushed or deployed.
- Optional non-blocking follow-ups for the owner to consider separately: the `KIT_CATEGORIES` dead-filter question above, and the UTF-8 validation aside from the original review.

---
*Phase: quick-261002-kkk*
*Completed: 2026-10-02*

## Self-Check: PASSED

All 11 claimed files verified present on disk (1 new test file, 9 modified source/config files, 1 SUMMARY). Both task commits (`7dae8f8a`, `801ef66e`) verified present in `git log`.
