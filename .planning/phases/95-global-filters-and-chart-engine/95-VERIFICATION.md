---
phase: 95-global-filters-and-chart-engine
verified: 2026-10-28T22:00:00Z
status: human_needed
score: 5/5 roadmap success criteria verified (1 with a residual human check)
overrides_applied: 0
human_verification:
  - test: "Open brewpad.html?dash=v2 on a real phone or iPad at <= 600px width"
    expected: "Filter bar collapses to a Filters button with count badge; bottom sheet opens with Apply / Reset; resizing across 600px swaps modes (WR-06 listener)"
    why_human: "Rollout UAT was run in desktop Chrome; the log says phone width was 'left to the iPad pass' and no phone-width result is recorded. Unit tests cover the logic only."
---

# Phase 95: Global filters and chart engine - Verification

**Goal:** Every dashboard widget responds to one sticky global filter bar, renders through a shared chart helper, and clicks through to the filtered batch list.

## Success criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Filter state in URL hash + localStorage; phones collapse to sheet | VERIFIED (phone UI human check) | parseDashHash / serializeDashFilters / resolveDashFilters in js/brewpad.js; rollout log: hash `#dash=v2&type=wine&period=90d&group=week`, persists across reload. Phone sheet only unit-tested. |
| 2 | Litres: 23 L wine/cider, beer 28/25, target_volume_L override | VERIFIED | `batchLitres` in js/brewpad.js; tests; UAT litres view with "estimated" subtitle |
| 3 | Bar/segment/tile opens Batches tab pre-filtered to exact set | VERIFIED | `openDashDrill`, drill banner; UAT: bar 10 = 10 batches, tiles 37/46/59/59 equal tile numbers; drill-on-tab-bar fix 26b34fd1 re-checked |
| 4 | KPI tiles show change vs previous equivalent period | VERIFIED | `formatDelta`, `previousWindow`; UAT showed `▼ 30 (-39%) vs prev 90d`, "vs prior 92 days" for custom |
| 5 | Chart library within CSP, no public CSP change | VERIFIED | Chart.js 4.5.1 self-hosted at js/vendor/chart.umd.min.js, sha256 48444a82... matches README; `loadChartJs` lazy (one request only after v2 opens); brewpad.html has no CSP meta, no public page touched |

Handoff items: D2 (filter bar), D3 (chart() helper + Chart.js 4), D4 (click-through), D5 (deltas) all present in code and ticked in research doc section 7.

## Supporting backend
- Migration `zoho-middleware/migrations/0008_staff_batch.sql` exists; `staff_batch` handled in batch-pg-create / batch-pg-update (strict boolean) / batch-pg-read (`staffBatchIds` on aggregate). Applied on staging and prod per rollout log (read-back recorded).
- Staff backfill: 20 batches applied on prod with owner OK, fingerprint gate, batches-verify 0 mismatches (rollout log, not re-run).

## Local checks (Node 24.21.0)
- Frontend `npm test`: 225 suites / 3012 tests pass; `npm run lint` clean.
- Middleware `npm test`: 258 suites / 3708 tests pass.
- No unreferenced TBD/FIXME/XXX debt markers introduced (matches in brewpad.js are pre-existing UI strings / invoice placeholders).

## Notes (non-blocking)
- WR-05 (staff hint wording, "Set by hand" on backfilled flags) skipped by owner decision.
- WR-02 and WR-03 fixes were flagged "requires human verification"; rollout log records a staging re-check (custom range, v2 renders, no console errors) but not the no-data-source loading path explicitly.
- test-e2e CI red since 2026-09, not gating.
- Requirements IDs are "TBD" in ROADMAP; D2-D5 mapped from the handoff doc.

## Gaps
None blocking. One residual human check: phone-width filter sheet on a real device.
