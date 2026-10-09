---
phase: 87-batches-batchtasks-platoreadings-vesselhistory-postgres
plan: 18
subsystem: ops
tags: [staging, rehearsal, cutover, rollback, uat]
requires: [87-17]
provides: [staging rehearsal record, measured window timings, parity sku fix]
affects: [87-19, 87-20]
key-files:
  created:
    - zoho-middleware/__tests__/batch-rules-sku-type.test.js
  modified:
    - zoho-middleware/lib/batch-rules.js
    - docs/RUNBOOK.md
    - .planning/phases/87-batches-batchtasks-platoreadings-vesselhistory-postgres/87-CUTOVER-LOG.md
duration: ~2h45m (incl. ~1h Railway build outage)
completed: 2026-10-09
---

# Phase 87 Plan 18: Staging Rehearsal Summary

The whole Sunday-window procedure ran end to end on staging. That covered freeze, backfill, verify,
parity, flip and post-flip parity, then hands-on UAT and a rehearsed rollback. Steps 3-8 took about 30
minutes. The first parity run caught a real wire-format bug (numeric `product_sku`), which was fixed.
Staging is back on sheets by owner choice.

## Tasks

| Task | Result | Commits |
|------|--------|---------|
| 1 Staging push + Apps Script v62 | Staging `5aa2d2e7` (0005 applied); v62 live, rollback v61; post-paste hash matched; production probes ok | ba7e8765 |
| 2 Timed rehearsal | Run 1 no-go at parity (175 sku diffs), fixed `5935a5b1`; run 2: 0 rejects, 0 mismatches, 0 parity differences pre- and post-flip | 31eefdcf, aa8ff71d, b9da9d10 |
| 3 UAT + rollback | 5 of 6 checks pass. Scan invoices was skipped because Zoho is shared with production. Rollback: replay dry run, flag back to sheets in ~3 min | aab8c015 |

Q1 (orphan rows deleted) and Q3 (timezone America/Vancouver, with a Node tzdata caveat) were closed
during Task 1 (a6e6b98d, 49b0a400).

## Deviations

- **[Rule 1 - Bug] Numeric product_sku typing.** Sheets stores all-digit SKUs as numbers, so Apps
  Script emits JSON numbers, while `serializeBatch` emitted strings. The fix follows the bin_id rule and
  keeps leading-zero SKUs as text. The regression test was written first; all suites were green.
- **Scan-invoices check skipped on staging.** Staging and production share one Zoho org, so the check
  would write `cf_batch_status` on real invoices. It runs in the production window instead.
- **D-12 notices not applied on staging.** The workbook is shared with production.
- **Railway build outage.** Docker Hub 429s failed three builds (13:51-14:43). The rehearsal paused and
  resumed after a successful build at 14:54.

## Issues found for later

- BrewPad shows a generic "Save failed" during the freeze, not the maintenance text. `brewpad.js` is
  locked, so warn staff before the window (RUNBOOK).
- The Railway CLI's variable delete does not redeploy, and a FAILED newest build blocks CLI
  restart/redeploy (RUNBOOK notes).
- Node 20.20.2 tzdata 2025c treats America/Vancouver as UTC-8 from 2026-11-01. Fix before Nov 1 and
  before the production window (todo `node-tzdata-bc-permanent-time`).
- Railway config-as-code (`railway.toml`, which runs the migration guards) stops applying on
  2026-12-01.

## Self-Check: PASSED

- 87-CUTOVER-LOG.md "Staging rehearsal" holds rejects 0, the four table counts, verify 0 mismatches,
  parity 0 differences, per-step minutes, a line for each of the six checks and a create_batch sample
  (54 ms).
- RUNBOOK Phase 87 timeline has measured values and a total.
- `git diff --exit-code 3010e237 -- js/brewpad.js js/brewpad.min.js js/admin.js js/batch.js` is clean.
