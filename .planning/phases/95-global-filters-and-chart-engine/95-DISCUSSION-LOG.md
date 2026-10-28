# Phase 95: Global filters and chart engine - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-28
**Phase:** 95-global-filters-and-chart-engine
**Areas discussed:** Approval, Staff & unknown batches, Release, Chart library & hosting, Click-through & periods, Litres

---

## Approval

| Option | Selected |
|--------|----------|
| D2 Global filter bar | ✓ |
| D3 Chart library | ✓ |
| D4 Click-through | ✓ |
| D5 Trend deltas | ✓ |

**User's choice:** all four approved.

---

## Staff & unknown batches

| Question | Options | Selected |
|----------|---------|----------|
| How to identify staff/family/R&D batches | Explicit flag + one-time reviewed candidate backfill · Rule (source + name list) · Source only | Explicit flag |
| Batches with no source (82/215) | "Unknown" filter option · Backfill sources · Treat as manual | "Unknown" option |
| Which views hide staff by default | Mix views only · Everything off by default · You decide | Mix views only |
| Candidate names for the flag backfill | McLachlan + Inn · Ask at dry run | McLachlan + Inn |

**Notes:** At discussion time, live data (read-only, production, 2026-10-27) showed these sources: blank 82, manual 63, kiosk 47,
zoho_scan 14, online 5, internal 3, research 1. `target_volume_l` was set on 0 batches.

---

## Release

| Question | Options | Selected |
|----------|---------|----------|
| How v2 reaches staff | Behind ?dash=v2, remembered per device · Straight to live · Live with classic-view link | Behind ?dash=v2 |
| Keep v1 in step? | Frozen (bug fixes only) · Keep in step | Frozen |

---

## Chart library & hosting

| Question | Options | Selected |
|----------|---------|----------|
| Library + hosting | Chart.js self-hosted in js/vendor · Chart.js from jsDelivr · Apache ECharts | Chart.js, self-hosted |
| Beer colour | Amber · Green · You decide | Amber |

---

## Click-through & periods

| Question | Options | Selected |
|----------|---------|----------|
| Drill-down display | Dismissible banner with the exact set · Reuse existing chips | Dismissible banner |
| Trend base | Previous same-length window (YTD vs same stretch last year; All none) · Same period last year | Previous window |
| Defaults | YTD, months, Mon–Sun weeks · 12 months, months | YTD, months, Mon–Sun |

---

## Litres

| Option | Selected |
|--------|----------|
| Beer 28 L for started, 25 L for completed (wine/cider 23 L; target_volume_L overrides) | ✓ |
| Always 25 L | |
| Always 28 L | |

## Claude's Discretion

- Filter-bar and phone-sheet layout, chart styling, tooltip format, custom-range picker (UI spec)
- Staff flag column name and edit placement
- Delta format (absolute vs %)

## Deferred Ideas

- Source backfill from invoice evidence (declined for now)
- G1–G10 (Phase 96), beer/cider sections (97), alerts (98), table views / performance / v2 default (99)
