---
phase: 83-postgres-infrastructure
plan: 08
subsystem: database
tags: [postgres, railway, backfill, ci, node-pg-migrate, sheet-mirror]

# Dependency graph
requires:
  - phase: 83-postgres-infrastructure (plan 03)
    provides: "repo-root /railway.toml preDeployCommand (npm run migrate) and the staging/production Railway environments this plan deployed to"
  - phase: 83-postgres-infrastructure (plan 04)
    provides: "lib/sheet-mirror.js PRODUCTION_ENVIRONMENT_NAME gate, verified DISABLED on staging in this plan's deploy logs"
  - phase: 83-postgres-infrastructure (plan 05)
    provides: "Testcontainers-backed npm run test:db (D-14), proven green on CI for the first time in this plan's pushed SHA"
  - phase: 83-postgres-infrastructure (plan 06)
    provides: "backfill specs/{vessel-history,plato-readings,ferm-schedules}.js consumed by this plan's rehearsal, with header mismatches found and fixed here"
  - phase: 83-postgres-infrastructure (plan 07)
    provides: "scripts/backfill/{load,backfill}.js CLI and README, run end-to-end against real staging Postgres for the first time in this plan"
provides:
  - "Phase 83 middleware live on staging with DATABASE_URL, migrations applying via preDeployCommand, and the Sheet mirror confirmed DISABLED (environment=staging)"
  - "First real (non-skipped) npm run test:db pass on CI, pinned to testcontainers@11.14.0 for Node compatibility"
  - "Two real bugs fixed as part of getting the DB suite green: exceljs/jest.resetModules interaction, rollbackEachTest client leak"
  - "Backfill rehearsal proven end-to-end against real staging data in a scratch schema (scratch_83_rehearsal, dropped after use) — zero rows loaded to any real table"
  - "A live production data bug found and owner-fixed: VesselHistory sheet's header row was missing a bin_id column Apps Script had been appending since Feb 2026, shifting all rows one column right of their headers"
  - "RUNBOOK Postgres (Phase 83) rollback notes + staging verification record + resolved backfill-connectivity note (private tunnel, not railway run)"
affects: ["84-giftcards (first real store to read/write Postgres; backfill pipeline and rehearsal procedure now proven)", "85-88 (same reuse)", "deferred-items (test-e2e pre-existing failure, pg@9 deprecation, checks-pass-on-zero-rows gap, Railway config-as-code 2026-12-01 deadline, Hobby-plan backup gap)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "testcontainers pinned to 11.14.0 (not latest 12.0.4) because 12.x pulls undici@8, which requires Node >=22.19; CI/local run Node 20.20"
    - "Backfill spec `header` values must be the literal sheet column headers (row 1 text), never the Postgres column names — a mismatch causes 100% silent rejects, not an error, because every required cell reads as missing"
    - "Owner-only PII path: BACKFILL_DATABASE_URL set via `read -s` in the owner's terminal, connected through Railway's private tunnel (`railway connect <service> --tunnel-only --environment <env>`), never a public TCP proxy; Claude never sees the URL or row content, only counts/exit codes/reason categories"

key-files:
  created: []
  modified:
    - docs/RUNBOOK.md
    - zoho-middleware/scripts/backfill/README.md
    - zoho-middleware/scripts/backfill/specs/vessel-history.js
    - zoho-middleware/scripts/backfill/specs/plato-readings.js
    - zoho-middleware/scripts/backfill/specs/ferm-schedules.js
    - zoho-middleware/scripts/backfill/backfill.js
    - zoho-middleware/__tests__/backfill/normalize.test.js
    - zoho-middleware/__tests__/backfill/spec-headers.test.js
    - zoho-middleware/__tests__/backfill/cli-checks-output.test.js
    - zoho-middleware/__tests__/db/backfill.test.js

key-decisions:
  - "Pinned testcontainers to 11.14.0 rather than upgrading Node past 20.20, to match the Node version already standardized on across this repo and CI"
  - "Treated the VesselHistory bin_id header gap as a live-data bug outside this plan's file scope, but still fixed it (owner-approved, in the live sheet) because it blocked the rehearsal and was actively corrupting BrewPad's displayed vessel history since Feb 2026 — Rule 1/Rule 2 auto-fix, escalated to the owner only for the sheet edit itself since Claude cannot write to the production workbook"
  - "Connected to staging Postgres via Railway's private tunnel exclusively — no public TCP proxy was ever enabled on either Postgres service for this rehearsal"
  - "Go/no-go for Plan 83-09: GO for code; flagged the pre-existing unrelated test-e2e CI failure as something to check against any gated-deploy workflow gate before 83-09, since it is not a Phase 83 regression"

patterns-established:
  - "Backfill rehearsals must verify spec headers against the live sheet's actual row 1 before trusting rejection counts — a 100%-reject result is more likely a header mismatch than real bad data"

requirements-completed: [DB-02]

# Metrics
duration: ~60min
completed: 2026-10-02
---

# Phase 83 Plan 08: Ship to Staging, Verify, and Rehearse the Backfill Summary

**Phase 83 middleware deployed to staging with database:true and the Sheet mirror confirmed DISABLED; first real (non-skipped) `npm run test:db` pass on CI; backfill CLI rehearsed end-to-end against real staging data (401/68/11 rows, zero rejects after two spec-header bugs and one live sheet bug were fixed) with zero rows ever loaded outside a scratch schema.**

## Performance

- **Duration:** ~60 min (commit span 10:24:49–11:24:48 PDT 2026-10-02, across Task 1 push/verify, Task 2 owner rehearsal, and Task 3 recording)
- **Tasks:** 3/3 complete (Task 1 auto, Task 2 checkpoint:human-action, Task 3 auto)
- **Files modified:** 10 (1 created commit set none; all modifications — see Files Created/Modified)

## Accomplishments

- **Preflight passed (a)-(e):** staging `DATABASE_URL` linked; repo-root `/railway.toml` has `preDeployCommand = "cd zoho-middleware && npm run migrate"`; `PRODUCTION_ENVIRONMENT_NAME` differs from staging; local gates green (`npm test`, `npm run lint`, `npm run test:db` with Docker, both packages); only the pre-existing unrelated `links.html` was dirty, never staged.
- **RUNBOOK Postgres (Phase 83) rollback block added** under `## Rollback` -> `### Railway (middleware)`: app rollback is safe, failed pre-deploy keeps the old version (D-03), destructive changes go through the manual path only (D-04), DB rollback = delete the service, store rollback from Phase 84+ = `<STORE>_STORE=sheets` (D-05).
- **Pushed to staging and verified live:** CI `Tests` run for `ed42907b` — `test-middleware` SUCCESS including the `test:db` step printing `Test Suites: 3 passed, 3 total / Tests: 26 passed, 26 total`, 0 skipped (first real-Postgres run ever on this branch); `test-frontend` SUCCESS; `artifact-drift` SUCCESS. Getting there required pinning `testcontainers` to `11.14.0` (12.0.4 pulls `undici@8`, needs Node >=22.19) and fixing two real bugs: an `exceljs`/`jest.resetModules` interaction and a `rollbackEachTest` client leak.
- **Staging `/health` verified:** `{"status":"ok","authenticated":true,"redis":true,"database":true}`; `/api/products` returns 200.
- **Owner-confirmed staging deploy logs (Task 2):** pre-deploy `migration-guard: 1 file(s) additive-only OK` + `0001_init` applied; deploy logs `[sheet-mirror] mirror DISABLED (environment=staging)` with `GIFT_CARDS_STORE`/`RECIPES_STORE` both `sheets`.
- **Backfill rehearsal run end-to-end twice on real staging data**, connected via Railway's private tunnel (never a public proxy, never seen by Claude):
  - Run 1: 100% rejects on all three sheets. Root cause: spec `header` values were the Postgres column names, not the sheet's actual row-1 text. While diagnosing, found a **live data bug**: VesselHistory's header row was missing a `bin_id` column that Apps Script had been appending an 8th value for since Feb 2026 — every row was shifted one column right of its header, so BrewPad had been displaying bins as transfer dates for 8 months. Owner inserted the missing `bin_id` header at E1 in the live sheet (owner-approved fix, outside this plan's file scope but a correctness blocker).
  - Run 2 (schema `scratch_83_rehearsal`, no `--promote`): VesselHistory 401/401/0 rejected, Checks PASS (25 checks), exit 0; PlatoReadings 68/68/0, Checks PASS (26 checks), exit 0; FermSchedules 11/11/0, Checks PASS (25 checks), exit 0.
  - `scratch_83_rehearsal` dropped (`DROP SCHEMA ... CASCADE`) after the rehearsal; zero rows ever loaded to a real table.
- **RUNBOOK staging verification + rehearsal record added** (Task 3): `/health` fields, both log confirmations, the per-sheet rehearsal table, and an explicit go/no-go for Plan 83-09.

## Task Commits

1. **Task 1: Preflight, RUNBOOK rollback notes, push to staging, verify CI and /health** — `ed42907b` (docs) — pushed SHA `ed42907b53843b9c0693ffbd578f904bda76f642`
2. **Task 2: Owner confirms Railway logs + runs backfill rehearsal** — owner/orchestrator-run, no commit (checkpoint:human-action); the two header bugs found during the rehearsal were fixed and committed separately:
   - `3fb4cc83` fix(83-06): match backfill spec headers to the real sheet row 1
   - `c5850712` fix(83-07): always print a PASS/FAIL result line for backfill step [5/6] Checks
   - `168e3b2f` fix(83-07): document the verified Railway private-tunnel procedure in backfill README
3. **Task 3: Record staging verification and rehearsal outcome** — `4691dacc` docs(83-08): record staging verification and backfill rehearsal outcome

**Plan metadata:** this commit (below, if a final docs commit is made by the orchestrator)

## Files Created/Modified

- `docs/RUNBOOK.md` — Postgres (Phase 83) rollback block (Task 1), backfill-connectivity note resolved to the private-tunnel procedure (Task 3), staging verification + rehearsal record (Task 3)
- `zoho-middleware/scripts/backfill/README.md` — private-tunnel connection procedure (steps 3a-3d), fallback public-proxy note
- `zoho-middleware/scripts/backfill/specs/vessel-history.js`, `plato-readings.js`, `ferm-schedules.js` — `header` values corrected to match the real sheet row 1 (Postgres column names unchanged)
- `zoho-middleware/scripts/backfill/backfill.js` — always prints a `Checks: PASS/FAIL` result line after step `[5/6]`
- `zoho-middleware/__tests__/backfill/normalize.test.js`, `spec-headers.test.js` (new), `cli-checks-output.test.js` (new), `__tests__/db/backfill.test.js` — regression coverage for the header fix and the Checks output line

## Decisions Made

See `key-decisions` in the frontmatter above (testcontainers pin, VesselHistory bin_id fix scope, private-tunnel-only connectivity, GO/no-go for 83-09).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Pinned testcontainers to 11.14.0**
- **Found during:** Task 1 (local `npm run test:db` gate)
- **Issue:** `testcontainers@12.0.4` (latest) pulls in `undici@8`, which requires Node >=22.19; this repo and CI standardize on Node 20.20/20.x.
- **Fix:** Pinned `testcontainers` to `11.14.0` in `zoho-middleware/package.json`.
- **Verification:** `npm run test:db` ran real Postgres containers locally and on CI with 0 skipped.
- **Committed in:** `a298a169` (prior session, referenced in verified_results; not part of this plan's own commit range but required to reach Task 1's green gate)

**2. [Rule 1 - Bug] Fixed exceljs/jest.resetModules interaction and a rollbackEachTest client leak**
- **Found during:** Task 1 (first real-Postgres CI run)
- **Issue:** Two latent bugs surfaced only once the DB suite actually ran against real Postgres instead of being skipped.
- **Fix:** `089575cd` (exceljs/jest.resetModules), `2363caa0` (rollbackEachTest client leak) — both from the prior session per verified_results, required before Task 1's CI gate turned green.
- **Verification:** `npm run test:db` 26/26 passed, 0 skipped.

**3. [Rule 1 - Bug] Backfill spec headers didn't match the real sheet**
- **Found during:** Task 2 (owner rehearsal, run 1 — 100% rejects on all three sheets)
- **Issue:** `specs/{vessel-history,plato-readings,ferm-schedules}.js` used Postgres column names as the `header` value instead of the sheet's actual row-1 text, so every required cell read as missing.
- **Fix:** Corrected `header` values to the verified sheet headers; added `__tests__/backfill/spec-headers.test.js` pinning each spec to the real headers; renamed raw fixture inputs in `normalize.test.js`/`db/backfill.test.js` to match (assertions on normalised column names unchanged).
- **Files modified:** `zoho-middleware/scripts/backfill/specs/{vessel-history,plato-readings,ferm-schedules}.js`, `__tests__/backfill/{normalize,spec-headers}.test.js`, `__tests__/db/backfill.test.js`
- **Verification:** Rehearsal run 2 — all three sheets, zero rejects, Checks PASS, exit 0.
- **Committed in:** `3fb4cc83`

**4. [Rule 2 - Missing Critical] Checks step printed no PASS/FAIL line on some paths**
- **Found during:** Task 2 (owner rehearsal, reviewing CLI output)
- **Issue:** `backfill.js` step `[5/6] Checks` did not always print an explicit `Checks: PASS/FAIL` result line, making it ambiguous whether checks ran or what they concluded.
- **Fix:** Always print `Checks: PASS (<n> checks)` or `Checks: FAIL — ... (<x> of <n> checks failed)` after step `[5/6]`, regardless of `--promote`.
- **Files modified:** `zoho-middleware/scripts/backfill/backfill.js`, `__tests__/backfill/cli-checks-output.test.js` (new)
- **Verification:** New test suite (153 lines) covers both PASS and FAIL output paths.
- **Committed in:** `c5850712`

**5. [Rule 4 - Architectural, owner-approved] Live sheet data bug: VesselHistory missing bin_id header**
- **Found during:** Task 2 (owner rehearsal, diagnosing the 100% reject on VesselHistory)
- **Issue:** The live Google Sheet's VesselHistory header row (row 1) was missing a `bin_id` column; Apps Script had been appending an 8th value per row since Feb 2026, so every row's data was shifted one column right of its header — BrewPad's vessel-history UI had been displaying bins as transfer dates for roughly 8 months.
- **Fix:** This is a change to live production data outside any file this plan modifies, and outside Claude's write access (the production workbook). Surfaced to the owner per Rule 4; owner approved and personally inserted the missing `bin_id` header at column E1 in the live sheet (shifting subsequent headers right) on 2026-10-02.
- **Verification:** Rehearsal run 2 (after the sheet fix + spec fix) read VesselHistory cleanly: 401/401/0 rejected, Checks PASS (25 checks), exit 0.
- **Committed in:** N/A (live sheet edit, not a code change; documented here and in `docs/RUNBOOK.md`'s staging verification entry)

---

**Total deviations:** 5 (1 blocking dependency pin, 2 bugs, 1 missing-critical UX fix, 1 owner-approved live-data fix)
**Impact on plan:** All five were necessary to reach a real, trustworthy green CI run and a real, trustworthy rehearsal result — none were scope creep. The live-data fix (#5) was the most consequential: without it, the rehearsal's 100% reject rate would have been misread as a spec-header-only issue, when it was also masking an 8-month-old production data integrity bug that BrewPad's UI had been silently displaying incorrectly.

## Issues Encountered

- **CI `test-e2e` job failed on the pushed SHA** (`ed42907b`) — confirmed **pre-existing and unrelated**: `test-e2e` has failed on every `Tests` run on staging `main` since at least 2026-09-23 (runs `35906643315`, `36047368823`, `36755519758`), while every other job (`test-middleware`, `test-frontend`, `artifact-drift`) passes. Per CLAUDE.md scope-boundary rules, this is out of scope for Phase 83 and was not fixed. Flagged as a go/no-go consideration for Plan 83-09 only insofar as a gated-deploy workflow that waits on the overall `Tests` workflow conclusion (rather than specific job conclusions) would currently block on this pre-existing failure.
- **CI printed a `pg` deprecation warning**: `client.query() when the client is already executing a query ... removed in pg@9.0`. Not investigated (out of scope for this plan — no file in this plan's scope caused it); logged as a follow-up below.
- **Staging Postgres password was pasted into the chat/session** on 2026-10-02 during rehearsal setup troubleshooting (not by the plan's own design — the owner's terminal is supposed to be the only place it appears per D-10/D-13). Staging has no public endpoint, limiting blast radius, but the password should be rotated as a precaution.

## Follow-ups / Deferred Items

The following were identified during this plan but are explicitly deferred (not fixed here, per scope boundaries or because they require owner/infra action):

- `test-e2e` CI job has been failing on staging `main` since >= 2026-09-23, unrelated to Phase 83 — needs separate investigation before any gated-deploy that blocks on the full `Tests` workflow conclusion.
- `pg` client deprecation warning (`client.query() when the client is already executing a query` — removed in `pg@9.0`) surfaced during CI; not yet traced to a call site.
- Backfill `runChecks` currently reports `Checks: PASS` even when a sheet reads 0 rows and accepts 0 rows — should fail or warn when `read > 0 and accepted === 0` (i.e. distinguish "nothing to check" from "nothing survived"). Not caught by this rehearsal only because all three real sheets rehearsed read > 0 rows.
- No format validation on `history_id` (expected `VH-NNNNNN`) in the VesselHistory spec — not enforced yet.
- **Rotate the staging Postgres password** — it was pasted into this chat session on 2026-10-02 during rehearsal troubleshooting; staging has no public endpoint, but rotation is still recommended.
- Railway's "Config as Code is deprecated" deadline is 2026-12-01; `railway config migrate` exists to move `/railway.toml` settings to IaC before then, or `preDeployCommand` will silently stop running on deploy.
- `zoho-middleware`'s `npm run lint` only covers `routes/`, `lib/`, `server.js` — it does not lint `scripts/` or `__tests__/`, so the new backfill CLI/spec/test files added across Plans 83-06/83-07/83-08 have never been through ESLint.
- Local default Node (`nvm` default, 20.17) is too old for this repo's `testcontainers`-pinned dependency tree — `nvm use 20.20` must be run explicitly every session; not yet made the `nvm` default or pinned via `.nvmrc`.
- `api.steinsandvines.ca` custom domain is configured but unverified in Railway (missing `_railway-verify.api` TXT record in Cloudflare); currently unused by the live site, so not urgent, but should be cleaned up or completed.
- Railway's Hobby workspace plan has no Backups or PITR on either Postgres database — explicitly called out in `docs/RUNBOOK.md` as a **Phase 84 blocker** (D-16): real balances must not be loaded into Postgres until the workspace is upgraded to Pro or a scheduled `pg_dump` exists.

## User Setup Required

None remaining from this plan. All owner-gated actions (Railway log confirmation, backfill rehearsal with `BACKFILL_DATABASE_URL`, the live-sheet `bin_id` header fix) were completed in Task 2.

## Next Phase Readiness

- **Plan 83-09: GO for code.** All of DB-02's success criteria (SC1-SC4) are verified live on staging: `/health` reports `database:true`; pre-deploy migrations apply via `preDeployCommand`; CI runs real (non-skipped) Postgres tests; the Sheet mirror is confirmed DISABLED on staging; the backfill pipeline is proven end-to-end against real data with a correct rejects/checks/exit-code contract.
- Before proceeding to Plan 83-09, check whether any gated-deploy workflow gate waits on the overall `Tests` workflow conclusion rather than per-job conclusions — if so, the pre-existing `test-e2e` failure (unrelated to Phase 83, failing since >= 2026-09-23) would currently block it and needs a decision (ignore/fix/scope the gate to specific jobs).
- The VesselHistory live-sheet `bin_id` fix (Task 2) changes the *real* column layout going forward; any future backfill/consumer of VesselHistory data written before 2026-10-02 should account for the historical column shift if it ever needs to read pre-fix rows directly from a raw export rather than through this corrected spec.
- Phase 84 (first real Postgres-backed store) is blocked on Railway Pro/backups per `docs/RUNBOOK.md`'s D-16 note — this is an infra/billing decision, not a code gap.

## Verification Status

- Local gates (this session, before Task 3 commit): root `npm test` 141/141 suites, 2048/2048 tests green; root `npm run lint` clean; `zoho-middleware` `npm test` 129/129 suites, 1894/1894 tests green; `zoho-middleware` `npm run lint` clean.
- Plan verify command: `grep -c "Staging verification (" docs/RUNBOOK.md` → `1`; `grep -nE "postgres(ql)?://|proxy\.rlwy\.net:[0-9]" docs/RUNBOOK.md` → no matches (negated grep passes).
- `git status --porcelain` before/after Task 3 commit: only `docs/RUNBOOK.md` staged and committed; `links.html` (pre-existing unrelated modification) and `HANDOFF-infrastructure.md` (untracked, not this plan's) left untouched throughout.

## Self-Check: PASSED

- FOUND: docs/RUNBOOK.md contains exactly one "Staging verification (" entry
- FOUND: ed42907b53843b9c0693ffbd578f904bda76f642 (Task 1 commit, pushed to origin/main)
- FOUND: 3fb4cc83879d1f211c095d855d03ca6567b29ccc (Task 2 header-fix commit)
- FOUND: c5850712ca3ea97c654ef9c6a7a90473eda5ad28 (Task 2 Checks-output commit)
- FOUND: 168e3b2f269af64857b0c8ea5b88f623f5db61b1 (Task 2 README tunnel-procedure commit)
- FOUND: 4691dacc8ca903321837cf9a18c643324583c68c (Task 3 commit)
- FOUND: links.html left modified, uncommitted (not staged by this plan)
- FOUND: HANDOFF-infrastructure.md left untracked (not touched by this plan)

---
*Phase: 83-postgres-infrastructure*
*Completed: 2026-10-02*
