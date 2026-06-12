---
phase: 28-zoho-customer-read-back-path
plan: 02
subsystem: apps-script
tags: [apps-script, google-sheets, batch-tracking, zoho, manual-verification]

# Dependency graph
requires:
  - phase: 28-zoho-customer-read-back-path
    plan: 01
    provides: GET /api/batch/customer-by-number middleware endpoint (read direction)
provides:
  - customer_email and customer_phone writable via updateBatch() allowedFields in adminApi.gs
  - customer_phone column header added to Batches sheet (was missing — Research OQ2 resolved)
  - Verified end-to-end read→write loop (Zoho → middleware → browser → Apps Script → Batches sheet)
affects: [29-refresh-from-zoho-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "allowedFields extension is the only change needed to open a batch field for writes (mirrors Phase 27 start_date)"
    - "get_batch response shape: { ok, data: { batch, tasks, plato_readings, vessel_history } } — caller must read data.batch.*"

key-files:
  created: []
  modified:
    - apps-script/adminApi.gs

key-decisions:
  - "D-09 honored: extend allowedFields only — no new Apps Script action; existing optimistic locking + sanitizeInput reused"
  - "D-02 verified: sending only non-empty fields preserves existing batch data (no collateral field changes observed)"
  - "D-10 verified: browser performed the two-call orchestration (middleware read, then update_batch) — no server-to-server coupling"
  - "D-12 honored: manual verification via curl + browser console, no throwaway scripts committed"

patterns-established:
  - "Batches sheet columns are header-lookup based: a missing column header silently no-ops the write (headers.indexOf === -1) — adding the header retroactively enables persistence with zero code change"

requirements-completed: []

# Metrics
duration: ~75min (including human checkpoints and environment setup)
completed: 2026-06-11
---

# Phase 28 Plan 02: Apps Script Write Path + Staging Verification Summary

**customer_email/customer_phone opened for writes in updateBatch() allowedFields, deployed manually to Apps Script, and the full read→write loop verified live: Zoho → middleware endpoint → update_batch → Batches sheet, with the missing customer_phone column discovered and added**

## Performance

- **Tasks:** 3 (1 auto + 2 human checkpoints)
- **Files modified:** 1 (apps-script/adminApi.gs)

## Accomplishments

- `updateBatch()` `allowedFields` extended with `'customer_email', 'customer_phone'` (commit `c3f7a72`) — entire diff is two array entries plus a comment
- Apps Script deployed manually by user (same pattern as Phase 27)
- **Read→write loop verified live** on batch `SV-B-000153` (INV-000094, kiosk sale):
  - Read: local middleware resolved INV-000094 → `Harbin, Daniela` / `dsbnbinbrackendale@yahoo.com` / `+1-6048151535` (also verified INV-000078 — the D-07 contact_persons fallback case — and INV-000092/93)
  - Write: browser-console `update_batch` with only non-empty fields + `expectedVersion` succeeded; batch now shows canonical Zoho name (was "Daniela Harbin"), email (was empty), and phone
  - No collateral changes: status, zoho_so_number, product, timestamps, source all untouched

## Task Commits

1. **Task 1: Add customer_email and customer_phone to updateBatch allowedFields** - `c3f7a72` (feat)
2. **Task 2: Deploy adminApi.gs** - (human action — no commit; deployed by user)
3. **Task 3: Verify read→write loop** - (human verification — no commit)

## Decisions Made

- **Research Open Question 2 RESOLVED:** the Batches sheet had NO `customer_phone` column. First write-back persisted name+email but the phone silently no-op'd (key absent from get_batch dump). User added the `customer_phone` header to the Batches tab; re-running the write-back persisted the phone with zero code changes — exactly the safe-no-op behavior the plan predicted.
- Verification target was INV-000094/SV-B-000153, not INV-000078 — no batch is linked to INV-000078; the contact_persons fallback (D-07) was still verified via direct read of INV-000078.

## Deviations from Plan

1. **Verification ran against the LOCAL middleware, not staging Railway.** The plan's prerequisite ("git push origin main; Railway redeploys") was wrong: Railway deploys the middleware from the **production** repo, and production was ~28 commits behind staging (pending Phase 27/27.1 work). Rather than force a bundled production deploy, the read endpoint was verified on `localhost:3001` running the exact committed code, against live Zoho data. The write path (Apps Script) is the real deployed instance.
2. **`MW_API_KEY` env alias needed locally** — the new endpoint (like all pos.js routes) checks `process.env.MW_API_KEY`; the local `.env` only has `API_SECRET_KEY`. Railway must have `MW_API_KEY` set (kiosk routes already depend on it and work in production), but this is worth a glance when the endpoint first runs in production.

## Issues Encountered

- Local middleware OAuth initially failed with "Invalid or expired OAuth state" — the CSRF state lives in Redis and no local Redis was running. Fixed by starting `redis-server` locally and pointing `REDIS_URL` at it.
- `get_batch` returns `{ batch, tasks, plato_readings, vessel_history }` under `data` — early verification snippets read `data.customer_name` and got undefined. **Phase 29's caller must read `data.batch.*`.**

## User Setup Required

Completed during this plan: Apps Script deploy + `customer_phone` column header on the Batches tab. Nothing further.

## Next Phase Readiness

- Phase 29 (Refresh-from-Zoho admin UI) is fully unblocked: read endpoint implemented + tested, write path open + verified, phone column exists
- Phase 29 notes: read `data.batch.*` from get_batch; send only non-empty fields (D-02); pass `expectedVersion` from `last_updated` (T-28-06)
- **Production deploy reminder:** the middleware endpoint reaches production only when `main` is next pushed to the production repo (it's on staging now, bundled with pending Phase 27/27.1 work)

---
*Phase: 28-zoho-customer-read-back-path*
*Completed: 2026-06-11*
