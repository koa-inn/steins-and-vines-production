---
phase: 94-dashboard-correctness-and-data-foundations
plan: 11
subsystem: rollout (production release + B3)
tags: [production, release, backfill, batch-type]
key-files:
  created: []
  modified:
    - .planning/phases/94-dashboard-correctness-and-data-foundations/94-ROLLOUT-LOG.md
    - .planning/phases/87-batches-batchtasks-platoreadings-vesselhistory-postgres/87-CUTOVER-LOG.md
completed: 2026-10-27
---

# 94-11 Summary: production release and the B3 type backfill

- **Release:** `git push production 141901a7:main --force` at 22:10:37Z, tagged `prod-20261027-1`. Railway `896f6942` came up healthy. 0007 applied after 0006, all stores are postgres, `/health` 200, and the production BrewPad dashboard renders.
- **Dry run:** 215 candidates and 0 needing a type. Two beer batches (SV-B-000167 and 229) were decided by `name` instead of `recipe`, because the production recipe `beer_category` is NULL (a Phase 89 gap, flagged).
- **Apply:** owner OK, then `--apply --expect=215` wrote 215 and skipped 0.
- **Replay to the sheet:** the stock CLI stopped twice on Apps Script 30 s timeouts. The calls take about 14 s per batch, and all 215 rows share one `last_updated`. A one-off driver reusing `runBatchesReplay` (same payloads and order; it skipped the 35 ids already sent and allowed 120 s with 3 tries) finished 215/215 with 0 retries.
- **Verify:** 0 mismatches. Logged in 87 SQL fixes.

## Deviations
- **One-off replay driver:** used in the container (removed afterwards) because the stock replay CLI can't resume or retry. Follow-up: give `batches-replay-to-sheet.js` retry and a longer timeout, or a `--after-id` resume, before the rollback week needs it.
- **Production repo audit failure:** the `Tests` audit step failed on a new body-parser advisory, which has nothing to do with Phase 94. It is patched in `13805fe9` (staging), and CI's audit now passes.

## Self-Check: PASSED
