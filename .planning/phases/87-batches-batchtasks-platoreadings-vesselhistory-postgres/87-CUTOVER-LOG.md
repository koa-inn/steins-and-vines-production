# Phase 87 - Batches Cutover Log

Owner/Claude-maintained record of the staging rehearsal, the production window and the rollback week.
Procedure: `docs/RUNBOOK.md` section "Batches -> Postgres (Phase 87)". No secrets, customer names, emails,
tokens or notes: ids, field names, counts and classifications only.

## Staging rehearsal

Staging candidate SHA: `5aa2d2e7` (pushed 2026-10-09; guard chain applied `0005_batches`; `/health` ok;
`BATCHES_STORE` and `BATCHES_FREEZE` unset, so sheets mode). Production pin at push time: production
`main` = `ef3be1e3`, which contains no Phase 87 commits (Q10). Apps Script v62 deployed on: 2026-10-09
(rollback v61).

Apps Script v62 probes (production credentials, read-only, 2026-10-09): `get_batches` ok:true;
`export_batch_tabs` ok:true with Batches 204, BatchTasks 1068, PlatoReadings 70, VesselHistory 427. Orphan
child rows at that time: BatchTasks BT-000567, BT-000568, BT-000569, BT-000570 (all -> SV-B-000108);
PlatoReadings none; VesselHistory none.

Rehearsal run 1 (2026-10-09, started 13:36 PDT; Claude ran the scripts, owner did browser checks
until Claude piloted Chrome):

- 13:36 `BATCHES_FREEZE=15:00` set; redeploy live 13:40 (about 3.5 min). Freeze checks: BrewPad task tick
  refused (503) but BrewPad shows a generic "Save failed - try again" toast, not the maintenance text
  (brewpad.js is locked, so staff must be told about the window in advance); admin task complete refused
  with the maintenance message; public batch POST refused 503. Reads loaded normally.
- 13:46 snapshot 1. Tails check: no blank-id rows holding data in any of the four tabs.
- 13:47:30 dry run: 0 rejects; 204 / 1064 / 70 / 427; seeds 235 / 1079 / 72 / 429.
- 13:47:52 promote into staging Postgres (service `Postgres`, via SSH tunnel): ok, 10 invariants passed.
- 13:48:40 snapshot 2 + `batches-verify`: headers match, counts match, 0 orphans, 0 mismatches.
- 13:49:10 `batches-parity`: **NO-GO, 175 differences**, all `get_batches data.batches[].product_sku`:
  Sheets stores all-digit SKUs as number cells (Apps Script emits a JSON number) while `serializeBatch`
  emitted text. Fixed in `5935a5b1` (regression test first; full suites green).
- 13:51:58 parity re-run with the fix (Postgres side computed locally): 0 differences (5 reads).
- 13:51 and 14:04 staging builds of `5935a5b1` FAILED on Railway: Docker Hub `429 Too Many Requests`
  pulling a base image (platform rate limit, not code). Flip held until a build succeeds.

| Step | Target (min) | Measured (min) | Result |
|------|--------------|----------------|--------|
| 3 Freeze + restart + check | 5 | | |
| 4 Snapshot, dry run, promote | 20 | | |
| 5 Second snapshot + verify | 10 | | |
| 6 Parity (after 300 s cache expiry) | 10 | | |
| 8 Flip + health + boot lines | 5 | | |
| 9 D-12 notices | 3 | | |
| 10 Smoke | 20 | | |
| 11 Scan invoices | 10 | | |

| Check | Result |
|-------|--------|
| Row counts (batches / batch_tasks / plato_readings / vessel_history) | |
| Rejects (must be 0) | |
| `batches-verify.js` (0 mismatches) | |
| `batches-parity.js` (parity: 0 differences) | |
| Smoke: create batch, mark task, add reading, vessel transfer | |
| Rollback rehearsal (replay, verify, notices removed, flag back) | |
| Fits the 2-hour budget with room for one rollback? | |

## Production prerequisites

| Check | Evidence | Date |
|-------|----------|------|
| Phase 86 production flip recorded (`OPS_DATA_STORE=postgres`, Q14/D-13) | | |
| Apps Script v62 deployed, rollback v61, editor-drift check | v62 live; pre-paste drift check skipped, post-paste hash matched repo; probes ok | 2026-10-09 |
| Staging rehearsal complete and within budget | | |
| Q1 orphan task rows BT-000567..570 deleted | Owner deleted the 4 rows; `export_batch_tabs` re-check shows 0 orphans in BatchTasks, PlatoReadings, VesselHistory (re-confirm before the production dry run) | 2026-10-09 |
| Q3 Apps Script timezone confirmed | Owner confirmed America/Vancouver. Caveat: Node 20.20.2 ships tzdata 2025c and will treat Vancouver as UTC-8 from 2026-11-01 (BC is permanently UTC-7). Must be fixed before the production window; see todo node-tzdata-bc-permanent-time | 2026-10-09 |
| Pinned production SHA | | |
| Migration 0005 and inert Phase 87 code on production | | |
| Window date and time agreed with owner | | |

## Production window

| Field | Value |
|-------|-------|
| Freeze set at (`BATCHES_FREEZE`) | |
| Flip at (`BATCHES_STORE=postgres`) | |
| Window closed at | |

Timeline:

| Step | Start | End | Notes |
|------|-------|-----|-------|

Go/no-go record (D-06):

| Gate | Result |
|------|--------|
| Dry run: 0 rejects | |
| Row counts equal | |
| `batches-verify.js` 0 mismatches | |
| `batches-parity.js` 0 differences | |
| Owner go/no-go decision and time | |
| Smoke: create batch / mark task / add reading / vessel transfer | |

Invoices taken during the window (numbers only):

| Invoice | Batch created by | Notes |
|---------|------------------|-------|

Scan invoices result:

## Next-business-day smoke (SC4)

| Check | Result |
|-------|--------|
| Kiosk and POS sales created batches | |
| `create_batch` median ms from `[batch-proxy] create_batch ms=<n>` logs | |
| Printed `batch.html` tokens open | |

## Rollback week

| Day | Date | Drift check (`[batches-drift]` line or Sentry) | Explained? | Action |
|-----|------|-----------------------------------------------|------------|--------|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |
| 6 | | | | |
| 7 | | | | |

The first production drift run may show false date mismatches; read its log lines and record them here.

## Retirement

| Field | Value |
|-------|-------|
| Retirement date (rollback no longer supported) | |
| Snapshots deleted | |

## SQL fixes

| Date | Batch ids | Reason | Dry-run count | Rows updated | Mirror replayed |
|------|-----------|--------|---------------|--------------|-----------------|
