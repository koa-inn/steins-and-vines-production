---
phase: 36-cross-surface-selection-recipe-modification
plan: "02"
subsystem: middleware/brewpad-integration
tags: [batch-creation, recipe-sale, payload-forwarding, tdd]
dependency_graph:
  requires: [35-06]
  provides: [SEL-02-middleware]
  affects: [zoho-middleware/lib/brewpad-integration.js, Apps Script create_batch handler]
tech_stack:
  added: []
  patterns: [fire-and-forget batch creation, null-fallback for optional snapshot fields]
key_files:
  created: []
  modified:
    - zoho-middleware/lib/brewpad-integration.js
    - zoho-middleware/__tests__/brewpad-integration.test.js
decisions:
  - "Null fallback chosen for missing target_volume_l/scale_factor (legacy/unscaled sales) rather than throwing — preserves backward compat with non-recipe kit sales"
  - "Fields read from server-built recipe_snapshot only (T-36-04 mitigated — never from client payload)"
metrics:
  duration: "8 min"
  completed_date: "2026-06-20"
  tasks_completed: 1
  tasks_total: 2
  files_changed: 2
---

# Phase 36 Plan 02: Forward target_volume_l + scale_factor onto Batch Payload Summary

**One-liner:** `detectRecipeSale` now carries `target_volume_l` and `scale_factor` from the server-built recipe snapshot onto the Apps Script `create_batch` payload, closing the SEL-02 carry-through gap at the middleware layer.

## What Was Built

Extended `detectRecipeSale` in `zoho-middleware/lib/brewpad-integration.js` to include two new fields on the `batchPayload` object sent to `callAppsScriptCreateBatch`:

- `target_volume_l`: copied from `recipeSnapshot.target_volume_l`, or `null` when absent (legacy/unscaled)
- `scale_factor`: copied from `recipeSnapshot.scale_factor`, or `null` when absent

The snapshot originates in `pos-recipe.js` confirm handler (lines 507-517) and is server-computed, never client-supplied — satisfying threat T-36-04 (tampering mitigation).

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| RED | Add 3 failing tests for detectRecipeSale payload forwarding | 1c77315 |
| GREEN | Implement target_volume_l + scale_factor on batchPayload | ca9031d |

## Tasks Blocked at Checkpoint

| Task | Type | Reason |
|------|------|--------|
| Apps Script redeploy | checkpoint:human-action | Apps Script changes are not in CI; manual redeploy required to persist the two new fields on the Batches sheet row |

## Test Results

- `npx jest brewpad-integration.test.js`: 36 passed (33 pre-existing + 3 new)
- `npm test` (full middleware suite): 880 passed, 0 failed

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. The middleware payload change is wired end-to-end to the Apps Script call site. The Apps Script persistence half is gated behind the human-action checkpoint.

## Threat Flags

None beyond the plan's threat model. `target_volume_l` is read from the server-built snapshot, not from any client-supplied field.

## Self-Check: PASSED

- [x] `zoho-middleware/lib/brewpad-integration.js` modified with `target_volume_l` on batchPayload (line 394)
- [x] `zoho-middleware/__tests__/brewpad-integration.test.js` extended with 3 new tests in `detectRecipeSale` describe block
- [x] Commit 1c77315 exists (RED)
- [x] Commit ca9031d exists (GREEN)
- [x] 880 middleware tests pass
