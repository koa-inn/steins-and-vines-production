# Phase 96 — Existing test edit decision

Owner decision: approve
Decided: 2026-10-28T21:25:46Z (owner, via execute-phase checkpoint 96-01 Task 1)

Scope: only `tests/frontend/brewpad-dashboard-v2-widgets.test.js`. No other existing test file may be edited (CLAUDE.md rule 10).
Line numbers re-grepped at HEAD 05dc48bf; they match the plan.

## Approved assertion changes

| # | Line(s) | Change | Plan |
|---|---------|--------|------|
| 1 | L274 | `#bp-dash-v2-period .bp-widget-title` 'Batches per period' → 'Production over time' (D-15) | 04 |
| 2a | L309-310 | Beer segment of Jan bucket (ids.beer = [B1], 1 batch): single-batch widget drill opens batch detail, no banner, `_dashDrill` null | 04 |
| 2b | L322 | Other segment of Feb bucket (seltzer + other = [S1], 1 batch): same single-batch rule | 04 |
| 2c | L380-381 | Wine Red with staff hidden ([W1], 1 batch): same single-batch rule (label also changes, item 4) | 06 |
| 3 | L353 | `live().length` toBe(2) → count live instances per chart slot (one per canvas) | 05, 06 |
| 4 | L373, L381 | 'Wine breakdown' → 'Products'; label 'Wine Red started YTD' → 'Wine, Subcategory Red' (UI-SPEC G4 banner) | 06 |
| 5 | L393-401 | `[data-dash-wine-dim]` chips (aria-pressed, 'time' dimension) → G4 Type segment + `Group by` select; 'Unknown' → 'Unspecified' | 06 |
| 6 | L403-410 | "hidden for Beer and Cider" test → G4 stays visible for all types | 06 |

For items 2a-2c, each test either asserts the detail opened (selectBatch called for that id, `_dashDrill` null) or seeds one extra batch in that single test so the set has 2+ batches. The shared `rows()` fixture must not change.

## Not affected (must keep passing unchanged)

- L330-331: Feb whole column (ob.all = [C1, S1], 2 batches) → banner as before.
- KPI tile drills L214-233, including 'Days to complete, YTD · 1 batch'. The single-batch rule applies to widget drills only; tile clicks always open the banner.
- Slot ids `bp-dash-v2-period` / `bp-dash-v2-wine`, `.bp-widget-title` / `.bp-widget-sub` classes, G1 subtitle 'Started batches · YTD · by month', G1 aria-label format, 4 legend items, 'Loading charts…' / 'Charts could not load…' copy, staff note inside `.bp-widget-sub` of #bp-dash-v2-wine, the shell test slot-id list.

Each edit lands in the plan whose behaviour forces it and cites this decision in its commit message.
