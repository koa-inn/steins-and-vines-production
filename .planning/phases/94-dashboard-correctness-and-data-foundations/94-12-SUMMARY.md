---
phase: 94-dashboard-correctness-and-data-foundations
plan: 12
subsystem: rollout (production B2 + acceptance)
tags: [production, backfill, completed-at, acceptance]
key-files:
  created: []
  modified:
    - .planning/phases/94-dashboard-correctness-and-data-foundations/94-ROLLOUT-LOG.md
    - .planning/phases/87-batches-batchtasks-platoreadings-vesselhistory-postgres/87-CUTOVER-LOG.md
completed: 2026-10-27
---

# 94-12 Summary: production B2 completion dates and final acceptance

- **Dry run:** 40 to fill, identical to the staging-approved list.
- **Apply:** owner OK, then `--apply --expect=40` wrote 40 and skipped 0.
- **Replay and verify:** the replay sent 40/40 (driver, 0 retries) and verify found 0 mismatches. Logged in 87 SQL fixes.
- **Recompute:** n 175, median 57d, mean 59d, null_batch_type 0, needs_a_type 0.
- **D-13 PASS on production:** the tile shows 57d / 59d / 175 with per-type Wine 57, Beer 38, Cider 71, and the Needs-a-type chip shows (0). Before the backfills it read 61 / 61 / 135 with 40 excluded.
- **Owner sign-off:** "signed off".

## Deviations
- Production BrewPad showed the staff sign-in screen after a page reload in the automated Chrome tab, and the owner signed in again. Flagged for a check on the iPad.

## Self-Check: PASSED
