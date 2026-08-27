---
phase: 76-brewpad-session-expiry-hardening
plan: 01
subsystem: api
tags: [apps-script, server_token, brewpad, batch-tracking, middleware-proxy]

# Dependency graph
requires:
  - phase: 64-03
    provides: "server_token doPost branch precedent (create_recipe/update_recipe entries) + the redeploy-is-a-manual-owner-step precedent"
provides:
  - "Deployed Apps Script exposes BrewPad's 10 added write actions (update_batch, update_batch_schedule, delete_batch, bulk_add_plato_readings, bulk_update_batch_tasks, update_plato_reading, delete_plato_reading, create_ferm_schedule, update_ferm_schedule, delete_ferm_schedule) under server_token"
  - "Live-confirmed RESEARCH.md Assumption A2: reads (get_batches) already work under server_token with no .gs change"
affects: [76-02, brewpad-middleware-proxy, brewpad-session-expiry-hardening]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "server_token write actions in doPost use fixed actor 'middleware' (never client-supplied identity); delete_* actions match their payload-only signatures; batch-mutating actions call _invalidateBatchCache(payload.batch_id)"

key-files:
  created: []
  modified:
    - "apps-script/adminApi.gs"

key-decisions:
  - "Kept the server_token allowlist a hardcoded closed if-chain (no free-form action passthrough) — the allowlist IS the security boundary"
  - "New write entries pass fixed actor 'middleware' since Apps Script's server_token branch never runs checkAuthorization (authResult.email unavailable)"

patterns-established:
  - "BrewPad server_token write pattern: mirror the OAuth-switch handler name/arity, substitute actor 'middleware', invalidate batch cache for batch-mutating actions, return via _jsonResponse"

requirements-completed: [STAFF-AUTH]

# Metrics
duration: ~15min (spanning owner redeploy checkpoint)
completed: 2026-08-27
---

# Phase 76 Plan 01: BrewPad Write-Path Allowlist Extension Summary

**Extended `adminApi.gs`'s `doPost` server_token allowlist with BrewPad's 10 batch/task/reading/schedule write actions, redeployed and live-verified so the Railway middleware can invoke them server-side.**

## Performance

- **Duration:** ~15 min active work (plus owner redeploy checkpoint wait)
- **Tasks:** 2 (1 auto edit + 1 blocking-human verification checkpoint)
- **Files modified:** 1
- **Completed:** 2026-08-27

## Accomplishments
- Added 10 BrewPad write actions to `doPost`'s closed `server_token` if-chain (`create_batch` was already present; `update_batch_schedule` was the genuinely-new 10th action, previously only in the OAuth switch)
- Owner redeployed the Apps Script as a new active version and all three live probes passed against the deployed `APPS_SCRIPT_URL`
- Confirmed RESEARCH.md Assumption A2 live: reads already work under server_token with no `.gs` change — Plan 76-02's read proxy is safe to build
- Fixed the latent bug behind `stampBottlingInviteSent` (pos.js:3697) silently hitting `invalid_action` under server_token for BrewPad writes

## Task Commits

1. **Task 1: Add BrewPad's 10 write actions to doPost's server_token allowlist** - `9a6dc31b` (feat)
2. **Task 2: Owner redeploys Apps Script and live-verifies** - checkpoint (blocking-human); no code commit — manual owner redeploy + live probes

## Files Created/Modified
- `apps-script/adminApi.gs` - Added 10 `if (action === '<name>') { ... }` entries inside the `if (payload.server_token)` block, above the `invalid_action` catch-all. Purely additive (45 insertions, 0 deletions).

## Automated Acceptance-Criteria Results (Task 1)

| Criterion | Result |
|---|---|
| `grep -c` of the 10 `action === '<name>'` strings returns 10 | PASS (returned 10) |
| New entries appear textually BEFORE the `invalid_action` catch-all | PASS (entries lines 321–364, catch-all line 365) |
| `deletePlatoReading(payload)` / `deleteFermSchedule(payload)` called with no `'middleware'` actor arg | PASS (both payload-only, no trailing actor) |
| `_invalidateBatchCache(payload.batch_id)` count increased by 7 | PASS (7 new lines added; total 12 → 19) |
| `doGet` unchanged | PASS (no doGet hunks; only insertions inside doPost server_token branch) |

## Live Probe Results (Task 2 — owner-run against deployed APPS_SCRIPT_URL)

Redeployed active version observed via write probe response: `newVersion` timestamp **2026-08-27T14:20:27.730Z**.

- **READ probe** — `get_batches` (server_token only, no Google token) → `{"ok":true, ...batches...}` — Assumption A2 confirmed live on the deployed instance.
- **WRITE probe** — `update_batch` (no-op `updates:{}` on real batch **SV-B-000203**) → `{"ok":true,"message":"Batch updated","newVersion":"2026-08-27T14:20:27.730Z"}` — action recognized, NOT `invalid_action`.
- **WRITE probe** — `update_batch_schedule` (no-op) → `{"ok":false,"error":"missing_fields","message":"batch_id and schedule_snapshot are required"}` — genuinely-new 10th action is live and recognized, NOT `invalid_action` (the `missing_fields` error confirms the handler was reached and validated input).

All Task 2 acceptance criteria met: owner confirmed the new version is the active deployment; both `update_batch` and `update_batch_schedule` return something other than `invalid_action`; `get_batches` returns `ok:true` with batch data.

## Decisions Made
- Kept the server_token allowlist a hardcoded closed if-chain (no free-form `action` passthrough) — this is the trust boundary between the Railway middleware and the internet (threat T-76-01-01).
- New write entries pass the fixed actor string `'middleware'` (never a client-supplied identity), matching the existing `create_recipe`/`update_recipe` entries, since the server_token branch never runs `checkAuthorization` (threat T-76-01-02).
- The two delete actions (`delete_plato_reading`, `delete_ferm_schedule`) take `payload` only, matching their real handler signatures — did not invent an actor param.

## Deviations from Plan

None - plan executed exactly as written.

Note: `apps-script/*.gs` files are not covered by the project's Jest/ESLint tooling (that applies to the frontend and `zoho-middleware/` only), so CLAUDE.md's `npm test` / `npm run lint` pre-commit gates are not applicable to this file. Verification for Apps Script changes is against the live deployed system, per STATE.md's "green tests ≠ working system" anti-pattern — exactly what the Task 2 checkpoint provided.

## Issues Encountered
None. The edit and live verification both proceeded as planned.

## User Setup Required
The Apps Script redeploy was the manual owner step (Deploy → Manage deployments → New version), completed as part of Task 2's blocking-human checkpoint. No further external configuration required.

## Next Phase Readiness
- The deployed Apps Script now exposes BrewPad's 10 added write actions under server_token, and reads under server_token are live-confirmed.
- **Plan 76-02 is unblocked** to build the middleware proxy against a verified write path.

## Self-Check: PASSED

- `apps-script/adminApi.gs` modified and committed in `9a6dc31b` (verified present in git log).
- `76-01-SUMMARY.md` created (verified present on disk).

---
*Phase: 76-brewpad-session-expiry-hardening*
*Completed: 2026-08-27*
