---
phase: 83-postgres-infrastructure
plan: 14
subsystem: database
tags: [libpg-query, postgres, migration-guard, migration-allowlist, node-pg-migrate, railway, d-04, gap-closure]

# Dependency graph
requires:
  - phase: 83-postgres-infrastructure
    provides: "scripts/migration-allowlist.js (fail-closed parser allowlist), __tests__/fixtures/migration-allowlist-cases.js (118-case corpus with 5 apply:true fixtures in dependency order), libpg-query@16.7.3 (83-13)"
provides:
  - "zoho-middleware/package.json scripts.migrate / migrate:guard chain migration-guard.js && migration-allowlist.js (&& node-pg-migrate up for migrate) — the actual Railway preDeployCommand now runs the allowlist"
  - "zoho-middleware/__tests__/migration-allowlist-wiring.test.js — npm-test pin of the exact script strings, railway.toml preDeployCommand line, and the libpg-query dependencies pin"
  - "zoho-middleware/__tests__/db/migration-allowlist-apply.test.js — real-PG16 (Testcontainers) proof: 5 apply:true fixtures apply cleanly; the chained command blocks REVIEW CR-02a (an old-guard bypass) before node-pg-migrate runs; npm run migrate itself runs both guards"
  - "zoho-middleware/migrations-manual/README.md — rewritten to describe both guard layers, the exact allowlist (statements/ALTER subcommands/functions/schema rule), all 12 allowlist rule names, and a Known Limits section (REVIEW WR-02 over-claim removed)"
affects: [84-recipes-and-recipeingredients, any future phase adding migrations/NNNN_*.sql, verify-work-83]

# Tech tracking
tech-stack:
  added: []
  patterns: ["wiring tests that spawn the real npm script (childProcess.spawnSync) rather than asserting source text alone, so an unwiring that still 'looks right' in package.json but breaks at runtime is caught", "real-Postgres end-to-end proof of a security guard via Testcontainers rather than unit-testing the guard module in isolation"]

key-files:
  created:
    - zoho-middleware/__tests__/migration-allowlist-wiring.test.js
    - zoho-middleware/__tests__/db/migration-allowlist-apply.test.js
  modified:
    - zoho-middleware/package.json
    - railway.toml
    - zoho-middleware/migrations-manual/README.md

key-decisions:
  - "Fixture file names for the real-PG apply test (0001_init.sql, 0002_gift_cards.sql, 0003_later_additive.sql, 0004_public_qualified.sql, 0005_regex_check.sql) match the plan's required order and dependency chain exactly — no reordering needed since 83-13 already placed the 5 apply:true cases in this order"
  - "migration-guard.js and both of its test files (__tests__/migration-guard.test.js, __tests__/migration-guard-hardening.test.js) remain byte-identical to the plan's starting commit — verified via git diff against the base commit (0 lines changed)"
  - "README rewrite removed the WR-02 over-claim sentence entirely rather than softening it, replacing it with a dedicated 'Known limits' section enumerating the actual residual risks from 83-GUARD-RESEARCH.md"

requirements-completed: [DB-02]

# Metrics
duration: ~35min
completed: 2026-10-02
---

# Phase 83 Plan 14: Wire the Parser Allowlist Into the Deploy Path (Gap Closure) Summary

**Railway's actual `preDeployCommand` now runs both migration guards (`migration-guard.js && migration-allowlist.js && node-pg-migrate up`), pinned by a wiring test and proven end-to-end on real Postgres 16: the allowlist-accepted fixtures apply cleanly and the REVIEW CR-02a old-guard bypass is blocked before `node-pg-migrate` ever touches the database.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3
- **Files created:** 2
- **Files modified:** 3 (package.json, railway.toml, migrations-manual/README.md)

## Accomplishments

- `zoho-middleware/package.json` `migrate` / `migrate:guard` scripts now chain `node scripts/migration-guard.js && node scripts/migration-allowlist.js` (plus `&& node-pg-migrate up` for `migrate`) — Railway's `preDeployCommand = "cd zoho-middleware && npm run migrate"` is **unchanged** but now resolves through both guards
- `railway.toml`'s pre-deploy comment block rewritten to describe the two-guard chain and the `libpg-query` dependency requirement; the command values themselves (`buildCommand`, `preDeployCommand`, `startCommand`, `watchPatterns`) are untouched
- New `__tests__/migration-allowlist-wiring.test.js` (6 tests, part of `npm test`) pins: the exact `migrate` and `migrate:guard` script strings, the `railway.toml` `preDeployCommand` line via regex, that `buildCommand` contains `npm install --production`, that `libpg-query` is pinned to exactly `16.7.3` in `dependencies` (not `devDependencies`), and spawns `npm run migrate:guard` as a real child process to confirm both guards actually print their OK lines — confirmed RED (3/6 failing: scripts.migrate, migrate:guard, and the spawn assertion) before `package.json` was edited, then GREEN after
- New `__tests__/db/migration-allowlist-apply.test.js` (3 tests, `npm run test:db`, Testcontainers `postgres:16-alpine`, not skipped — Docker was available locally):
  - the 5 `apply: true` fixtures from 83-13's corpus (in array order: `0001_init.sql` real file → Phase 84 gift-card DDL → later-additive ALTER/ENUM/FK batch → explicit `public.` qualification → backslash-free regex `CHECK`) pass both guards individually and then apply cleanly via `node-pg-migrate`; `gift_cards`, `gift_card_transactions`, `gc_adjustments`, `ferm_schedules`, and `vessel_history` all resolve via `to_regclass`, `pgmigrations` has exactly 5 rows, and `app_meta` has the `gift_cards_store` seed row
  - the exact chained-command shape (`migration-guard.js "$D" && migration-allowlist.js "$D" && node-pg-migrate up -m "$D"`, values passed via env `$D`/`$BIN`/`DATABASE_URL`, never string-interpolated) blocks REVIEW CR-02a (`CREATE FUNCTION wipe() ... AS 'DELETE FROM gift_cards'; SELECT wipe();`) — first confirmed the OLD guard alone accepts this file (documents the gap), then confirmed the chain exits non-zero with `0002_bypass.sql: statement-not-allowed:` on stderr and neither `pgmigrations` nor `app_meta` exists afterward
  - `npm run migrate` itself (not a hand-assembled shell command) exits 0, prints both `migration-guard: ` and `migration-allowlist: ` in stdout, and leaves a `0001_init` row in `pgmigrations`
  - full `npm run test:db` (all 5 db suites, 35 tests) stayed green
- `zoho-middleware/migrations-manual/README.md` rewritten above `## Procedure`: intro naming both guards, a "What the allowlist accepts" subsection (statement types, ALTER subcommands, the 9-function allowlist, the public-only schema rule), a "Rejected outright" subsection naming every rejected category plus the four no-exception policy items (functions/triggers always manual, backslash ban, parse errors, non-`.sql` files), a rule-name table for all 12 `migration-allowlist.js` rules plus a note on `migration-guard.js`'s older names, a "Known limits" section (replacing the removed over-claim sentence) listing the 83-GUARD-RESEARCH.md residual risks, and a "Widening the allowlist" note. `## Procedure` and `## Why not just edit a file in migrations/?` kept verbatim (neither mentioned only `migration-guard.js` as the deploy guard, so no fix was needed there)
- `migration-guard.js` and both of its existing test files (`__tests__/migration-guard.test.js`, `__tests__/migration-guard-hardening.test.js`) remain byte-identical to the plan's starting commit (`git diff` against base = 0 lines) — CLAUDE.md rule 10 honored
- Gates at completion: root `npm test` 141/141 suites (2048 tests), root `npm run lint` clean; `zoho-middleware npm test` 135/135 suites (2121 tests, +1 suite/+6 tests over the 83-13 baseline of 134/2115), `zoho-middleware npm run lint` clean; `zoho-middleware npm run test:db` 5/5 suites (35 tests), none skipped; `npm run migrate:guard` prints both `migration-guard: 1 file(s) additive-only OK` and `migration-allowlist: 1 file(s) additive-only OK`

## Task Commits

1. **Task 1: Chain the allowlist into migrate / migrate:guard and pin the pre-deploy wiring with a test** - `2bbc6016` (feat)
2. **Task 2: Real-Postgres proof — accepted fixtures apply, chain blocks an old-guard bypass, npm run migrate runs both guards** - `4cd1ba51` (test)
3. **Task 3: Rewrite migrations-manual/README.md guard section to match what is enforced (REVIEW WR-02)** - `d79062b9` (docs)

Every commit ran the full commit gate (root `npm test`, root `npm run lint`, `cd zoho-middleware && npm test`, `cd zoho-middleware && npm run lint`) before committing, per the plan's objective-level gate requirement. Task 1's wiring test was confirmed RED (3 of 6 assertions failing: `scripts.migrate`, `scripts['migrate:guard']`, and the `npm run migrate:guard` spawn assertion) before `package.json` was edited, then GREEN after — satisfying the plan's "run it and confirm assertions (1), (2) and (6) fail" instruction exactly.

## Files Created/Modified

- `zoho-middleware/package.json` — `migrate` / `migrate:guard` scripts now chain `migration-guard.js && migration-allowlist.js` (`migrate` also `&& node-pg-migrate up`)
- `railway.toml` — pre-deploy comment block describes the two-guard chain and the `libpg-query` dependency; no command values changed
- `zoho-middleware/__tests__/migration-allowlist-wiring.test.js` — new, 6 tests pinning the exact wiring
- `zoho-middleware/__tests__/db/migration-allowlist-apply.test.js` — new, 3 tests proving the chain on real Postgres 16
- `zoho-middleware/migrations-manual/README.md` — rewritten guard-description section; `## Procedure` / `## Why not just edit a file` kept verbatim

## Decisions Made

- No deviation from the plan's exact fixture file-naming order or chained-command shape was needed — 83-13's corpus already had the 5 `apply: true` cases in the correct dependency order, and none of them were rejected by the old guard (so the plan's "stop and ask the owner" fallback for that case never triggered).
- README rewrite fully removes (rather than softens) the WR-02 over-claim sentence, replacing it with an explicit "Known limits" section — matches the plan's instruction that the sentence "must be removed," not reworded.

## Deviations from Plan

None — plan executed exactly as written. No Rule 1-4 auto-fixes were needed; the allowlist, the old guard, and the fixture corpus all behaved exactly as 83-13 and the plan's `<interfaces>` block documented.

## Issues Encountered

None. Docker was available locally (`docker info` succeeded), so the real-Postgres test ran directly rather than needing a CI-only fallback. Node was pinned to 20.20.2 via `nvm use 20.20` for all commands in this plan (per the parallel_execution environment note — Node 20.17 breaks Testcontainers); both `zoho-middleware/node_modules` and root `node_modules` had to be installed fresh in this worktree (`npm ci` in both locations) before any test could run.

## User Setup Required

None — no external service configuration required. No new dependency was added in this plan (libpg-query@16.7.3 was already added to `dependencies` in 83-13).

## Open deploy-time items

1. **Staging pre-deploy log check (required before any production push):** after the owner pushes to staging (`git push origin main`), open the Railway staging deploy's pre-deploy log and confirm it shows both `migration-guard: N file(s) additive-only OK` and `migration-allowlist: N file(s) additive-only OK`. libpg-query's WASM load on Railway's build has never been run (research assumption A1) — it was only verified locally and against a Testcontainers Postgres 16 in this plan. If the staging pre-deploy log fails to show the `migration-allowlist:` OK line, the deploy is blocked (fail-closed) and the previous release keeps running; do not proceed to production until this line is confirmed on a real Railway build.
2. **Phase 84 hard prerequisite (owner decision 4, NOT done in this phase):** Phase 84 must not start until scheduled `pg_dump` backups (or a Railway plan with backups) run for production AND a restore has been tested. This plan did not touch backup provisioning — it remains fully open, tracked outside this phase.

Deployment itself (staging push, production push) was not performed as part of this plan, per the objective's explicit out-of-scope note and CLAUDE.md's deployment-is-the-owner's-call rule.

## Next Phase Readiness

- Verification gap 1 (D-04's deploy-time wiring) is closed and ready for `/gsd:verify-work 83` re-verification: the chain is pinned by a test in `npm test`, and proven end-to-end against real Postgres 16 in `npm run test:db`.
- No code blockers for Phase 84. The two "Open deploy-time items" above are the only remaining gates before any production migration ships: (1) a real Railway staging pre-deploy log confirming the WASM load succeeds in that environment, and (2) the owner's hard backup/restore prerequisite.

---
*Phase: 83-postgres-infrastructure*
*Completed: 2026-10-02*

## Self-Check: PASSED

- FOUND: zoho-middleware/__tests__/migration-allowlist-wiring.test.js
- FOUND: zoho-middleware/__tests__/db/migration-allowlist-apply.test.js
- FOUND: zoho-middleware/migrations-manual/README.md
- FOUND: .planning/phases/83-postgres-infrastructure/83-14-SUMMARY.md
- FOUND commit: 2bbc6016 (feat(83-14): chain parser allowlist into migrate pre-deploy step (D-04))
- FOUND commit: 4cd1ba51 (test(83-14): prove allowlist on real Postgres 16 and block old-guard bypass end to end)
- FOUND commit: d79062b9 (docs(83-14): describe what the migration allowlist actually enforces (REVIEW WR-02))
