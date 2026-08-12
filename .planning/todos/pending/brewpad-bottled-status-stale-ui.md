---
title: BrewPad — marking a batch bottled doesn't reflect in the UI until a full page refresh
status: pending
created: 2026-08-11
source: owner ticket (2026-08-11) — "Marking batches as bottled doesn't seem to go through until a full refresh which is confusing"
area: brewpad / batch views / caching
priority: medium
---

## Symptom (owner-reported)

After marking a batch bottled, the view still shows it un-bottled until a full page refresh.
Confusing — staff can't tell whether the action took.

## Code recon (2026-08-11)

- There is NO "bottled" status in the client status cycle — `js/brewpad.js` ~5227 cycles
  `primary → secondary → complete`. "Bottled" is presumably either status `complete`, the
  bottling-schedule completion, or a `bottled_date` field — **first step: confirm with the
  owner exactly which control they tap** ("mark bottled" from the Ready to Bottle list?
  the status badge? a schedule action?).
- Client caches: `_batchesData`, `_allBatchesData`, `_batchesLoaded`, `_dashLoadTime`,
  `sessionStorage['sv-bp-batch-<id>']`. The status-cycle handler (~5234-5254) DOES patch these
  and re-renders — so if the owner's path is the status badge, the stale view is likely the
  DASHBOARD ("Ready to Bottle" list ~3210 comes from `_dashSummary`/`d.readyToBottle`, a
  server-computed summary).
- Server side: Apps Script `adminApi.gs` caches reads via `_cachedGet` — an `update_batch`
  write does NOT necessarily invalidate the cached dashboard/batch-list read, so even a
  re-fetch can return the pre-update payload until the cache TTL lapses. A full page refresh
  "fixes" it partly by luck/timing, which matches the confusing behavior.

## Likely fix shape (verify first)

1. Identify the exact control + payload the owner uses for "bottled".
2. Make that mutation path invalidate/patch every view that displays it: local arrays,
   `_dashSummary` (or force `_dashLoadTime = 0` + refetch), sessionStorage snapshot, AND the
   Apps Script `_cachedGet` cache key for the affected reads (bust on write).
3. Optimistic UI update with rollback on error, mirroring the status-badge handler.

## Next step

Reproduce with devtools open (which request fires, what the follow-up GET returns) — if the
follow-up GET returns stale data, it's the Apps Script cache; if no follow-up GET happens,
it's client render wiring.
