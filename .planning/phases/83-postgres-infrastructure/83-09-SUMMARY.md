---
phase: 83-postgres-infrastructure
plan: 09
subsystem: database
tags: [postgres, railway, gated-deploy, node-pg-migrate, sheet-mirror, production]

# Dependency graph
requires:
  - phase: 83-postgres-infrastructure (plan 08)
    provides: "Phase 83 verified live on staging: /health database:true, CI test:db green (26/26, 0 skipped), Sheet mirror confirmed DISABLED (environment=staging), backfill pipeline rehearsed end-to-end with zero rejects, GO-for-code recorded in docs/RUNBOOK.md"
provides:
  - "Phase 83 middleware live in production with its own Postgres (DATABASE_URL = ${{Postgres-EMVk.DATABASE_URL}}, distinct from staging's), migrations applying via preDeployCommand, /health reporting database:true"
  - "First gated production deploy of the Phase 83 code path: migration-guard + node-pg-migrate 0001_init applied pre-deploy, Sheet mirror confirmed ENABLED (environment=production) with all store modes still sheets"
  - "Recorded rollback target (prior ACTIVE production deployment id) and re-confirmed Hobby-plan backups status (D-16) before dispatch"
  - "docs/RUNBOOK.md Production cutover (2026-10-02) record under '#### Postgres (Phase 83)', plus the gated-deploy-authored Deploy History row"
affects: ["84-giftcards (first real store to read/write Postgres now runs against a production database that is live, empty, and proven on the deploy path)", "85-88 (same reuse)", "deferred-items (gh CLI left unauthenticated for workflow_dispatch; Hobby-plan backup gap remains a hard Phase 84 blocker per D-16)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "gh CLI unauthenticated for workflow_dispatch in this session — the gated-deploy workflow was dispatched via the GitHub Actions web UI instead; functionally equivalent (same workflow, same inputs, same checks) but not scriptable without re-authenticating gh first"

key-files:
  created: []
  modified:
    - docs/RUNBOOK.md

key-decisions:
  - "Dispatched via the GitHub web UI rather than `gh workflow run` because `gh` was unauthenticated in this session — a deviation from the plan's literal CLI instructions, not a scope or architecture change; same workflow file, same ref, same reason string"
  - "Rollback target recorded before dispatch (D-16 pattern applied here): prior ACTIVE production deployment id 14b8afd4-a673-4b64-a922-ca3f22adfea2, captured from the Railway dashboard before the new deploy replaced it"

requirements-completed: [DB-02]

# Metrics
duration: ~4min (RUNBOOK record + SUMMARY; the owner approval, workflow dispatch, /health verification, and Railway log confirmation were completed and verified by the orchestrator immediately prior to this closeout)
completed: 2026-10-02
---

# Phase 83 Plan 09: Ship to Production and Verify Summary

**Phase 83 Postgres infrastructure (DB-02) is now live in production via the blessed gated-deploy path — its own database, migrations on deploy, `/health` reporting `database:true`, and the Sheet mirror confirmed ENABLED-but-inert (all store modes still `sheets`) — closing out the phase in both environments.**

## Performance

- **Duration:** ~4 min for this closeout session (RUNBOOK record + SUMMARY). The full Task 1-3 cycle (owner approval, gated dispatch, production verification, Railway log confirmation) was completed and verified by the orchestrator before this session started; all facts below were given as already-verified.
- **Tasks:** 3/3 complete (Task 1 checkpoint:human-verify, Task 2 auto, Task 3 checkpoint:human-verify)
- **Files modified:** 1 (`docs/RUNBOOK.md`)

## Accomplishments

- **Task 1 — Owner approved production, rollback target recorded:** Owner replied "approved" in chat on 2026-10-02 after reviewing the 83-08 staging evidence. Rollback target recorded before dispatch: Railway deployment id `14b8afd4-a673-4b64-a922-ca3f22adfea2` (the ACTIVE `svmiddleware-production` deployment immediately prior to this cutover). Production `DATABASE_URL` confirmed still referencing the production Postgres (`${{Postgres-EMVk.DATABASE_URL}}`, set 2026-09-30 — Railway references cannot cross environments, so cross-wiring to staging was structurally impossible). Backups status re-confirmed unchanged: still NOT AVAILABLE (Hobby plan) — remains the Phase 84 blocker per D-16, not resolved by this plan.
- **Task 2 — Gated deploy dispatched and verified live:** `gh` CLI was unauthenticated in this session, so the gated workflow was dispatched via the GitHub Actions web UI rather than `gh workflow run` (deviation, see below) — **Gated Production Deploy #23**, run id `37049773828`, targeting staging `main` at `d47dab8`, reason "Phase 83 Postgres infrastructure (DB-02): lib/db.js, migrations on deploy, /health database field, store-flag + mirror gate; empty schema". Result: `test-middleware` success (including the new `test:db` Postgres integration suite), `test-frontend` success, `deploy` job success. New production Railway deployment id `f104c500-2ae4-4550-813e-3f3c79825ebc`. Production `/health` verified: `{"status":"ok","authenticated":true,"redis":true,"database":true}` with fresh uptime (~78 s at check time — no authenticated:false soft-warn to chase). `/api/products` returned 200. The gated-deploy workflow itself appended the new Deploy History row to `docs/RUNBOOK.md` (commit `3afac839`, `[skip ci]`); this plan added the accompanying narrative record.
- **Task 3 — Production logs confirmed (owner/orchestrator, read in Railway):** pre-deploy logs show `migration-guard: 1 file(s) additive-only OK` followed by `node-pg-migrate` applying `0001_init` with exit 0 — the blessed migrations-on-deploy path (D-03) worked identically in production to how it worked in staging in 83-08. Deploy logs show `[sheet-mirror] mirror ENABLED (environment=production)` with store modes `GIFT_CARDS_STORE: sheets`, `RECIPES_STORE: sheets` — exactly the expected D-07/phase-boundary state: the mirror gate is environment-aware and correctly flips to ENABLED in production, but nothing reads or writes Postgres for customer data yet because every store still resolves to `sheets`.
- **RUNBOOK updated:** Added a "Production cutover (2026-10-02)" record under `#### Postgres (Phase 83)` in `docs/RUNBOOK.md` — owner approval, rollback target, backups status, dispatch mechanism (web-UI deviation noted), workflow result, `/health` JSON, and the Task 3 log confirmations. Verified `grep -c "Production cutover (" docs/RUNBOOK.md` → `1`; `grep -nE "postgres(ql)?://|proxy\.rlwy\.net:[0-9]" docs/RUNBOOK.md` → no matches (no connection strings recorded, per the threat register's T-83-09-05 mitigation).

## Task Commits

1. **Task 1: Owner approves staging and records the production rollback target** — no commit (checkpoint:human-verify; values recorded in Task 2/this plan's RUNBOOK entry)
2. **Task 2: Dispatch the gated production deploy and verify /health** — `3afac839` (gated-deploy.yml's own automated Deploy History row, `chore`, `[skip ci]`) + `7abee5c0` (this plan's `docs` commit adding the Production cutover narrative record)
3. **Task 3: Owner confirms production Railway logs** — no commit (checkpoint:human-verify; confirmation recorded in this SUMMARY and in the RUNBOOK's Production cutover entry)

**Plan metadata:** this commit (final docs commit for 83-09, made by the orchestrator per the execute-plan workflow)

## Files Created/Modified

- `docs/RUNBOOK.md` — "Production cutover (2026-10-02)" record added under `#### Postgres (Phase 83)` (owner approval, rollback target, backups status, dispatch mechanism, workflow result, `/health` JSON, Task 3 log confirmations); Deploy History row was added separately by the gated-deploy workflow itself (`3afac839`, not part of this plan's own commit)

## Decisions Made

- **Web-UI dispatch instead of `gh workflow run`:** `gh` CLI was unauthenticated in this session. Rather than attempting to authenticate `gh` mid-plan (out of scope, and a credential action best left to the owner's own terminal per this repo's PII/secret handling conventions), the orchestrator dispatched the same workflow with the same ref and reason string via the GitHub Actions web UI. Functionally identical outcome (same workflow file, same checks, same artifact), documented as a deviation rather than silently treated as equivalent.
- **Rollback target captured before dispatch, not after:** Following the plan's Task 1 ordering (and the T-83-09-01/D-16 mitigation), the prior ACTIVE deployment id was read from Railway and recorded *before* the new deploy replaced it as ACTIVE — this is the only point at which that id is still retrievable without relying on deploy history ordering assumptions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `gh workflow run` replaced with GitHub web-UI dispatch**
- **Found during:** Task 2 (dispatching the gated production deploy)
- **Issue:** The plan's literal action specifies `gh workflow run gated-deploy.yml --ref main -f reason="..."` followed by `gh run watch <id> --exit-status`. The `gh` CLI was unauthenticated in this session, blocking that exact command.
- **Fix:** Dispatched the identical workflow (same file, same `--ref main`, same `reason` string) through the GitHub Actions web UI's "Run workflow" button instead, then polled the run and its job conclusions directly rather than via `gh run watch`.
- **Verification:** Run id `37049773828` (Gated Production Deploy #23) shows `test-middleware` success, `test-frontend` success, `deploy` success — the same three gates the `gh`-driven path would have asserted. Production `/health` and `/api/products` verified afterward exactly as the plan's `<verify>` block specifies.
- **Files modified:** none (dispatch mechanism only; no code or workflow file changed)
- **Committed in:** N/A (dispatch is not a commit-producing action; the resulting deploy's own RUNBOOK row is `3afac839`)

---

**Total deviations:** 1 auto-fixed (1 blocking — tooling substitution, not a scope or architecture change)
**Impact on plan:** No impact on outcome. The web-UI dispatch exercised the exact same gated workflow, inputs, and gates the plan specified; every acceptance criterion in Task 2 (gated deploy `success`, `test:db` run with passes, `/health` fields, `/api/products` 200, RUNBOOK rows, no connection strings) was still met.

## Issues Encountered

None beyond the `gh` authentication gap documented above as a deviation. No defects were found in the production logs reviewed for Task 3 (migration applied cleanly, mirror gate correctly ENABLED-but-inert) — so Task 3's "record as a defect if mirror shows DISABLED in production" contingency did not trigger.

## User Setup Required

None remaining from this plan. The one owner-gated action this plan required — approving the cutover and confirming the rollback target/backups status (Task 1), and confirming the production Railway logs (Task 3) — was completed by the owner/orchestrator before this closeout session began.

## Next Phase Readiness

- **Phase 83 (DB-02) is fully live in both staging and production**, each with its own Postgres database, migrations applying via `preDeployCommand` on every deploy, `/health` reporting the database field, and the Sheet-mirror gate correctly environment-aware (DISABLED on staging per 83-08, ENABLED-but-inert on production per this plan) — all four `must_haves.truths` in this plan's frontmatter are verified.
- **Phase 84 (first real Postgres-backed store) remains blocked on Railway Pro/backups** per `docs/RUNBOOK.md`'s D-16 note, carried forward unchanged from 83-08: this is an infra/billing decision, not a code gap, and this plan deliberately shipped only the empty schema (D-17) rather than resolving the backups gap.
- Carried-forward follow-ups from 83-08 (not re-litigated here, see `83-08-SUMMARY.md` for full detail): `test-e2e` CI job failing on staging `main` since >= 2026-09-23 (pre-existing, unrelated to Phase 83); `pg` client deprecation warning not yet traced to a call site; `runChecks` reports PASS even on 0-rows-accepted; no `history_id` format validation in the VesselHistory backfill spec; staging Postgres password rotation recommended (pasted into chat during 83-08 troubleshooting); Railway Config-as-Code deprecation deadline 2026-12-01 (`preDeployCommand` must move to IaC before then or migrations silently stop running on deploy — now applies equally to production, since production is live on the same `/railway.toml` mechanism); `scripts/`/`__tests__/` still outside the middleware's `npm run lint` coverage; local Node pin (`nvm use 20.20`) not yet made the `nvm` default or captured in `.nvmrc`; `api.steinsandvines.ca` custom domain configured but unverified.
- **New follow-up from this plan:** re-authenticate the `gh` CLI (`gh auth login`) before the next plan that needs scripted `workflow_dispatch` — the web-UI path worked but is not scriptable and adds a manual step to what should be a one-command dispatch.

## Self-Check: PASSED

- FOUND: docs/RUNBOOK.md contains exactly one "Production cutover (" entry
- FOUND: 3afac83930cfb86acd42cb56d91b1ea3144a1988 (gated-deploy's own Deploy History row commit, in `git log --oneline --all`)
- FOUND: 7abee5c0 (this plan's RUNBOOK docs commit, in `git log --oneline --all`)
- FOUND: no `postgres(ql)?://` or `proxy.rlwy.net:<port>` matches in docs/RUNBOOK.md
- FOUND: links.html left modified, uncommitted (not staged by this plan)
- FOUND: HANDOFF-infrastructure.md left untracked (not touched by this plan)
- FOUND: root `npm test` 141/141 suites, 2048/2048 tests green; root `npm run lint` clean (run before this plan's commit)
- FOUND: `zoho-middleware` `npm test` 129/129 suites, 1894/1894 tests green (run before this plan's commit)

---
*Phase: 83-postgres-infrastructure*
*Completed: 2026-10-02*
