# Phase 96: New and upgraded dashboard graphs - Context

**Gathered:** 2026-10-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Add the handoff's graphs G1–G10 to the **v2 dashboard** (behind the per-device opt-in from Phase 95): production
over time, pipeline, cycle time, product breakdown and leaderboard, workload forecast, vessel capacity, task health,
fermentation curves, sales source mix and data health. Each graph has its own options, click-through to the exact
batch set, and a table view. Beer and cider appear as their own series wherever wine does.

Out of scope: beer/cider batch-card sections and the packaging calendar (Phase 97), alerts A1–A5 (Phase 98),
responsive/performance pass and making v2 the default (Phase 99). v1 stays frozen (Phase 95 D-03).

</domain>

<decisions>
## Implementation Decisions

### Approval
- **D-01:** The owner approved **G1–G10, all ten**, on 2026-10-28. Tick them in §7 of
  `.planning/research/brewpad-dashboard-v2.md`. Phase D, A1–A5 and Phase F stay unticked and out of scope.

### Task health (G7)
- **D-02:** Late `completed_at` stamps mean **work done on time and ticked later**, not real lateness (answers F8).
  So **G7 shows no on-time rate** anywhere. This resolves roadmap success criterion 3: the rate is never shown.
  On staging data, 233 of 304 tasks completed in the last 120 days were ticked after the due date.
- **D-03:** **Drop "completions by staff".** About 919 of 1032 completions are recorded as `hello@steinsandvines.ca`,
  the shared account, and the rest as `middleware`. G7 shows:
  - overdue ageing of **open** tasks: 1–3 d, 4–7 d and 8+ d past `due_date`, Vancouver calendar days;
  - completions over time.
  Recording individual staff names is a new capability and is deferred.

### Vessels (G6)
- **D-04:** Two active batches **can legitimately share a vessel** today. A vessel with 2+ active batches is shown in a
  neutral **"Shared vessels"** list: no red, no "conflict" or "double-booked" wording, and not counted as a data-health
  problem. This **replaces roadmap success criterion 2's "double-booked" framing**; the F5 list is out of date anyway.
  On 2026-10-28 staging had PFB-012, PFB-040, PFB-023, PCB-016, PCB-005, PFB-016 and PFB-022 shared.
- **D-05:** For capacity, a shared vessel counts as **one occupied vessel**.
- **D-06:** Capacity is grouped by the stored **vessel `type`**: Carboy, Bucket, Keg, Drum, Boil Kettle, Conical
  Fermenter, Mash Tun. ID prefixes are not used. Archived vessels are excluded.
- **D-07:** The list also shows **active batches with no vessel** (1 on staging). Each row taps through to the batch
  detail, where the vessel can already be changed. **No new write path.**

### Fermentation (G8)
- **D-08:** **No readings are required** at this point. There is **no "readings due" list**, no due rule and no alerts.
  This replaces roadmap success criterion 4's "readings due" pairing.
- **D-09:** Beside the curves, a neutral **"No readings yet"** list shows active **beer and cider** batches with no Plato
  reading, so missing curves are explained. It uses no "due" or "overdue" wording.
- **D-10:** The expected curve is a straight **OG → target FG line** over the batch's fermentation schedule length, from
  `recipe_snapshot`. When OG or target FG is missing, skip the expected line and plot readings only. ABV and attenuation
  come from OG/FG when both are known.

### Layout
- **D-11:** One scrolling page with **headed sections**. The filter bar stays pinned and the KPI tiles stay at the top.
  Section order:
  1. **Production:** G1 production over time, G2 pipeline, G3 cycle time.
  2. **Floor today:** G5 workload, G6 vessels, G7 task health, G8 fermentation.
  3. **Products & sales:** G4 product breakdown + top 10, G9 source mix.
  4. **Data health:** G10.
- **D-12:** **Production comes first** under the tiles.
- **D-13:** **View as table** is a per-widget **Chart / Table toggle** in the widget header. The table shows the same
  numbers from the same data layer.

### Data health (G10)
- **D-14:** G10 lists:
  - active batches with no vessel;
  - missing `completed_at` on completed batches;
  - missing `zoho_so_number`, labelled "no invoice link", never "unbilled";
  - blank `source`;
  - stale active batches over 90 days.
  Each row taps through. Per D-04, a **shared vessel is not a data-health item**, which amends roadmap criterion 5.

### Graph upgrades
- **D-15:** G1 **replaces and upgrades** Phase 95's "Batches per period" chart: wine/beer/cider stacked, period,
  group-by and measure (count/litres) from the global bar. It is not added as a second chart.
- **D-16:** G4 generalises today's Wine breakdown:
  - wine by subcategory / brand / manufacturer;
  - beer by style / recipe;
  - cider by recipe;
  - plus a top-10 products leaderboard.
  The leaderboard and G9 source mix are **mix views**, so staff batches are hidden by default (Phase 95 D-10).

### Carried forward (locked, do not re-ask)
- Every widget reads the single data layer `getDashboardData` and the stored `batch_type` (Phase 94 D-20). Type totals
  must agree across widgets for any filter combination.
- Global filter bar, hash and localStorage state, Monday–Sunday weeks, Vancouver calendar dates, and staff hidden only in
  mix views (Phase 95 D-04..D-10).
- Litres defaults: 23 L wine/cider/seltzer/other (estimate); beer 28 L in-progress and 25 L completed; `target_volume_l`
  overrides (Phase 95 D-11, D-17).
- Chart.js 4.5.1 self-hosted via the shared `chart()` helper; wine burgundy, cider gold, beer amber (Phase 95 D-12, D-13).
- Click-through opens the exact batch set with the dismissible banner; the bottom Batches tab clears it (Phase 95 D-14,
  95-10 fix).
- `get_dashboard_stats` through the admin-proxy seam, about 60 s cache. Postgres batch store only. `update_batch` nests
  `updates:{}`. Classify by `cf_type`/SKU, never by product name.
- v2 only; v1 frozen. No production data writes in this phase without an in-session owner OK and a `--dry-run`.

### Claude's Discretion
- **G3 cycle time:** box plot or histogram, and how the planned schedule length is overlaid.
- **G5 workload:** horizon toggle (14/30 days) and task-kind grouping from task titles and flags (`is_packaging`,
  `is_transfer`). Staging titles are Batch Start, Plunge Skins, Racking and Stabilization, Filtering,
  Bottling/Packaging, plus beer steps such as "Lower to 10ºC", "Crash to 0ºC", Keg and Carbonate. Map the temperature
  steps to one "Temperature step" kind.
- **G2 pipeline:** chart form (stacked bar or funnel) per type.
- **G9 source mix:** chart form. Kiosk includes `kiosk_recipe` (Phase 95 D-16) and Unknown covers blank.
- **"No readings yet" scope:** beer and cider only, per D-09. Including wine is not required.
- **Server data:** whether to extend `get_dashboard_stats` or add a bulk read. It needs task titles and completed
  tasks for G5/G7, the full readings for active batches for G8 (today only `latestReadings`), and vessels for G6.
- **Section headings and widget order within a section;** any copy not fixed above. The UI design contract settles
  these (`/gsd-ui-phase 96` recommended before planning).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Handoff and requirements
- `.planning/research/brewpad-dashboard-v2.md`: §3 findings F1–F10, §4 Phase C graph table G1–G10 with options,
  §5 constraints, §7 approval list (tick G1–G10).
- `.planning/ROADMAP.md`, "Phase 96": goal and draft success criteria. Criteria 2, 3, 4 and 5 are amended by D-02,
  D-04, D-08 and D-14.

### Prior phase decisions
- `.planning/phases/95-global-filters-and-chart-engine/95-CONTEXT.md`: filter bar, staff flag, litres, chart engine,
  click-through, deltas (D-01..D-19).
- `.planning/phases/95-global-filters-and-chart-engine/95-UI-SPEC.md`: tokens, colours, widget, banner and empty-state
  patterns to reuse.
- `.planning/phases/95-global-filters-and-chart-engine/95-REVIEW.md` and `95-REVIEW-FIX.md`: known pitfalls (stale
  cache, zero placeholders, custom-range clamp, singular/plural).
- `.planning/phases/94-dashboard-correctness-and-data-foundations/94-CONTEXT.md`: data layer (D-20), started-only
  totals (D-17), start/completion buckets (D-18), Vancouver dates (D-19), aggregate endpoint (D-21).

### Project rules
- `CLAUDE.md`: build artifacts, tests-first, CSP rule 12 (no new domains expected), staging first.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `getDashboardData(rows, asOf, filters)` (`js/brewpad.js:582`): the single selection layer, with id sets per bucket.
- `buildDashV2Model` (`js/brewpad.js:1173`) and `renderDashboardV2` (`js/brewpad.js:5798`): the v2 model and shell.
  New sections and widgets hang off these.
- `chart(canvas, cfg)` (`js/brewpad.js:1415`) and the lazy `loadChartJs`: every new chart goes through these, and the
  destroy-before-redraw is already handled.
- `openDashDrill(spec)` (`js/brewpad.js:6422`) and `dashDrillLabel`: click-through for every new bar, segment and row.
- `wineBreakdownBuckets` / `mergeWineSkuLookup` (Phase 95-04): the base for G4's generalised breakdown.
- `formatDelta`, `batchLitres`, `previousWindow`: reuse for any tile or measure.

### Established Patterns
- Pure, exported ES5 helpers with jsdom tests per widget (`tests/frontend/brewpad-dashboard-v2-*.test.js`); build with
  `npm run build` and revert unrelated re-stamped files.
- Mix views honour the staff toggle; production and capacity views always include staff batches.

### Integration Points
- `zoho-middleware/lib/batch-pg-read.js` `getDashboardStats`: today returns `batches`, `tasks` (active batches only;
  no `title`, no `completed_by`), `latestReadings` (latest only) and `staffBatchIds`. G5 needs task titles, G7 needs
  completed tasks over time, and G8 needs every reading for active batches. G6 needs `vessels` (`type`,
  `capacity_liters`, `archived`, from migration 0004) plus `batches.vessel_id`.
- Tables: `batch_tasks` (`due_date`, `completed_at`, `title`, `is_packaging`, `is_transfer`), `plato_readings`
  (`reading_at`, `degrees_plato`, `temperature`, `ph`), `vessels`.

</code_context>

<specifics>
## Specific Ideas

- Layout preview the owner picked:
  ```
  [Filter bar - pinned]
  KPI tiles
  ── Production ──
  G1 Production over time
  G2 Pipeline   G3 Cycle time
  ── Floor today ──
  G5 Workload   G6 Vessels
  G7 Task health
  G8 Fermentation
  ── Products & sales ──
  G4 Products + Top 10
  G9 Source mix
  ── Data health ──
  G10 Data health
  ```
- Wording: "Shared vessels" (never "conflict" or "double-booked"), "No readings yet" (never "due"), and
  "no invoice link" (never "unbilled").

</specifics>

<deferred>
## Deferred Ideas

- **Record who ticks a task:** a staff picker or individual logins, so "completions by staff" becomes possible. This
  is a new capability for a later phase.
- **Readings cadence and "readings due" alerts:** revisit if readings become required, e.g. once beer volume grows.
  This fits Phase 97 or 98.
- **Vessel conflict alert (A3):** with sharing legitimate (D-04), A3 needs rethinking in Phase 98, or dropping.

### Reviewed Todos (not folded)
- `todo.match-phase 96` returned 20 generic matches (kiosk, gift cards, beer pages, deploy workflow, tzdata) at uniform
  scores. None concern dashboard graphs, so none were folded.

</deferred>

---

*Phase: 96-new-and-upgraded-dashboard-graphs*
*Context gathered: 2026-10-28*
