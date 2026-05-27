---
phase: 06-kiosk-to-brewpad-integration
plan: 01
status: complete
started: 2026-05-03
completed: 2026-05-03
---

## Summary

Apps Script createBatch now supports pending batch mode. When called without schedule_id or start_date, it creates a batch with status=pending, skipping schedule validation, task creation, and vessel operations. The doPost server-token branch routes action=create_batch to createBatch with 'kiosk-middleware' as userEmail. New columns (source, zoho_so_number) appended to each batch row; customer_email suppressed for kiosk-sourced batches per D-09.

## Self-Check: PASSED

- `grep -c "isPending" apps-script/adminApi.gs` → 7 (≥5 required)
- `grep -c "create_batch" apps-script/adminApi.gs` → 2 (≥2 required)
- `grep -c "source.*manual" apps-script/adminApi.gs` → 1 (≥1 required)
- `grep -c "zoho_so_number" apps-script/adminApi.gs` → 1 (≥1 required)
- Batches sheet columns verified by human: source at U1, zoho_so_number at V1

## Key Files

### Created
(none)

### Modified
- `apps-script/adminApi.gs` — pending batch mode in createBatch, create_batch server action in doPost

## Deviations

- **Column alignment (D1):** Batches sheet had an existing `last_regenerated_at` column at position 20 (column T) not reflected in the plan's 19-position appendRow mapping. Added empty-string padding at position 20 so source and zoho_so_number land at columns U and V matching the sheet headers. Discovered during human checkpoint.

## Commits

- `8e7b3f3` feat(06-01): Apps Script pending batch mode and create_batch server action
- `34901f1` fix(06-01): align appendRow with Batches sheet column layout
