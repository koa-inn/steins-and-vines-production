---
phase: 94-dashboard-correctness-and-data-foundations
plan: 10
subsystem: rollout (staging UAT + production pre-deploy)
tags: [uat, release-gate]
key-files:
  created: []
  modified:
    - .planning/phases/94-dashboard-correctness-and-data-foundations/94-ROLLOUT-LOG.md
completed: 2026-10-27
---

# 94-10 Summary: staging UAT and the production pre-deploy gate

- **Staging UAT:** owner approved ("gotcha, cool then approved").
- **Production pre-deploy (read-only):**
  - migrations: 0006 present, 0007 absent;
  - `BATCHES_STORE=postgres` and `OPS_DATA_STORE=postgres`, no freeze;
  - rollback target: Railway `90dfb9c1`;
  - candidate `141901a7`: 39 commits after `production/main`, 35 of them Phase 94 and 4 docs or bookkeeping;
  - non-94 files: the CNAME and the `pos.js` allowlist entry from 94-05.
- **Owner release approval:** `141901a7` ("release 141901a7 now").

## Deviations
None.

## Self-Check: PASSED
