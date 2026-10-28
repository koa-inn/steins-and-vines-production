---
phase: 95-global-filters-and-chart-engine
plan: 09
subsystem: rollout
tags: [staging, backfill, staff-batch]
key-files:
  created:
    - .planning/phases/95-global-filters-and-chart-engine/95-ROLLOUT-LOG.md
    - zoho-middleware/__tests__/backfill/staff-batch-backfill-exclude.test.js
  modified:
    - zoho-middleware/scripts/backfill/staff-batch-backfill.js
    - zoho-middleware/scripts/backfill/README.md
    - docs/RUNBOOK.md
---

# 95-09 Summary: staging rollout and staff-flag backfill

Phase 95 is on staging (`020f6a9c`, then `c881e492`), with migration 0008 applied after 0007 and `/health` 200.
The staff-flag backfill flagged 20 staging batches: Koa Inn (11) and Paul McLachlan (9).

## What happened
- Code gate on Node 24: FE 3000, MW 3690, DB 443, both lints clean.
- The first dry run found 30 candidates. The owner rejected 10 batches belonging to paying customers (Anthony and
  Katie McLachlan, plus Wayne's SV-B-000238, which matched only on source `internal`).

## Deviations
- **[Rule 2 - missing capability] `--exclude=<ids>` added to staff-batch-backfill** (`c881e492`). The plan's fallback
  was to apply all 30 and untick 10 by hand, which would have had to be repeated on production. `--exclude` keeps
  the `--expect` gate exact, and an excluded id that is not a candidate is refused. Covered by 7 new tests in a new
  test file; no existing tests were modified.

## Follow-ups
- SV-B-000238 has source `internal` but belongs to a paying customer, so its source may need correcting (owner call).
- Production (95-11) must pass the same `--exclude` list, plus any new rows for those customers that show up in the prod dry run.

## Self-Check: PASSED
