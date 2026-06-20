---
phase: 35-batch-scaling-engine
plan: 01
subsystem: api
tags: [apps-script, recipes, middleware, scaling]

# Dependency graph
requires:
  - phase: 34-recipe-ingredient-grouping
    provides: recipe data model and GET /api/recipes endpoints
provides:
  - "Confirmed verdict: recipe.batch_size_l is present (numeric > 0) on the live get_recipe response"
  - "Confirmed recipes.js passes the Apps Script get_recipe payload through verbatim (no stripping/renaming of batch_size_l)"
affects: [35-02, 35-03, 35-04, batch-scaling-engine]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Live-middleware probe to de-risk an Apps Script field assumption before relying on it server-side"]

key-files:
  created:
    - .planning/phases/35-batch-scaling-engine/35-01-SUMMARY.md
  modified: []

key-decisions:
  - "CASE A confirmed — no Apps Script remediation/redeploy required; downstream plans may rely on recipe.batch_size_l server-side"

patterns-established:
  - "De-risk gate: verify an external (Apps Script) response shape against the live endpoint before building scaling math on top of it"

requirements-completed: [SCALE-01]

# Metrics
duration: 5min
completed: 2026-06-20
---

# Phase 35: Batch Scaling Engine — Plan 01 Summary

**Verified against the live PROD middleware that `recipe.batch_size_l` is present (value `60`) on the `GET /api/recipes/:id` response and passed through verbatim by `recipes.js` — CASE A, no Apps Script remediation required.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-06-20T14:45:00Z
- **Completed:** 2026-06-20T14:50:32Z
- **Tasks:** 2 (1 auto probe + 1 blocking human-verify checkpoint, approved)
- **Files modified:** 0 (read-only probe + this summary)

## Accomplishments
- Probed the live PROD Railway middleware (`svmiddleware-production.up.railway.app`) for the `batch_size_l` field on a real recipe.
- Confirmed `batch_size_l = 60` (numeric > 0) on recipe `SV-R-000001` ("Dangerous Bunny", the only active recipe).
- Traced `zoho-middleware/routes/recipes.js` `GET /api/recipes/:id` (≈lines 265–297): it extracts `detail.recipe || detail` and returns it without stripping or renaming fields — `batch_size_l` is preserved end-to-end from the Apps Script `get_recipe` payload.

## Probe Verdict

- **URL probed:** `https://svmiddleware-production.up.railway.app/api/recipes/SV-R-000001`
- **Recipe ID:** `SV-R-000001` — "Dangerous Bunny"
- **`batch_size_l`:** PRESENT, value `60` (numeric > 0)
- **CASE:** **A** — field present; no Apps Script edit or manual redeploy needed.

## Task Commits

1. **Task 1: Probe live get_recipe response for batch_size_l** — read-only probe, no code commit
2. **Task 2: Confirm batch_size_l availability (blocking human-verify)** — approved by human ("Approve — proceed")

**Plan metadata:** committed with this summary (docs: complete plan)

## Files Created/Modified
- `.planning/phases/35-batch-scaling-engine/35-01-SUMMARY.md` — this verdict record

## Decisions Made
- CASE A applies — `batch_size_l` is reliably available server-side, so 35-02/03/04 may compute `scale_factor = target_volume_l / recipe.batch_size_l` without an Apps Script change.

## Deviations from Plan
None — plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None — no external service configuration required (CASE A required no Apps Script redeploy).

## Next Phase Readiness
- Plan 35-02 (pure `recipe-scaling.js` helper + unit tests) can proceed.
- Caveat recorded: the field was confirmed on the single active recipe; it is sourced via passthrough from the Apps Script sheet, so any recipe lacking a base batch size in the editor would return a missing/zero `batch_size_l`. Downstream server code (35-03) should defensively validate `recipe.batch_size_l > 0` before dividing (this is already in the 35-03 scope as `target_volume_l`/`scale_factor` validation).

---
*Phase: 35-batch-scaling-engine*
*Completed: 2026-06-20*
