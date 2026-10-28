---
phase: 95-global-filters-and-chart-engine
plan: 11
subsystem: rollout
tags: [production, backfill, staff-batch]
key-files:
  modified:
    - .planning/phases/95-global-filters-and-chart-engine/95-ROLLOUT-LOG.md
    - .planning/phases/87-batches-batchtasks-platoreadings-vesselhistory-postgres/87-CUTOVER-LOG.md
    - docs/RUNBOOK.md
---

# 95-11 Summary: production release and staff backfill

Phase 95 is live on production as `33d10f48` (tag `prod-20261028-2`, Railway `a3cce010`), with migration 0008 applied.
20 production batches are flagged staff (Koa Inn 11, Paul McLachlan 9), and batches-verify shows 0 mismatches.

## What happened
- `git push production 33d10f48:main --force`. Production CI unit suites passed; the e2e job doesn't gate (known red).
- `/health` 200, and 0008 is applied after 0007.
- The prod dry run gave the same 30 ids as staging. With the owner's 10 exclusions it was 20, fingerprint `79e38cb5f22c`.
- The apply wrote 20 and skipped 0; a re-run lists 0. Verify against the owner snapshot: 0 mismatches. No replay.
- RUNBOOK deploy-history row and the 87-CUTOVER-LOG SQL-fixes entry are added.

## Notes
- v2 stays opt-in per device ("Try new dashboard"), so shop devices see no change until they opt in.
- SV-B-000238 has source `internal` but belongs to a paying customer, so its source may need correcting (owner call).

## Self-Check: PASSED
