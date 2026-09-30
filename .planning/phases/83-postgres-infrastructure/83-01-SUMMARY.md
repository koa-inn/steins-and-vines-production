---
phase: 83-postgres-infrastructure
plan: 01
subsystem: infra
tags: [railway, postgres, provisioning, runbook, backups, node-pg-migrate]

# Dependency graph
requires:
  - phase: 82-store-agnostic-prerequisites
    provides: "Railway Hobby-plan confirmation (82-01-SUMMARY.md)"
provides:
  - "Two Railway Postgres databases (staging + production), each with a linked DATABASE_URL in its own middleware service"
  - "Recorded RAILWAY_ENVIRONMENT_NAME values (staging / production) for the D-07 sheet-mirror gate"
  - "Recorded Railway config-file path (/railway.toml, repo root) for the D-03 preDeployCommand"
  - "Recorded backups/PITR status (unavailable on Hobby) as a Phase 84 (D-16) blocker"
  - "Recorded workbook timezone (America/Vancouver) for the backfill"
affects: [83-postgres-infrastructure, 84-balance-backfill]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Railway dashboard facts recorded as owner-verified text in docs/RUNBOOK.md rather than inferred, per D-15/D-07"]

key-files:
  created: []
  modified:
    - docs/RUNBOOK.md

key-decisions:
  - "Production Postgres service is named Postgres-EMVk (Railway auto-suffix), not Postgres, because service names are project-unique and staging already used Postgres; the production reference is ${{Postgres-EMVk.DATABASE_URL}}"
  - "Both middleware services are actually named sv_middleware in Railway; svmiddleware-staging/-production are only the *.up.railway.app domains"
  - "preDeployCommand stays in repo-root /railway.toml per Plan 83-03 as written; no file move needed"
  - "Railway config-as-code is deprecated (dashboard notice) and existing config files stop applying 2026-12-01 - flagged for Plan 83-03/83-08 to migrate settings before that date"
  - "Backfill default timezone confirmed as America/Vancouver, matching Plan 83-06's default"
  - "Neither Postgres service exposes DATABASE_PUBLIC_URL (no TCP proxy) - Plan 83-08 must choose a temporarily-enabled proxy or railway run/SSH for the backfill rehearsal"

patterns-established: []

requirements-completed: [DB-02]

# Metrics
duration: ~7min (Task 3 continuation; Task 1 was a separate prior session)
completed: 2026-09-30
---

# Phase 83 Plan 01: Railway Postgres Provisioning Summary

**Both staging and production Railway Postgres databases provisioned and linked, with environment names, config path, and backup status (none on Hobby) recorded in docs/RUNBOOK.md for downstream Plans 83-03/83-04/83-06/83-08 and a Phase 84 backup blocker.**

## Performance

- **Duration:** Task 1 (prior session): committed 2026-09-30T12:15:47-07:00. Task 2 (owner dashboard work): 2026-09-30, ~13:16 PDT. Task 3 (this continuation): started after owner report, committed 2026-09-30T13:22:08-07:00.
- **Tasks:** 3/3 complete (Task 1 auto, Task 2 checkpoint:human-action, Task 3 auto)
- **Files modified:** 1 (docs/RUNBOOK.md)

## Accomplishments
- Railway Postgres provisioned in both the staging and production environments, each with its `DATABASE_URL` linked into its own middleware service as a private-URL reference (never the public URL)
- Owner-verified `RAILWAY_ENVIRONMENT_NAME` values recorded and confirmed distinct (`staging` / `production`) — unblocks the D-07 sheet-mirror hard-off-on-staging gate for Plan 83-04
- Config-file location confirmed as the shared repo-root `/railway.toml` (no Root Directory override on either service) — Plan 83-03's `preDeployCommand` can be added there as written
- Backups/PITR confirmed unavailable on the Hobby workspace plan for both databases — written up as an explicit Phase 84 (D-16) blocker so real balances are never loaded before backups exist
- Workbook timezone confirmed as `America/Vancouver`, matching Plan 83-06's default
- Captured two facts the original checklist didn't anticipate: Railway auto-suffixed the production Postgres service name to `Postgres-EMVk`, and neither database exposes `DATABASE_PUBLIC_URL` — both flagged for the plans that need them (83-04's reference variable expectations; 83-08's backfill rehearsal connectivity)

## Task Commits

1. **Task 1: Write the Railway Postgres provisioning checklist into RUNBOOK** - `c0ba212e` (docs) — prior session
2. **Task 2: Owner provisions both Railway Postgres databases** - (dashboard action, no commit; owner performed the work in their own logged-in Railway session on 2026-09-30, reporting facts only, no secrets)
3. **Task 3: Record the owner's answers and flag any blocker** - `0e03952e` (docs)

**Plan metadata:** (this commit, below)

## Files Created/Modified
- `docs/RUNBOOK.md` - Filled the 12-row provisioning record, added a note on actual Railway service names diverging from the Task 1 checklist, a "Consequences for Phase 83 code" callout (env names, config path + deprecation deadline, timezone), and a "Blocker for Phase 84 (D-16)" callout for backups/PITR

## Decisions Made
- Recorded production's Postgres reference as `${{Postgres-EMVk.DATABASE_URL}}` rather than `${{Postgres.DATABASE_URL}}`, since Railway auto-suffixed the name; documented this divergence inline rather than rewriting the Task 1 checklist prose
- Did not enable a TCP proxy to create `DATABASE_PUBLIC_URL` (not requested, would widen the attack surface) — deferred the connectivity decision for Plan 83-08's backfill rehearsal to that plan, as instructed
- Flagged the Railway "Config as Code deprecated, existing files work until 2026-12-01" dashboard notice as a new fact for Plan 83-03/83-08, since it affects when the `preDeployCommand` must move to dashboard settings or IaC

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Verify tooling false positive] Task 3's automated verify grep pattern flags pre-existing Task 1 text**
- **Found during:** Task 3 verification
- **Issue:** The plan's `<automated>` verify command for Task 3 greps the entire `docs/RUNBOOK.md` for `railway\.internal`, intending to catch accidentally-recorded credentials. Task 1 (already committed as `c0ba212e`, already passed its own acceptance criteria which only checked `postgres(ql)?://`) legitimately contains the illustrative phrase "host `*.railway.internal`" in its Pitfall prose, warning the owner to use the private URL. This is documentation text, not a recorded credential, but it makes Task 3's broader grep pattern always fail.
- **Fix:** Confirmed via `git diff docs/RUNBOOK.md | grep -E '^\+'` that zero lines added by Task 3 match `postgres(ql)?://`, `railway\.internal`, or `proxy\.rlwy\.net:[0-9]` — the only match in the full-file grep is the pre-existing line 312 from Task 1. Did not modify Task 1's already-accepted content (out of scope, different task, its own verify criteria already satisfied). Documented here instead.
- **Files modified:** None (verification-only finding)
- **Verification:** `git diff docs/RUNBOOK.md | grep -E '^\+' | grep -iE "postgres(ql)?://|railway\.internal|proxy\.rlwy\.net:[0-9]"` returns no matches (exit 1); the `_pending_` count and `Consequences for Phase 83 code` checks in the same verify command both pass as written
- **Committed in:** N/A (no code/doc change required; this is a note about the plan's own verify script)

---

**Total deviations:** 1 (verify-tooling false positive, no content change required)
**Impact on plan:** None on the deliverable — the table and callouts contain no secrets. The plan's Task 3 verify script itself has an overly broad grep scope; future plans touching this file should scope that pattern to the provisioning-record table rather than the whole document.

## Issues Encountered
None beyond the verify false-positive documented above.

## User Setup Required
None remaining for this plan — Task 2's Railway dashboard provisioning is complete (owner-performed, 2026-09-30). Phase 84 has a new prerequisite: enable backups/upgrade to Pro before loading real balances (see Blocker callout in docs/RUNBOOK.md).

## Next Phase Readiness
- Plan 83-03 (railway.toml preDeployCommand) can proceed: config file confirmed at repo-root `/railway.toml` for both services, but must also account for the Railway config-as-code deprecation deadline (2026-12-01) noted in the RUNBOOK callout
- Plan 83-04 (lib/sheet-mirror.js PRODUCTION_ENVIRONMENT_NAME) can proceed: `production` recorded and confirmed distinct from staging's `staging`
- Plan 83-06 (backfill default timezone) can proceed unchanged: `America/Vancouver` matches its existing default
- Plan 83-08 has two new open decisions to make before the backfill rehearsal: (a) migrate railway.toml settings to dashboard/IaC before 2026-12-01, (b) choose TCP-proxy-vs-railway-run for laptop connectivity since no `DATABASE_PUBLIC_URL` exists
- Phase 84 is blocked from loading real balances until backups/PITR exist on the Railway workspace (currently Hobby plan, no backups) — does not block Phase 83 itself (D-17, empty database)

---
*Phase: 83-postgres-infrastructure*
*Completed: 2026-09-30*

## Self-Check: PASSED

- FOUND: docs/RUNBOOK.md
- FOUND: .planning/phases/83-postgres-infrastructure/83-01-SUMMARY.md
- FOUND: c0ba212e (git log --oneline --all)
- FOUND: 0e03952e (git log --oneline --all)
