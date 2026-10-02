---
phase: 83-postgres-infrastructure
verified: 2026-10-02T00:00:00Z
status: human_needed
score: 36/36 must-haves verified (all code-level must-haves closed; 2 deploy-time items require owner action, not code)
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 32/33
  gaps_closed:
    - "Deploy-time migrations are additive only: a guard rejects DROP/TRUNCATE/RENAME/ALTER…TYPE/DELETE/UPDATE in any Up section, both in `npm test` and inside the pre-deploy command itself (83-03, D-04) — CLOSED by 83-13 (new parser-backed allowlist) + 83-14 (wired into the pre-deploy chain), independently re-verified in this pass including a fresh adversarial re-review (83-REVIEW.md)."
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Push to staging and open the Railway staging deploy's pre-deploy log."
    expected: "The log shows both `migration-guard: N file(s) additive-only OK` and `migration-allowlist: N file(s) additive-only OK` before `node-pg-migrate up` runs. If `migration-allowlist.js`'s WASM load fails on Railway's build image, the deploy must abort (fail-closed) and the previous release must keep serving."
    why_human: "libpg-query's WASM load has never been run inside Railway's actual build/pre-deploy container (research assumption A1, unverified by any party, including this verifier). Can only be confirmed by watching a real deploy log, which is a deploy action outside this verifier's scope (CLAUDE.md: deployment is the owner's call)."
  - test: "Confirm scheduled pg_dump backups (or a Railway plan with backups) are running for the production database, and that a restore has actually been tested."
    expected: "A working, tested restore path exists before Phase 84 writes migration 0002 next to real gift-card money data (owner decision 4, 83-GUARD-RESEARCH.md)."
    why_human: "This is an infrastructure/ops action (Railway plan change or cron'd pg_dump + a restore drill) with no code artifact in this repo to grep for; the owner must confirm it happened."
---

# Phase 83: Postgres Infrastructure Verification Report

**Phase Goal:** Both environments have their own Postgres, the middleware can query it transactionally under test, and the migration, backfill and store-flag machinery every later phase reuses exists and is proven on an empty schema.
**Verified:** 2026-10-02
**Status:** human_needed
**Re-verification:** Yes — after gap closure (plans 83-13, 83-14), third verification pass for this phase (prior passes covered 83-01..83-12, 83-10/83-11/83-12)

## Bottom line

The single remaining gap from the prior VERIFICATION.md — the migration guard being bypassable (CR-01..CR-04 from the 83-REVIEW re-review) — is **CLOSED**. Plan 83-13 added a second, independent guard (`scripts/migration-allowlist.js`) that judges every statement from the real Postgres 16 AST (via `libpg-query@16.7.3`, the actual C parser Postgres uses, compiled to WASM) rather than scanning text. Plan 83-14 wired it into the exact command Railway's `preDeployCommand` runs, proved on a real `postgres:16-alpine` container that the Phase-84-shaped additive fixtures apply cleanly and that the specific CR-02a bypass is blocked end to end, and rewrote `migrations-manual/README.md` to stop over-claiming.

This verifier independently reproduced all of the load-bearing claims rather than trusting the SUMMARYs:

- Ran `node scripts/migration-allowlist.js` directly against each of the four original CR-01..CR-04 payloads (reconstructed from the prior VERIFICATION.md's own reproduction text) and got `statement-not-allowed` / `alter-not-allowed` for all four — not `[]`.
- Ran the full middleware suite (`npm test`: 135 suites / 2121 tests), the full root suite (`npm test`: 141 suites / 2048 tests), both lints (clean), and `CI=true npm run test:db` (5 suites / 35 tests, including the new `migration-allowlist-apply.test.js` against real Postgres 16 — not skipped, Docker was available).
- Ran `node scripts/migration-guard.js`, `node scripts/migration-allowlist.js`, and `npm run migrate:guard` directly against the real `migrations/` directory — all exit 0 with the documented OK lines.
- Confirmed via `grep`/`node -e` that `package.json` scripts and `railway.toml`'s `preDeployCommand` match the plan's required chain exactly, and that `scripts/migration-guard.js` + its two test files are byte-identical to the base commit (0 matching commits from 83-13/83-14).
- Read the new `83-REVIEW.md` (deep re-review, commit `12ca895e`) in full: 0 new Criticals, 1 Warning (a NUL byte truncates the allowlist's own parse — see below), 3 Info items, all 16 carried-forward items unchanged and out of scope for this diff.
- Independently reproduced the new Warning (NUL-byte truncation returns `[]` from `migration-allowlist.js` alone) **and** confirmed the first-pass `scripts/migration-guard.js` (which runs *before* the allowlist in the `&&` chain) catches that exact payload (`rule: 'drop'`) — so the two-guard chain as actually wired is not defeated by it today.

**Status is `human_needed`, not `passed`, purely because of two deploy-time/ops items that cannot be verified from this repository: the Railway staging pre-deploy log (whether libpg-query's WASM actually loads in Railway's build container, never yet observed) and the Phase-84 backup/restore hard prerequisite (owner decision 4). Both plans explicitly flag these as out of scope and owner-gated, and 83-14's SUMMARY lists them under "Open deploy-time items." Nothing has been pushed to staging or production since gap closure began.**

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | Railway Postgres in staging + production, distinct DATABASE_URLs, validateEnv refuses boot without one, /health reports database | VERIFIED (regression) | Unchanged since initial verification; files untouched by 83-13/14. |
| SC2 | lib/db.js single pool/query/withTransaction; node-pg-migrate applies 0001_init.sql on deploy | VERIFIED (regression) | `node scripts/migration-guard.js` and `node scripts/migration-allowlist.js` both reran by verifier against the real `migrations/` dir, both exit 0. |
| SC3 | Jest harness: real Postgres per test process, per-test rollback, CI runs it, round-trip green | VERIFIED | Reran by verifier: `CI=true npm run test:db` → 5 suites / 35 tests, all pass, none skipped (Docker available). |
| SC4 | Store flag; mirror hard-off staging; backfill end-to-end with rejects report, zero rows to real tables | VERIFIED (regression) | Unchanged store-flag/mirror/backfill code; `npm test` green. |
| G1 (83-03/83-10/83-13/83-14, D-04) | Guard rejects destructive statements in Up, both in `npm test` and pre-deploy — the previously open gap | **VERIFIED (CLOSED)** | New `scripts/migration-allowlist.js` rejects all four original bypasses when run directly by the verifier: CR-01a → `statement-not-allowed` (`SelectStmt`/`DropStmt`), CR-02a → `statement-not-allowed` (`CreateFunctionStmt`/`SelectStmt`), CR-04 → `alter-not-allowed` (`AT_AlterColumnType`). Chained into `npm run migrate` / `migrate:guard` (verified via `node -e` reading `package.json`) and into `railway.toml`'s unchanged `preDeployCommand` (verified via `grep`). Proven on real Postgres 16 in `__tests__/db/migration-allowlist-apply.test.js` (reran, passing, not skipped): CR-02a is blocked end to end with neither `pgmigrations` nor `app_meta` created. |
| G2 (83-06, D-12) | Normaliser rejects (never coerces) unconvertible cells | VERIFIED (regression, unchanged since last pass) | Files untouched by 83-13/14; `npm test` green. |
| G3 (83-07, D-12) | Checks/promote can fail on a sheet that loaded nothing or lost a column | VERIFIED (regression, unchanged since last pass) | Files untouched by 83-13/14; `npm test` green. |
| T-83-13-01 | CREATE FUNCTION/PROCEDURE/TRIGGER, DO, CALL are always rejected, no exception mechanism | VERIFIED | Verifier ran `checkSql` directly on a `DO $$ ... $$`, a `CALL p()`, and a `CREATE TRIGGER ... EXECUTE FUNCTION` — all three return `statement-not-allowed`. |
| T-83-13-02 | Any backslash anywhere in an Up section is rejected before parsing | VERIFIED | Verifier ran `checkSql` on `CHECK (a ~ '\d')` — returned a single `backslash` violation with the documented explanatory message. |
| T-83-13-03 | Additive DDL (0001_init.sql, Phase-84-shaped fixtures) produces zero violations | VERIFIED | `node scripts/migration-allowlist.js` against real `migrations/` exits 0, `1 file(s) additive-only OK`; `ADD COLUMN w int DEFAULT 0` direct-checked by the verifier returns `[]`; the 5 `apply: true` fixtures pass both guards and apply cleanly in `migration-allowlist-apply.test.js` (reran by verifier against real Postgres 16). |
| T-83-14-01 | railway.toml `preDeployCommand` resolves through BOTH guards, pinned by a test | VERIFIED | `grep` of `railway.toml` shows the unchanged `preDeployCommand = "cd zoho-middleware && npm run migrate"`; `node -e` against `package.json` shows `scripts.migrate` = `node scripts/migration-guard.js && node scripts/migration-allowlist.js && node-pg-migrate up`; `migration-allowlist-wiring.test.js` included in the 225-test subset the verifier reran, passing. |
| T-83-14-02 | `npm run migrate:guard` runs both guards | VERIFIED | Verifier ran `npm run migrate:guard` directly: prints both `migration-guard: 1 file(s) additive-only OK` and `migration-allowlist: 1 file(s) additive-only OK`, exit 0. |
| T-83-14-03 | README describes what is actually enforced, no over-claim | VERIFIED | `grep -c "is rejected before ... node-pg-migrate ... touches the database"` returns 0; all 12 rule names, "Known limits", `libpg-query`, `[0-9]`, `## Procedure`, and `pgmigrations_manual` all present (verifier re-ran the plan's own verify command). |
| T-83-14-DEPLOY | First staging pre-deploy log shows both OK lines; libpg-query WASM loads on Railway | **UNCERTAIN — human verification required** | Not provable from this repo; nothing has been pushed to staging since gap closure began (per orchestrator context). |
| T-GR-04 (owner decision 4) | Backups + tested restore in place before Phase 84 | **UNCERTAIN — human verification required** | Infra/ops action with no code artifact to check; explicitly out of scope for 83-13/83-14. |

**Score:** 36/36 code-level truths verified (the prior score's 33 plus the additional specific truths the gap-closure plans introduced). Two items remain genuinely outside what grep/tests can prove and are routed to human verification, not reported as code gaps.

### New Finding From the Fresh Review (83-REVIEW.md) — Reported, Not a Gap

`83-REVIEW.md`'s `WR-01` (new): a NUL byte (`\0`) in the Up section silently truncates `libpg-query`'s own parse, so `scripts/migration-allowlist.js` alone would return `[]` (accept) for `CREATE TABLE ok (a int);\0DROP TABLE gift_cards;` — this contradicts the module's own "fail-closed by construction" / "a parse error is a violation" claims.

The verifier independently reproduced this: `checkSql()` on that exact payload returns `[]`. However, the verifier also independently confirmed — by running the *actual* first-pass guard in the chain, `scripts/migration-guard.js`, against the identical payload — that it returns a `drop` violation (`[{"statement":"\u0000DROP TABLE gift_cards","rule":"drop"}]`). Because the real chain is `migration-guard.js && migration-allowlist.js && node-pg-migrate up` (guard runs first, confirmed by `grep` of `package.json`), this specific payload is still blocked end to end today. The 83-REVIEW.md reviewer additionally verified on a real `postgres:16-alpine` container that the Postgres wire protocol itself rejects a NUL-containing query (`invalid message format`), giving a second independent backstop.

**This is reported as a WARNING, not a BLOCKER**, for three reasons: (1) it was not part of any must-have in the 83-13/83-14 plan frontmatter — it is a new finding from the fresh adversarial review of the code those plans just delivered; (2) no end-to-end data-destroying exploit was found by the reviewer or by this verifier despite directly trying the combination; (3) the fix is small (mirror the existing backslash pre-parse gate with a NUL check) and the reviewer's own report includes the fix and a fixture to add. It should be fixed before Phase 84, but it does not by itself reopen "is the two-guard chain, as actually wired, proven against every known attack" — it remains true today only because of the *other* guard's independent regex scan, which is a fragile reason to rely on (a future reordering of the `&&` chain, or a different post-NUL payload the old guard's regex doesn't catch, would turn this into a real bypass). Recommend a quick follow-up plan before Phase 84 starts, or an explicit owner override if the risk is accepted as-is.

**If the owner wants to proceed to Phase 84 without a dedicated follow-up plan for the NUL-byte robustness gap, add to this file's frontmatter:**

```yaml
overrides:
  - must_have: "migration-allowlist.js is fail-closed by construction (no input it cannot classify is ever silently accepted)"
    reason: "NUL-byte truncation of libpg-query's parse is real, but today's chain (migration-guard.js running first) and Postgres's own NUL rejection in the wire protocol both independently block the one concrete exploit found; tracked as a pre-Phase-84 hardening item instead of reopening Phase 83"
    accepted_by: "<owner>"
    accepted_at: "<ISO timestamp>"
```

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `zoho-middleware/scripts/migration-allowlist.js` | VERIFIED | Exists (18,378 bytes), exports `ready`/`checkSql`/`checkMigrationsDir`/`findUnguardedFiles` (all called directly by the verifier), fail-closed behaviour confirmed against CR-01/02/04, DO/CALL/CREATE TRIGGER, backslash, and additive-accept cases. |
| `zoho-middleware/__tests__/fixtures/migration-allowlist-cases.js` | VERIFIED | Exists, present and required successfully by the test suite (118 cases per SUMMARY; verifier reran the consuming test file, all passing). |
| `zoho-middleware/__tests__/migration-allowlist.test.js` | VERIFIED | Exists, part of the 225-test subset the verifier reran directly, all passing. |
| `zoho-middleware/__tests__/migration-allowlist-wiring.test.js` | VERIFIED | Exists, part of the same reran subset, all passing; independently confirmed its assertions (script strings, railway.toml line) by `grep`/`node -e` rather than trusting the test alone. |
| `zoho-middleware/__tests__/db/migration-allowlist-apply.test.js` | VERIFIED | Exists, reran by the verifier via `CI=true npm run test:db` against a real `postgres:16-alpine` container — passed, not skipped. |
| `zoho-middleware/migrations-manual/README.md` | VERIFIED | Rewritten section confirmed present and accurate: over-claim sentence gone (count 0), all 12 rule names present, "Known limits" section present, `## Procedure`/`pgmigrations_manual` preserved. |
| `zoho-middleware/package.json` | VERIFIED | `dependencies['libpg-query'] === '16.7.3'`, no `devDependencies` entry (confirmed via `node -e`); `scripts.migrate`/`scripts['migrate:guard']` match the required chain exactly. |
| `railway.toml` | VERIFIED | `preDeployCommand`/`buildCommand` values unchanged; comment block mentions `migration-allowlist.js` (confirmed via `grep`). |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `railway.toml preDeployCommand` | `package.json scripts.migrate` | `cd zoho-middleware && npm run migrate` | WIRED (grep-confirmed, command value unchanged) |
| `package.json scripts.migrate` | `migration-guard.js` then `migration-allowlist.js` then `node-pg-migrate up` | `&&` chain | WIRED (node -e confirmed exact string) |
| `migration-allowlist-wiring.test.js` | real `npm run migrate:guard` child process | `childProcess.spawnSync` | WIRED (test reran directly by verifier, plus verifier's own independent `npm run migrate:guard` run) |
| `migration-allowlist-apply.test.js` | real Postgres 16 via Testcontainers | `describeDb` / `startPostgres()` | WIRED (reran by verifier, not skipped — Docker present) |
| `migration-guard.js` (first pass) | `migration-allowlist.js` (authoritative) | sequential `&&`, guard runs first | WIRED — and this ordering is load-bearing for the NUL-byte finding above (see Warning) |

### Data-Flow Trace (Level 4)

Not applicable in the UI sense — these are CLI guard scripts, not components rendering fetched data. The equivalent (does the guard's exit code actually gate `node-pg-migrate up`) is covered under Key Link Verification and the real-Postgres proof in `migration-allowlist-apply.test.js` (CR-02a test: neither `pgmigrations` nor `app_meta` created when the chain rejects).

### Behavioral Spot-Checks (run independently by this verifier)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full middleware suite | `cd zoho-middleware && npm test` | 135 suites / 2121 tests passed | PASS |
| Full root (frontend) suite | `npm test` | 141 suites / 2048 tests passed | PASS |
| Middleware lint | `cd zoho-middleware && npm run lint` | clean | PASS |
| Root lint | `npm run lint` | clean | PASS |
| Real-PG DB suite | `cd zoho-middleware && CI=true npm run test:db` | 5 suites / 35 tests passed, none skipped | PASS |
| Guard + allowlist on real migrations/ | `node scripts/migration-guard.js && node scripts/migration-allowlist.js` | both print `... 1 file(s) additive-only OK`, exit 0 | PASS |
| `npm run migrate:guard` | `npm run migrate:guard` | both OK lines printed, exit 0 | PASS |
| CR-01a reproduction | `checkSql('-- Up Migration\nselect 1 as a$$t$;\n...drop table gift_cards;...')` | `[{rule:'statement-not-allowed'}, ...]` (3 violations) | PASS — bypass closed |
| CR-02a reproduction | `checkSql("-- Up Migration\nCREATE FUNCTION wipe() ... AS 'DELETE FROM gift_cards';\nSELECT wipe();...")` | 2 `statement-not-allowed` violations | PASS — bypass closed |
| CR-04 reproduction | `checkSql('-- Up Migration\nALTER TABLE gift_cards ALTER COLUMN U&"balance" TYPE integer;...')` | `alter-not-allowed` | PASS — bypass closed |
| DO / CALL / CREATE TRIGGER | direct `checkSql` calls | all three → `statement-not-allowed` | PASS |
| Backslash ban | `checkSql` on `CHECK (a ~ '\d')` | single `backslash` violation | PASS |
| Additive accept | `checkSql` on `ADD COLUMN w int DEFAULT 0` | `[]` | PASS |
| New WR-01 (NUL byte) reproduction | `checkSql` on NUL-containing payload | `[]` (allowlist alone accepts) | **CONFIRMED — see Warning above** |
| Old guard on same NUL payload | `migration-guard.js findDestructiveStatements` on same payload | `[{rule:'drop'}]` | Confirms chain-as-wired still blocks it today |
| Old guard + its tests untouched | `git log --format=%s -- scripts/migration-guard.js __tests__/migration-guard.test.js __tests__/migration-guard-hardening.test.js \| grep -c "83-13\|83-14"` | `0` | PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` files declared or present for this phase. Skipped (unchanged from prior verifications).

### Requirements Coverage

| Requirement | Source Plans | Status | Evidence |
|-------------|--------------|--------|----------|
| DB-02 | 83-01 … 83-14 (all 14 plans declare `requirements: [DB-02]`) | SATISFIED | Every ROADMAP SC clause holds (SC1–SC4 verified); the previously-open hardening gap (guard bypassability) is now closed and independently re-verified; the two residual items (staging pre-deploy log, backup/restore) are deploy-time/ops actions explicitly out of scope for code plans and correctly routed to human verification. `.planning/REQUIREMENTS.md:129` is still unticked `[ ]` as of this check — ticking it is an orchestrator/roadmap action, not something this verifier performs, but the evidence here supports ticking it once the two human-verification items are confirmed (or accepted as deploy-gated, not phase-gated). |

No orphaned requirements — REQUIREMENTS.md maps only DB-02 to Phase 83, and all 14 plans (including 83-13/83-14) correctly declare it.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (83-13/83-14 files scanned: migration-allowlist.js, its 3 test files, package.json, railway.toml, README.md) | — | TBD/FIXME/XXX | — | None found |
| `__tests__/fixtures/migration-allowlist-cases.js:24` | 24 | Contains the literal string "TODO" | INFO | This is test-fixture *data* (a case proving a comment containing the text "TODO: consider a drop table x migration later" does not get misparsed), not a debt marker in production code. Not a blocker. |
| `scripts/migration-allowlist.js` | n/a | A NUL byte silently truncates the parser | WARNING (83-REVIEW.md WR-01, new) | See "New Finding" section above — not currently exploitable through the wired chain, but contradicts the module's own fail-closed contract. Recommend fixing before Phase 84. |
| `package.json:11` (lint script) | 11 | `scripts/` is not in the ESLint target list, so neither migration guard is linted by `npm run lint` | INFO (83-REVIEW.md IN-01, new) | Pre-commit lint gate never checks the code that gates every production deploy. Low-cost fix (`eslint routes/ lib/ scripts/ server.js`), not phase-blocking. |
| `scripts/backfill/load.js`, `backfill.js` | (as previously reported) | `Promise.all` over one client; client-release-on-error; raw connection string in error message | WARNING (carried forward, unchanged, out of scope for this diff) | Unchanged from prior verification passes. |

### Human Verification Required

### 1. Railway staging pre-deploy log shows both guard OK lines

**Test:** Push the current `main` to `staging.steinsandvines.ca` (per CLAUDE.md deployment rules) and open the Railway staging deploy's pre-deploy log.
**Expected:** The log shows `migration-guard: N file(s) additive-only OK` followed by `migration-allowlist: N file(s) additive-only OK`, both before `node-pg-migrate up` runs. If the `migration-allowlist:` line is absent or the deploy shows a WASM load error, the deploy must have aborted and the previous release must still be serving traffic.
**Why human:** libpg-query's WASM load inside Railway's actual build/pre-deploy container has never been observed by anyone (research assumption A1) — this verifier can only run it locally and via Testcontainers, not inside Railway's build image.

### 2. Backup and restore drill completed before Phase 84

**Test:** Confirm scheduled `pg_dump` backups (or a Railway plan with managed backups) are active for the production database, and that a restore has actually been exercised at least once.
**Expected:** A working, tested restore path exists.
**Why human:** This is an infrastructure/ops decision and action (owner decision 4, 83-GUARD-RESEARCH.md) with no corresponding code artifact in this repository to check programmatically.

### Gaps Summary

**No code-level gaps remain.** The one gap carried over from the prior VERIFICATION.md — the migration guard being bypassable via the CR-01..CR-04 parser-differential tricks — is closed: plan 83-13 replaced "trust a hand-written tokenizer" with "trust the real Postgres 16 AST," and plan 83-14 wired it into the actual deploy command and proved it on real Postgres 16, including proving the specific CR-02a bypass is now blocked end to end. This verifier independently reran every load-bearing check (unit tests, DB tests, lints, direct `checkSql()` calls against all four original bypass payloads, and the actual `railway.toml`/`package.json` wiring) rather than trusting the SUMMARY.md narration, and found no discrepancy.

A fresh, independent adversarial review (`83-REVIEW.md`) of the delivered 83-13/83-14 code found 0 new Criticals and 1 new Warning (a NUL-byte parser-truncation edge case in the allowlist's own code, not currently exploitable through the wired two-guard chain, reported above as a WARNING with a suggested override). Status is `human_needed` rather than `passed` solely because two deploy-time/ops items — the first real Railway staging pre-deploy log, and the Phase-84 backup/restore hard prerequisite — cannot be verified from the codebase and require the owner's action, exactly as both gap-closure plans themselves flagged.

---

_Verified: 2026-10-02_
_Verifier: Claude (gsd-verifier)_
