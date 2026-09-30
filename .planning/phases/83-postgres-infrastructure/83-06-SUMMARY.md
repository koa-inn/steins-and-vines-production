---
phase: 83-postgres-infrastructure
plan: 06
subsystem: backfill
tags: [exceljs, xlsx, normalize, backfill, pii-safety, node-pg-migrate-adjacent]

# Dependency graph
requires:
  - phase: 83-postgres-infrastructure (plan 01)
    provides: "Workbook timezone confirmed as America/Vancouver (docs/RUNBOOK.md)"
  - phase: 83-postgres-infrastructure (plan 03)
    provides: "migrations/0001_init.sql pipeline pattern this plan's CLI mechanics will feed in Plan 83-07"
provides:
  - "scripts/backfill/normalize.js — normalizeTimestamp/Empty/Boolean/Json/Numeric/Id/Row, every function reject-not-coerce (Traps 1-4c)"
  - "scripts/backfill/read-xlsx.js — readSheet()/cellToPrimitive() via exceljs, no Sheets-API credentials (D-09)"
  - "scripts/backfill/rejects.js — DEFAULT_OUT_DIR/assertSafePath/writeRejectsReport, PII never lands in a tracked repo path (D-13)"
  - "scripts/backfill/specs/{index,vessel-history,plato-readings,ferm-schedules}.js — three rehearsal sheet specs for Plan 83-07's scratch-schema load"
  - "exceljs@4.4.0 pinned devDependency, owner-approved 2026-09-30"
affects: [83-07 (scratch-schema load, checks, promote gate, CLI built on these modules)]

# Tech tracking
tech-stack:
  added: ["exceljs@4.4.0 (devDependency only, never shipped to Railway's --production build)"]
  patterns:
    - "Reject-not-coerce normalisation: every normalize.js function returns { ok:true, value } | { ok:false, reason }, never silently defaults/coerces an unparseable value"
    - "Zoned-time-to-UTC via Intl.DateTimeFormat offset lookup with a second iteration for DST-edge correctness — no date library dependency"
    - "Decimal-as-string money values built from a rounded integer of minor units (formatFixed), never toFixed on an unrounded float"
    - "assertSafePath repo-boundary check: outside-repo always safe, one git-ignored in-repo exception (zoho-middleware/backfill-output/), everything else inside the repo throws before any write"

key-files:
  created:
    - zoho-middleware/scripts/backfill/specs/index.js
    - zoho-middleware/scripts/backfill/specs/vessel-history.js
    - zoho-middleware/scripts/backfill/specs/plato-readings.js
    - zoho-middleware/scripts/backfill/specs/ferm-schedules.js
    - zoho-middleware/scripts/backfill/normalize.js
    - zoho-middleware/scripts/backfill/read-xlsx.js
    - zoho-middleware/scripts/backfill/rejects.js
    - zoho-middleware/__tests__/backfill/normalize.test.js
    - zoho-middleware/__tests__/backfill/read-xlsx.test.js
    - zoho-middleware/__tests__/backfill/rejects.test.js
  modified:
    - zoho-middleware/package.json
    - zoho-middleware/package-lock.json
    - .gitignore

key-decisions:
  - "Owner approved exceljs@4.4.0 in chat on 2026-09-30 (see Owner Approval section below) — installed with --save-exact per the orchestrator's explicit override of the plan's ^4.4.0 text"
  - "Primary-key ID columns (vh_id, reading_id, schedule_id) marked required:true in all three specs even though the plan's terse per-sheet prose only said 'required' explicitly for vh_id/moved_at/batch_id (vessel-history) — a row without its primary key cannot be inserted, and vessel-history's own explicit example already established the pattern; plato-readings' batch_id also marked required, matching the referenced DDL's `not null references batches`"
  - "normalizeNumeric distinguishes float-arithmetic noise (e.g. 0.1+0.2) from genuine over-precision (e.g. 12.345 at scale 2) via an epsilon (1e-9) comparison between the raw value and its scale-rounded value — small diffs are noise (accepted, rounded), larger diffs are real extra precision (rejected), matching every <behavior> bullet exactly"
  - "cellToPrimitive recurses into a formula's cached .result (never re-evaluates the formula) so a formula that resolved to an error cell still produces {cellError} correctly"

patterns-established:
  - "Backfill normaliser/reader/writer module trio (normalize.js / read-xlsx.js / rejects.js) that Plan 83-07's CLI and every Phase 84-87 spec file will reuse unchanged"

requirements-completed: [DB-02]

# Metrics
duration: ~55min
completed: 2026-09-30
---

# Phase 83 Plan 06: Reusable Backfill Pipeline (DB-free half) Summary

**exceljs@4.4.0 (owner-approved) reads an .xlsx snapshot; a trap-by-trap normaliser converts or rejects every Sheets-shaped value (never coerces); rejects land only in PII-safe, git-ignored locations — proven with 65 new passing tests across three rehearsal sheet specs (VesselHistory, PlatoReadings, FermSchedules).**

## Owner Approval (Task 1 — package legitimacy gate)

**Approved by the owner in chat on 2026-09-30** for `exceljs@4.4.0` as a devDependency. The orchestrator verified the following facts via the npm registry and presented them to the owner before approval:
- Repository: github.com/exceljs/exceljs
- License: MIT
- Maintainers: guyonroche, siemienik
- ~18.4M weekly downloads
- Latest stable release: 4.4.0 (published 2023-10-19); only a 2024-12 prerelease exists since
- Confirmed local-only use: the backfill CLI never runs inside the deployed Railway app (`npm install --production` excludes devDependencies)

Owner reply: **"approved"**. Per the plan's `gate="blocking-human"`, this checkpoint is never auto-approved regardless of yolo/auto-advance config — approval was obtained explicitly before any install occurred (`grep -c exceljs zoho-middleware/package.json` was 0 at the time of approval).

Installed with `npm install --save-dev --save-exact exceljs@4.4.0` — the orchestrator's instruction explicitly required an **exact** pin (`exceljs@4.4.0`, no caret), overriding the plan's own action text (`npm install --save-dev exceljs@^4.4.0`). `package.json` now reads `"exceljs": "4.4.0"` (no `^`).

## Performance

- **Duration:** ~55 min (Tasks 2-3, after Task 1 approval was already granted)
- **Tasks:** 3/3 complete (Task 1 checkpoint:human-verify — resolved before this session; Task 2 and Task 3 both `type="auto" tdd="true"`)
- **Files modified:** 13 (10 created, 3 modified)

## Accomplishments

- **exceljs@4.4.0** installed as a devDependency, exact pin. `npm audit --audit-level=high --omit=dev` → 0 vulnerabilities (production build excludes it entirely). Full `npm audit --audit-level=high` shows 5 vulnerabilities (3 moderate, 2 high) — all in devDependency-only transitive packages (`browserslist`, `js-yaml` via the existing eslint toolchain; `uuid` via exceljs's own dependency tree), none reachable from the production `npm install --production` build. `xlsx`/SheetJS never installed anywhere (`node -e` assertion confirms it's absent from both `dependencies` and `devDependencies`).
- **Three rehearsal sheet specs** (`specs/vessel-history.js`, `specs/plato-readings.js`, `specs/ferm-schedules.js`) plus `specs/index.js` (`getSpec` by sheet-or-table name, `listSpecs()`), column order matching each sheet's real column order per the conversion note for positional mapping.
- **normalize.js** — `normalizeTimestamp` (DST-aware zoned-time conversion via `Intl.DateTimeFormat` offset lookup, two-pass for DST-edge correctness, reject-not-coerce on every ambiguous shape: US-format strings, offset-less ISO strings, bare Excel serials, arbitrary words, cell-error objects), `normalizeEmpty`, `normalizeBoolean` (strict `'TRUE'`/`'FALSE'`/boolean only), `normalizeJson` (string-only input, real `JSON.parse`), `normalizeNumeric` (decimal strings from rounded minor units, epsilon-based float-noise-vs-real-overprecision distinction, precision/scale overflow checks), `normalizeId` (zero-padded prefix/pad regex, rejects numbers), `normalizeRow` (per-column dispatch: empty-check first so an empty *optional* column becomes `null` regardless of declared type, required-empty rejects with reason `'required'`, all failing columns collected before returning).
- **read-xlsx.js** — `readSheet(filePath, sheetName)` via `exceljs`, headers from row 1, `cellToPrimitive` whitelists value shapes (rich text joined, formula → cached `.result` recursively unwrapped — never re-evaluated, hyperlink → display text, error → `{ cellError }`), duplicate/blank headers reject the whole read (positional-mapping safety), fully-empty rows (real cells present, every mapped value empty) skipped and counted in `skippedEmpty`, missing file rejects with `'snapshot not found'`, unknown sheet rejects listing the real available sheet names.
- **rejects.js** — `DEFAULT_OUT_DIR` = `~/sv-backfill` (outside the repo), `assertSafePath` refuses any path resolving inside the repo except the git-ignored `zoho-middleware/backfill-output/`, `writeRejectsReport` writes `rejects-<sheet>-<UTC-timestamp>.json` at file mode `0600` with `sourceFile` reduced to its basename only (no PII-bearing absolute path leaked into the report itself), rejects the promise with **no write performed** when the target path is unsafe.
- **.gitignore** — new block `*.xlsx`, `zoho-middleware/backfill-output/`, `rejects-*.json`; confirmed via `git ls-files '*.xlsx' 'rejects-*.json'` that nothing already tracked became newly ignored.
- **65 new tests** across 3 files (47 normalize/specs, 18 read-xlsx/rejects), all passing. Full gate: middleware **124/124 suites, 1874/1874 tests**, lint clean; frontend **141/141 suites, 2048/2048 tests**, lint clean.

## Task Commits

1. **Task 1: Owner verifies exceljs (package legitimacy gate)** — resolved before this session; owner approved "approved" in chat 2026-09-30 (see Owner Approval above, no code commit for this task)
2. **Task 2: Install exceljs, rehearsal specs, normaliser**
   - `045bfc3b` test(83-06): add failing tests for backfill normalize + specs (Traps 1-4c) — RED
   - `e4d65da5` feat(83-06): install exceljs devDependency, add rehearsal specs + normalizer (Traps 1-4c) — GREEN, 47/47 passing
3. **Task 3: xlsx reader, PII-safe rejects writer, .gitignore**
   - `6708d59f` test(83-06): add failing tests for xlsx reader and PII-safe rejects writer (D-09, D-12, D-13) — RED
   - `f2ee31ff` feat(83-06): xlsx reader, PII-safe rejects writer, .gitignore (D-09, D-12, D-13) — GREEN, 18/18 passing

**Plan metadata:** (this commit, below)

## Files Created/Modified

- `zoho-middleware/scripts/backfill/specs/index.js` — `getSpec`/`listSpecs`, header comment on rehearsal-vs-production sheets and the never-dedupe-beyond-primaryKey rule (conversion note §6)
- `zoho-middleware/scripts/backfill/specs/vessel-history.js`, `plato-readings.js`, `ferm-schedules.js` — per-sheet column specs
- `zoho-middleware/scripts/backfill/normalize.js` — the trap-by-trap normalisers
- `zoho-middleware/scripts/backfill/read-xlsx.js` — `readSheet`/`cellToPrimitive`
- `zoho-middleware/scripts/backfill/rejects.js` — `DEFAULT_OUT_DIR`/`assertSafePath`/`writeRejectsReport`
- `zoho-middleware/__tests__/backfill/normalize.test.js` — 47 tests
- `zoho-middleware/__tests__/backfill/read-xlsx.test.js` — 11 tests
- `zoho-middleware/__tests__/backfill/rejects.test.js` — 7 tests
- `zoho-middleware/package.json` / `package-lock.json` — `exceljs: "4.4.0"` (exact pin) devDependency
- `.gitignore` — backfill PII exclusion block

## Decisions Made

See `key-decisions` in the frontmatter above (owner-approval provenance, exact-pin override, primary-key-required inference, the numeric epsilon approach, formula-result recursion). No decision here required a checkpoint beyond Task 1 — Rules 1-3 covered the rest.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - orchestrator override] Exact-pin `exceljs@4.4.0` instead of the plan's `^4.4.0`**
- **Found during:** Task 2, before running `npm install`
- **Issue:** The plan's own action text says `npm install --save-dev exceljs@^4.4.0`. The orchestrator's objective explicitly instructed "Install exactly `exceljs@4.4.0` as a devDependency (pin per the plan's instructions)" — a direct, more specific instruction that takes precedence over the plan text for this run.
- **Fix:** Ran `npm install --save-dev --save-exact exceljs@4.4.0`; `package.json` now reads `"exceljs": "4.4.0"` with no caret.
- **Files modified:** `zoho-middleware/package.json`, `zoho-middleware/package-lock.json`
- **Verification:** `grep -n '"exceljs"' package.json` → `"exceljs": "4.4.0",`; `npm audit --audit-level=high --omit=dev` → 0 vulnerabilities
- **Committed in:** `e4d65da5`

**2. [Rule 2 - correctness] Primary-key ID columns marked `required:true` beyond the plan's literal per-sheet prose**
- **Found during:** Task 2, designing the three spec files
- **Issue:** The plan's action text explicitly writes "required" next to `vh_id`, `batch_id`, and `moved_at` for VesselHistory, but omits the word next to `reading_id`/`batch_id` (PlatoReadings) and `schedule_id` (FermSchedules) — even though these are each sheet's primary key, and the referenced DDL (`.planning/notes/sheets-to-postgres-data-conversion.md` §3.2-3.4) declares `batch_id`/the primary key columns `not null`/`references`.
- **Fix:** Marked `reading_id`, `plato_readings.batch_id`, and `schedule_id` as `required: true` — a row missing its own primary key cannot be inserted, and the DDL already requires it. This is the more defensively correct reading and matches vessel-history's own explicit example.
- **Files modified:** `zoho-middleware/scripts/backfill/specs/plato-readings.js`, `zoho-middleware/scripts/backfill/specs/ferm-schedules.js`
- **Verification:** `normalizeRow` test for a fully-valid FermSchedules row exercises `schedule_id` as required; no test regression
- **Committed in:** `e4d65da5`

**3. [Rule 3 - missing referenced file] `.planning/notes/sheets-to-postgres-data-conversion.md` does not exist in this worktree**
- **Found during:** `files_to_read` step, before Task 2
- **Issue:** The plan's `<context>` and Task 2/3 `read_first` blocks reference `.planning/notes/sheets-to-postgres-data-conversion.md`, but `git ls-files`/`git log` confirm this file was never committed to the repository — it exists only as an untracked file in the main checkout (`/Users/koa/dev/steins-and-vines-website/.planning/notes/sheets-to-postgres-data-conversion.md`), invisible to this worktree's `HEAD`.
- **Fix:** Read the file directly from the main checkout's filesystem path (outside the worktree, via an absolute-path `Read`, not a git operation) to get its content for reference. Did not modify or commit this file — it is out of scope for this plan's `files_modified` list, and copying an untracked file into the worktree risked diverging from whatever the main checkout eventually does with it.
- **Files modified:** None
- **Verification:** Content used to derive the exact DDL/column order/trap descriptions cited above, visible in this SUMMARY's Accomplishments section
- **Committed in:** N/A (read-only; flagged here as a process note, not a code change)

---

**Total deviations:** 3 (1 orchestrator-directed override, 2 Rule 2/3 auto-fixes). None required a new checkpoint.
**Impact on plan:** None on the deliverable's correctness — all three make the implementation more correct or more faithful to an explicit, more specific instruction than the plan's own terser prose.

## Issues Encountered

**`.planning/notes/sheets-to-postgres-data-conversion.md` is untracked in git** (see Deviation 3 above). This is worth flagging to the orchestrator/owner separately: a canonical reference document cited by this phase's CONTEXT.md, RESEARCH.md, and multiple plans' `read_first` blocks has never been committed to the repository. Any future worktree-isolated executor spawned from a commit after today will hit the same missing-file gap unless it is committed. Not fixed here — out of this plan's scope (not in `files_modified`), and committing someone else's in-progress research note without being asked risks overstepping.

## User Setup Required

None. Nothing pushed, nothing deployed, no real customer data touched — fixtures are generated at test time into `os.tmpdir()` only and cleaned up after each test.

## Next Phase Readiness

- Plan 83-07 (scratch-schema load, checks, promote gate, CLI) can proceed: `normalize.js`/`read-xlsx.js`/`rejects.js`/`specs/` are all in place with the exact interfaces this plan's `<interfaces>` block specified, fully unit-tested.
- The `America/Vancouver` default timezone (confirmed in `docs/RUNBOOK.md` via Plan 83-01) is ready for Plan 83-07's CLI to pass through as `normalizeRow`'s `opts.timezone`.
- Recommend the owner/orchestrator decide whether to commit `.planning/notes/sheets-to-postgres-data-conversion.md` into the repository before more plans depend on reading it from an untracked path (see Issues Encountered).

---
*Phase: 83-postgres-infrastructure*
*Completed: 2026-09-30*

## Self-Check: PASSED

- FOUND: zoho-middleware/scripts/backfill/specs/index.js
- FOUND: zoho-middleware/scripts/backfill/specs/vessel-history.js
- FOUND: zoho-middleware/scripts/backfill/specs/plato-readings.js
- FOUND: zoho-middleware/scripts/backfill/specs/ferm-schedules.js
- FOUND: zoho-middleware/scripts/backfill/normalize.js
- FOUND: zoho-middleware/scripts/backfill/read-xlsx.js
- FOUND: zoho-middleware/scripts/backfill/rejects.js
- FOUND: zoho-middleware/__tests__/backfill/normalize.test.js
- FOUND: zoho-middleware/__tests__/backfill/read-xlsx.test.js
- FOUND: zoho-middleware/__tests__/backfill/rejects.test.js
- FOUND: 045bfc3b (test commit, Task 2 RED)
- FOUND: e4d65da5 (feat commit, Task 2 GREEN)
- FOUND: 6708d59f (test commit, Task 3 RED)
- FOUND: f2ee31ff (feat commit, Task 3 GREEN)
