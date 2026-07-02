---
phase: 45-security-and-money-path-hardening-audit-critical-and-high
plan: 02
subsystem: deploy-prod-middleware
tags: [security, deploy, railway, prod, pii, containment, owner-gated]
dependency_graph:
  requires: [45-01]
  provides: [wave1-containment-live-on-prod]
  affects: [prod Railway sv_middleware]
tech_stack:
  added: []
  patterns: [pinned-commit deploy (railway up from detached HEAD), upstream-source-only middleware deploy (no staging)]
key_files:
  created: []
  modified: []
decisions:
  - "Pinned the prod deploy to commit 322c963 (45-01 + #2 e8b81ce + #10 7c68f05, money-path ABSENT) rather than HEAD — honours the deploy-ordering blocker so un-UAT'd money-path waves (45-05/06/07/08 + FIX1/FIX2) do NOT reach prod before the 45-09 live-card UAT"
  - "Deployed via `railway up --ci` from a detached HEAD at 322c963 (working-dir upload), then returned to main + restored stashed build churn — no commit/branch mutation"
  - "D-17 confirmed live: middleware has NO staging environment; railway status = Environment: production. The deploy and all verification curls hit live prod"
metrics:
  duration: "~15 minutes"
  completed: "2026-06-30"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 0
  tests_added: 0
---

# Phase 45 Plan 02: Deploy Wave-1 Containments to Prod Summary

The already-committed key guard (#2, e8b81ce), PII-log redaction (#10, 7c68f05), and the 45-01 code (PII GET guards, KIOSK_PIN length guard, rdb gitignore) are now **live on prod Railway** and verified. Deploy was pinned to the containment-only commit so no money-path code reached prod ahead of the 45-09 live-card UAT.

## Deploy Reference (for the runbook)

| Field | Value |
|-------|-------|
| Tree deployed | `322c963` — "docs(45-01): complete Wave-1 security containments plan" |
| Method | `railway up --ci` (working-dir upload from detached HEAD at 322c963) |
| Project / Env / Service | `sv-middleware` / **production** / `sv_middleware` |
| Image digest | `sha256:a0a0d7c88f7cd151b85f9e6deea97ba7179168e764fcdd52bef8b77d949032b7` |
| Config digest | `sha256:688935724a1cf800ba17df5155b7892e6dfa36eb926b92cb6f1070c71ac6a3bc` |
| Built (UTC) | 2026-06-30T19:52:12Z |
| Result | `Deploy complete` |
| Tests at pinned commit | 47 suites / 1042 pass |

## Tasks Completed

| Task | Name | Gate | Status |
|------|------|------|--------|
| 1 | Deploy Wave-1 containments to prod Railway | checkpoint:human-action | DONE — image pushed, deploy complete |
| 2 | Verify prod containment | checkpoint:human-verify | 4/5 automated checks PASS; 1 manual (iPad PIN) pending owner |

## Verification (live prod — svmiddleware-production.up.railway.app)

| # | Check | Expected | Actual |
|---|-------|----------|--------|
| 1 | keyless `GET /api/kiosk/salesorders` | 401 | **401** ✅ |
| 2 | keyed `GET /api/kiosk/salesorders` | 200 | **200** ✅ |
| 3a | keyless `GET /api/kiosk/salesorder/:id` | 401 | **401** ✅ |
| 3b | keyed `GET /api/kiosk/salesorder/<real-id>` | 200 | **200** ✅ |
| 5 | PII log redaction (#10) | emails masked | no raw emails in log window (consistent; positively covered by `lib/redact.js` unit tests — not triggered on prod to avoid a real transaction) |
| 4 | iPad kiosk PIN login still works | login succeeds | **PENDING owner manual check** |

Note on 3b: an initial probe with a deliberately-invalid id (`TEST_ID`) returned `502 {"error":"Failed to fetch sales order"}` — this is the handler's pre-existing upstream-error mapping for an unknown id (the auth guard had already passed), NOT a deploy regression. Re-tested with a real salesorder id from the working list → 200, and keyless on the same real id → 401.

## Residual Risk (carried to Phase 46)

T-45-02-AUTH (accepted, documented): the static admin key in git history (`API_SECRET_KEY` published in `js/sheets-config.js`) **remains valid** after this deploy. This wave guards the PII reads and redacts PII logs but does **NOT** rotate the key — rotation is D-04 at the Phase 46 auth cutover. Residual key-validity window is explicit and owner-accepted; interim network containment (D-05) may front-run it if cutover is delayed.

## Deviations from Plan

**1. Pinned deploy to 322c963 instead of "HEAD at plan-authoring time"**
- **Found during:** resume (machine crash mid-session); the plan was authored when HEAD == 45-01, but by resume time all money-path waves (45-05/06/07/08) + FIX1/FIX2 were already committed at HEAD.
- **Fix:** stashed working-tree build churn, checked out 322c963 (detached), confirmed money-path/`reconcile.js`/`money-path.js` absent + `apiKey.js`/`redact.js` present, ran tests (1042 green), `railway up`, then returned to main + popped stash. The deployed prod image is a clean containment of the intended state.
- **Files modified:** none (deploy-only plan).

## Known Stubs

None — deploy/verify plan, no code.

## Self-Check: PASSED

- SUMMARY.md: FOUND
- Prod deploy: COMPLETE (image sha256:a0a0d7c8…, tree 322c963)
- Automated containment checks: 4/4 PASS
- Outstanding: Task 2 check 4 (iPad PIN login) — owner manual confirmation
