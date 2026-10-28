---
phase: 96
slug: new-and-upgraded-dashboard-graphs
status: draft
shadcn_initialized: false
preset: none
created: 2026-10-28
---

# Phase 96 — UI Design Contract

> Scope: graphs G1–G10 on the BrewPad v2 dashboard (`?dash=v2`; brewpad.html, js/brewpad.js ES5, css/brewpad.css). Extends the approved `95-UI-SPEC.md`; anything not restated here is inherited unchanged (tokens, spacing, typography, widget card, `chart()` defaults, legend, tooltip, banner, empty/error states, delta format, filter bar, phone sheet). Edit sources only, never `*.min.*` (run `npm run build`). v1 is frozen. Primary device: shop iPad Safari PWA (touch); phone <= 600px.

Sources: D-01..D-16 in 96-CONTEXT.md are locked. Items marked (default) are researcher choices inside "Claude's Discretion".

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (static HTML, vanilla ES5; no React, no components.json) |
| Preset | not applicable |
| Component library | none (hand-rolled `bp-*` classes in css/brewpad.css) |
| Icon library | none (text glyphs only: `▲ ▼ ✕ › ✓`) |
| Chart library | Chart.js 4.5.1 self-hosted, via `chart()` / `loadChartJs` only. No plugins (the planned-length and expected-curve lines are drawn with Chart.js built-in line datasets or a tiny inline plugin in `chart()` options, not `chartjs-plugin-annotation`). No new CSP domain |
| Font | `--font-body` (Lato / Helvetica Neue / Arial), same as Phase 95 |

---

## Spacing Scale

Inherited, multiples of 4 only.

| Token | Value | Usage in this phase |
|-------|-------|---------------------|
| xs | 4px | Gap inside segmented controls; glyph gaps |
| sm | 8px | Header control gap; table cell vertical padding; legend gap |
| md | 16px | Widget padding; gap between widgets; table cell horizontal padding is 12px (exception, see below) |
| lg | 24px | Gap between sections; space above a section heading |
| xl-3xl | 32/48/64px | Not used |

Exceptions: touch targets `min-height: 44px` (toggle buttons, option selects, legend buttons, list rows, table rows that are clickable, accordion headers). Table cell horizontal padding 12px (the one non-grid-scale value; matches existing `.bp-select` padding). Chart heights 240px tablet / 200px phone as in Phase 95, except: G7 ageing strip 120px, G6 capacity chart height = 48px per vessel type row plus 32px axis, G8 and G3 stay at 240px (G8 280px on tablet, 220px on phone for readability of curves).

---

## Typography

No new size or weight. Weights 400 and 700 only.

| Role | Size | Weight | Line Height | Phase 96 use |
|------|------|--------|-------------|--------------|
| Body | 14px | 400 | 1.4 | Table cells, list rows, option select text, banner text |
| Label | 12px | 400 (700 for table header cells, list group counts, active segment) | 1.4 | Subtitles, notes, axis ticks, legend, tooltips, chips |
| Heading | 16px | 700 | 1.2 | Section headings (`<h2 class="bp-dash-section-title">`) |
| Widget title | 14px | 700 | 1.2 | Widget title (reuses Body size at weight 700; Phase 95 used 16px for widget titles on the single-section layout, now demoted so the new section headings outrank them) |
| Display | 1.7rem | 700 | 1.1 | `.bp-stat-num` only (unchanged) |

Selects and date inputs stay 16px to prevent iOS zoom-on-focus. Tables use `font-variant-numeric: tabular-nums` and right-align numeric columns.

---

## Color

Warm light theme; page colours unchanged.

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `--cellar-canvas` #e8e2ca | Page background |
| Secondary (30%) | `--cellar-raised` #faf8f2 / `--cellar-surface` #f5f1e6 | Widget cards, table header row, list rows, filter bar |
| Accent (10%) | `--stain` #370e13 | Reserved list below |
| Destructive | `--batch-danger` #a83232 | Not used anywhere in Phase 96. No red on Shared vessels, No readings yet, or Data health (D-04, D-08) |

Accent reserved for: (1) `.bp-stat-num`; (2) selected segment fill in the filter bar, **and** in widget-header controls (Chart/Table toggle and per-widget option segments), same `--stain` fill with `--cellar-raised` text; (3) the phone "Filters" badge. Nothing else: not chart series, not list counts, not section headings.

### Series colours

Type series (wine, cider, beer, other) use the Phase 95 tokens `--chart-wine` #6e1a2c, `--chart-cider` #a8841a, `--chart-beer` #9a4e0c, `--chart-other` #9a8672, always in that order, with the 2px `--cellar-raised` separator between stacked segments. Wherever a widget is split by type (G1, G2, G3 under All, G4 leaderboard, G8 lines) the type colours apply and type names are always in the legend, tooltip and table.

Non-type categories (G5 task kinds, G9 sources) need their own palette so they never get mistaken for a product type. This phase adds exactly six tokens in `:root`, the only new tokens:

| Token | Value | Used for |
|-------|-------|----------|
| `--chart-cat-1` | #3f6670 (slate teal) | G5 Rack / transfer; G9 Kiosk |
| `--chart-cat-2` | #5f6b3a (olive) | G5 Filter; G9 Online |
| `--chart-cat-3` | #6e4a6a (plum) | G5 Package; G9 Manual |
| `--chart-cat-4` | #b0623f (clay) | G5 Temperature step; G9 Zoho scan |
| `--chart-cat-5` | #4a403a (charcoal) | G5 Other; G9 Other (research, internal) |
| `--chart-cat-6` | alias of `--chart-other` | G9 Unknown (neutral grey: unknown is "no data", not a category) |

All meet 3:1 against #faf8f2 (executor verifies with the iPad; the 2px separator, named legend and Table view carry meaning regardless). G5 and G9 never also show type colours in the same chart, so no clash with burgundy/clay.

Task-ageing (G7) and capacity (G6) are not categorical, so they use neutral ink ramps and carry labels, not hue:

- G7 ageing bars: 1–3 d `--ink-tertiary`, 4–7 d `--ink-secondary`, 8+ d `--ink-primary`. Darker means older. No red, no amber.
- G6 capacity: "In use" fill `--ink-secondary`, "Available" fill `--ledger-soft` with 1px `--ledger-line` border.
- G8 expected line: dashed (6px dash, 4px gap) `--ink-tertiary`, 2px; readings are solid type colour with 4px round points. Dash vs solid distinguishes expected from actual, not colour alone.

Colour is never the only signal: every series has a named legend item, every tooltip names the series, every widget has a Table view (D-13) and ageing/capacity values are printed as data labels on the bars.

---

## Page layout (D-11, D-12)

Order under the sticky filter bar: KPI tiles, then four headed sections:

| # | Section heading (`<h2>`) | Widgets, in order |
|---|--------------------------|-------------------|
| 1 | `Production` | G1 Production over time (full width); G2 Pipeline and G3 Cycle time (side by side) |
| 2 | `Floor today` | G5 Workload and G6 Vessels (side by side); G7 Task health (full); G8 Fermentation (full) |
| 3 | `Products & sales` | G4 Products (full, with Top 10 inside); G9 Source mix (full) |
| 4 | `Data health` | G10 Data health (full) |

Section heading: 16px/700 `--ink-primary`, 1px `--ledger-line` rule beneath (padding-bottom 8px), 24px above, 16px below. A 12px `--ink-secondary` one-line hint to the right on tablet (below on phone): Production `Follows the filters above`; Floor today `Right now, mostly ignores the period filter`; Products & sales `Follows the filters above; staff batches hidden by default`; Data health `All batches, ignores the filters`. Section headings are not sticky and not collapsible (default).

Grid: widgets sit in `.bp-dash-grid`. >= 768px: 2 columns, `gap: 16px`, `align-items: start`; "full" widgets span both. < 768px (iPad portrait stays 2-col at 768 exactly; below it) and phone: 1 column in the same order. Cards are never equal-height-stretched (lists vary in length).

Phone (<= 600px): single column, chart height 200px, widget header controls wrap onto a second row (see Widget header), tables scroll horizontally inside their wrapper. Nothing else changes; the existing filter sheet is reused.

---

## Widget anatomy (D-13)

Every graph is a `.bp-widget` (card styling inherited). New inner structure:

```
.bp-widget
  .bp-widget-head           flex, wrap, gap 8px, align-items flex-start
    .bp-widget-titles       flex 1 1 200px
      h3.bp-widget-title    14px/700
      p.bp-widget-sub       12px --ink-secondary (measure · period · grouping; litres-estimate note appended where litres apply)
    .bp-widget-controls     flex, gap 8px, align-items center, justify-content flex-end
      per-widget option control (optional)
      Chart / Table toggle (optional)
  .bp-widget-note           optional 12px --ink-secondary line (staff note etc.)
  .bp-widget-body           chart (.bp-chart + canvas + HTML legend) OR table (.bp-table-wrap)
```

- **Options control** (the per-widget options row): 2–4 mutually exclusive choices render as `.bp-seg` (radiogroup, 44px); more than 4 or dynamic lists render as `.bp-select` (native, 44px, 16px text, max-width 200px tablet, full width on phone). Label is the control's `aria-label`; selects also show a visible 12px/700 label above only on phone. Option state is in-memory per widget (resets on reload; not in the hash). Changing it re-renders only that widget and never changes the global filters.
- **Chart / Table toggle**: two-segment `.bp-seg` with buttons `Chart` and `Table`, `role="radiogroup"` `aria-label="View as"`. Default Chart. Selected fill = accent (see Color). State is in-memory per widget and survives filter changes. On phone the controls row drops under the titles, options first then toggle, toggle right-aligned.
- **Widgets with no toggle** (lists are already tables): G6 lists, G8 "No readings yet" list, G10. Their charts (G6 capacity, G8 curves) still have a toggle covering the chart part only; G10 has none.
- **Table view**: `.bp-table-wrap` (`overflow: auto; max-height: 360px`, border 1px `--ledger-line`, radius `--r-md`) containing `<table class="bp-table">` with a visually hidden `<caption>` repeating the title and subtitle. Header row sticky, background `--cellar-surface`, 12px/700 `--ink-secondary`, bottom border 1px `--ledger-emphasis`. Cells 14px, padding 8px 12px, row border-bottom 1px `--ledger-line`, no zebra. First column left-aligned and sticky on horizontal scroll; numeric columns right-aligned. Totals row (when the chart is stacked) is last, 700, top border 1px `--ledger-emphasis`. The table uses the same numbers from the same model as the chart (D-13); type names are spelled out (`Wine`), never colour-only chips.
- **Clickable table rows/cells**: any row whose chart equivalent drills is a `<tr>` with a `<button class="bp-table-link">` in the first cell filling the row (`min-height: 44px`, text-align left, `›` glyph right at 12px `--ink-tertiary`); numeric cells that drill are also buttons. Same `openDashDrill` spec as the chart, so counts match. Focus ring 2px `--ledger-focus`.
- **Hover/press**: pointer rows get `--cellar-surface` background; `:active` `--ledger-soft`. Reduced motion: no transitions beyond 200ms.

Shared states (every widget; copy extends Phase 95):

| State | Presentation |
|-------|--------------|
| Loading | Dashboard-wide all-or-nothing as in Phase 95; widgets render only with data. Chart.js not yet loaded: `.bp-empty` `Loading charts…` in `.bp-widget-body` |
| Filtered to zero | `.bp-empty` with the widget's own empty copy below (falls back to `No batches match these filters.` + `Reset filters`) |
| Chart.js failed | `.bp-empty` `Charts could not load. Reload the page to try again.` Table view and lists still work (they need no Chart.js) |
| Data error | Phase 94 pattern `Failed to load dashboard: {message}. Reopen the Dashboard tab to try again.` once at page level, not per widget |
| Server data missing a field | Widget shows `.bp-empty` `Not available yet.` and the rest of the page renders (guard against a stale 60 s cache from before the endpoint extension) |

Never render a zero placeholder or "0 batches" before data exists. Singular/plural everywhere: `1 batch`, `2 batches`, `1 task`, `1 vessel`.

---

## Click-through and banner (extends Phase 95 section 4)

All drills go through `openDashDrill(spec)` / `dashDrillLabel` and the existing `.bp-drill-banner` (dismiss `✕`, `aria-label="Clear dashboard filter"`). Pattern: `From dashboard: {subject} · {N} batches`. Label per widget:

| Widget / target | Banner text |
|-----------------|-------------|
| G1 bar (type x bucket) | `From dashboard: Wine started in Jun 2026 · 33 batches` (verb `started`, or `completed` if the Measure series is completions; inherited) |
| G2 stage segment | `From dashboard: Beer at Secondary · 6 batches` (stage name as shown on the axis); Complete: `From dashboard: Beer completed YTD · 12 batches` |
| G3 histogram bar | `From dashboard: Wine completed in 21–27 days · 12 batches` |
| G4 breakdown bar | `From dashboard: Wine, Brand Vintner's Reserve · 9 batches` (`{Type}, {Dimension} {value}`); Top 10 row: `From dashboard: Top product Cabernet Sauvignon · 9 batches` |
| G5 day x kind | `From dashboard: Racking due Nov 4 · 3 batches` (kind in sentence case, `due {Mon D}`) |
| G6 In use segment | `From dashboard: Carboys in use · 12 batches`; Shared vessel row: `From dashboard: Shared vessel PFB-012 · 2 batches`; No-vessel row opens the batch detail directly (D-07), no banner |
| G7 ageing bar | `From dashboard: Tasks 4–7 days overdue · 5 batches`; completions bar: `From dashboard: Tasks completed in Jun 2026 · 40 batches` |
| G8 line/point | Opens that batch's detail directly (single batch), no banner. "No readings yet" row: batch detail directly |
| G9 source x bucket | `From dashboard: Kiosk batches started in Jun 2026 · 9 batches` |
| G10 category header link | `From dashboard: No invoice link · 57 batches`; a row opens that batch's detail directly |

Rules: a drill that resolves to exactly one batch opens the batch detail without a banner. Counts are batch counts from the clicked set (a task-based bar shows the number of distinct batches, and its tooltip also states the task count, e.g. `7 tasks · 5 batches`). Empty set after a refresh: `No batches in this set any more.` (inherited). Clearing and Batches-tab behaviour unchanged.

---

## Graph contracts

Common to all: series order wine, cider, beer, other where type-split; tooltips `mode: 'index'`, `intersect: false` for bar/line; litres show `{n} L` with thousands separators; custom HTML legend below the canvas; `canvas role="img"` with a one-sentence `aria-label` summarising the top values; all subtitles state measure, period, grouping. Within a section widgets read the global Type/Period/Group by/Measure/Source/Staff filters except where a widget says "ignores".

### G1 Production over time (replaces Batches per period, D-15)

- **Chart**: stacked column, x = week/month buckets from Group by (Monday–Sunday weeks), series wine/cider/beer/other (other only under All; seltzer and other share the neutral colour). Y from 0; integer ticks for batches, thousands separators for litres, axis title omitted (unit in subtitle). Full width, 240px.
- **Options**: segment `Started | Completed` (default Started; "Completed" buckets by `completed_at`, per Phase 94 D-18). Measure (batches/litres), Period, Group by come from the global bar, not duplicated here.
- **Subtitle**: `Started batches · YTD · by month` / `Completed litres · 12m · by week`, plus `litres estimated from standard batch sizes` when estimated.
- **Table**: columns `Period` | `Wine` | `Cider` | `Beer` | `Other` (Other omitted unless Type=All) | `Total`. Cell unit follows Measure. One row per bucket, newest first (default; chart is oldest left).
- **Click**: bar segment drills (banner above). Table cell drills identically; Total cell drills the whole bucket.
- **Empty**: `No batches match these filters.` + `Reset filters`.
- Staff batches always included (production view); no staff note.

### G2 Pipeline

- **Chart (default)**: horizontal stacked bar, one row per stage top to bottom `Pending`, `Primary`, `Secondary`, `Ready to bottle`, `Complete`; segments split by type (wine/cider/beer/other), data labels with the stage total at the bar end (12px). Height = 48px x 5 + 32px axis (272px), phone same row height. Stage names come from the stored batch status mapping; the planner must map the existing status values to these five labels and show any unmapped status under `Other stage` (do not drop batches).
- **Options**: none (type split comes from the global Type filter; a single type simply shows one series). The widget still has the Chart / Table toggle.
- **Subtitle**: `Active batches by stage · right now` ; `Complete` row note: `Complete counts batches finished in {period}` appended as a 12px `.bp-widget-note`. Active stages ignore Period and Source-date logic but honour Type, Source and Staff (production view: staff included).
- **Table**: `Stage` | `Wine` | `Cider` | `Beer` | `Other` | `Total`.
- **Click**: segment drills.
- **Empty**: `No batches match these filters.`

### G3 Cycle time

- **Form (decision)**: histogram, not box plot (Chart.js 4 has no native box plot and no plugins allowed). x = days from start to complete in 7-day bins `0–6`, `7–13`, `14–20` ... capped at a last open bin `{N}+` where N is the first multiple of 7 at or above the 95th percentile (so an outlier never stretches the axis). y = number of completed batches, integer ticks. Stacked by type under All; single series otherwise.
- **Planned-length overlay**: one vertical dashed line per visible type at its median planned schedule length (from `recipe_snapshot`), colour = that type's colour, dash pattern 6/4, labelled at the top with `Planned {N} d` (12px). If no planned length is known for a type the line is omitted and the subtitle says nothing about it. Under All with three types the labels stagger vertically (12px offset each) to avoid overlap.
- **Options**: `.bp-select` `All products` (default) plus subcategory names (wine) / style names (beer) / recipe names (cider) for the current Type; hidden under Type=All. Label `Product`.
- **Subtitle**: `Days from start to complete · YTD · median 31 d` (median of the filtered set; `median 31 d` omitted when the set is empty).
- **Table**: columns `Days` (bin) | per-type counts | `Total`, plus a last row `Planned (median)` in days per type (not clickable).
- **Click**: bar drills (`completed in 21–27 days`).
- **Empty**: `No completed batches in this period.` + `Reset filters`.
- Staff batches included (production view).

### G4 Product breakdown and Top 10 (D-16)

Two blocks inside one full-width widget titled `Products`, stacked: breakdown on top, `Top 10 products` below. On >= 768px they sit side by side (breakdown 60%, Top 10 40%); stacked below 768px. Each block has its own Chart/Table toggle (the widget header toggle controls the breakdown; Top 10 has an inline toggle in its sub-header).

- **Breakdown chart**: horizontal bar, one bar per bucket sorted by value desc, label left (ellipsis at 24 chars, full text in tooltip and table), value at bar end. Bar colour = the chosen type colour (single series). Height = 32px per bar capped at 12 bars (+ `Other ({n} more)` rolled-up final bar), max 440px, scrolls inside the widget no further.
- **Options (per-type dimensions)**: a `.bp-seg` `Wine | Cider | Beer` picks the type (default: the global Type when it is a single type, otherwise Wine; changing it does not change the global filter). A `.bp-select` `Group by` (aria-label `Dimension`) lists the dimensions for that type: Wine: `Subcategory`, `Brand`, `Manufacturer`; Beer: `Style`, `Recipe`; Cider: `Recipe`. Default is Wine Subcategory (today's Wine breakdown, so nothing moves), Beer Style, Cider Recipe. Missing values group as `Unspecified`.
- **Note** (12px, as Phase 95): `Staff batches hidden` / `Including staff batches`.
- **Subtitle**: `Wine by subcategory · started YTD`, litres appended where Measure=Litres.
- **Top 10**: horizontal bars, rank number `1.`–`10.` prefixed in the label, all types together, coloured by type, ranked by the global Measure (batches or litres), ties broken alphabetically. Product label = recipe or SKU name by `cf_type`/SKU classification (never product-name matching). Under a single-type global Type it shows that type only. Fewer than 10 products shows what exists.
- **Table**: breakdown `Name` | `Batches` | `Litres` | `Share` (percent, one decimal); Top 10 `Rank` | `Product` | `Type` | `Batches` | `Litres`.
- **Click**: bar or row drills.
- **Empty**: `No batches match these filters.` + `Reset filters`.
- Mix view: staff hidden by default.

### G5 Workload forecast

- **Chart**: stacked column, x = each day from today for the horizon, y = open tasks due, integer ticks. Series are task kinds: `Racking / transfer` (cat-1, from `is_transfer` or title Racking and Stabilization), `Filtering` (cat-2), `Packaging` (cat-3, from `is_packaging` or Bottling/Packaging), `Temperature step` (cat-4, titles like "Lower to 10ºC", "Crash to 0ºC"), `Other` (cat-5: Batch Start, Plunge Skins, Keg, Carbonate, dry hop and anything unmatched). Today's column gets the x label `Today` in 700 weight; other labels `Wed 4`. Phone: label every second day.
- **Options**: segment `14 days | 30 days` (default 14 days).
- **Overdue**: not plotted here (G7 owns it). Tasks already overdue appear in no column; a 12px note under the chart says `{N} open tasks are overdue. See Task health.` only when N > 0 (plain text, no red).
- **Subtitle**: `Open tasks due · next 14 days`.
- **Table**: `Date` | one column per kind | `Total`; one row per day including days with 0 (a real zero is allowed here since data exists).
- **Click**: bar segment drills (`Racking due Nov 4`).
- **Empty**: `No open tasks due in the next 14 days.` (uses the chosen horizon).
- Honours global Type and Source; ignores Period; staff included (capacity-style view).

### G6 Vessels (D-04..D-07)

Left-to-right content in one card (stacked on narrow): capacity chart, then two lists.

- **Capacity chart**: horizontal stacked bar, one row per stored vessel `type` that has at least one non-archived vessel, ordered Carboy, Bucket, Keg, Drum, Boil Kettle, Conical Fermenter, Mash Tun; segments `In use` and `Available`; data label inside/after: `12 of 30`. A shared vessel counts once (D-05). Archived vessels are excluded.
- **Options**: segment `Vessels | Litres` (default Vessels; Litres sums `capacity_liters`, vessels with no capacity are counted in Vessels only and the Litres subtitle appends `vessels with no capacity recorded are left out`).
- **Subtitle**: `Right now · all batch types and sources`. This widget ignores every global filter (physical state); a 12px note says `Ignores the filters above`.
- **Table (chart part only)**: `Vessel type` | `In use` | `Available` | `Total`.
- **Click**: In use segment drills (`Carboys in use`); Available segment is inert (cursor default, tooltip only).
- **Shared vessels list**: sub-header `Shared vessels` with count in parentheses, 14px/700; one-line 12px note `More than one active batch is using the same vessel. This is allowed.` Each row (44px+): vessel id and type (`PFB-012 · Conical Fermenter`) left; right `2 batches` and `›`; second line 12px `--ink-secondary` lists the batch IDs. Neutral rows, no accent, no red, no icon. Tap drills (banner above). Empty: `No vessels are shared right now.`
- **No vessel list**: sub-header `No vessel` with count; rows show batch id, product, type spelled out, and `›`; tap opens the batch detail (where the vessel can be set; no write path here). Empty: `Every active batch has a vessel.`
- Lists show 5 rows then a `Show all {N}` text button (44px, `aria-expanded`); same rule everywhere lists appear.
- Wording rule: never "conflict", "double-booked" or "error" in G6.

### G7 Task health (D-02, D-03)

One widget, two charts stacked, no on-time rate and no staff anywhere.

- **Overdue ageing (top)**: horizontal bar, three rows `1–3 days`, `4–7 days`, `8+ days`, count of open tasks past `due_date` (Vancouver calendar days), neutral ink ramp (see Color), count printed at the bar end, 120px tall. Sub-header `Open tasks past due date`.
- **Completions over time (bottom)**: single-series column chart (neutral `--ink-secondary`), x buckets from global Period/Group by, y = tasks completed. Sub-header `Tasks ticked off`. 12px note beneath: `Tick times can lag the work, so this is not an on-time rate.`
- **Options**: `.bp-select` `Task kind` (aria-label): `All tasks` (default) and the five G5 kinds. Applies to both charts.
- **Subtitle**: `Tasks · {period} · by month`.
- **Table**: two tables under the one toggle, each with its own 12px sub-header: ageing `Overdue by` | `Open tasks` | `Batches`; completions `Period` | `Tasks completed`.
- **Click**: ageing bar and completions bar drill (banner above).
- **Empty**: ageing none: `No open tasks are overdue.` (neutral, positive tone not needed); completions none: `No tasks were ticked off in this period.`
- Honours Type, Source (via batch), and Period only for the completions chart; staff included.

### G8 Fermentation (D-08..D-10)

- **Chart**: line chart, x = days since batch start (0 to the longest schedule length among plotted batches), y = degrees Plato (°P), y axis title `°P` 12px, begins at 0. Beer and cider only; wine is never plotted.
- **Modes via options**: `.bp-select` labelled `Batch`: `All batches with readings` (default) or one fermenting beer/cider batch (`BATCH-ID · recipe`, only those with at least one reading).
  - All mode: one thin line (2px) per batch coloured by type (beer amber, cider gold), points 3px; no expected lines (clutter); a batch with one reading shows a single point. Legend lists the two types, not each batch; tapping a line or point opens that batch's detail. Cap at 20 plotted batches, note `Showing the 20 most recent. Pick a batch to see others.`
  - Single-batch mode: solid readings line in the type colour with 4px points, plus the dashed expected line OG to target FG across the schedule length (D-10). If OG or target FG is missing, no expected line and a 12px note `No expected curve: this recipe has no OG or target FG.` Under the chart, a stat row (12px labels, 14px/700 values, wraps 2x2 on phone): `OG`, `Latest`, `Target FG`, `Attenuation`, `ABV`. Attenuation `{n}%` and ABV `{n.n}%` appear only when OG and FG are both known; otherwise that stat shows `–`.
- **Subtitle**: `Plato readings · active beer and cider`.
- **Type under filter**: if global Type = Wine, the chart body shows `.bp-empty` `Fermentation curves cover beer and cider.`
- **Table (chart part)**: `Batch` | `Type` | `Day` | `°P` | `Temp` | `pH`, one row per reading, newest first, missing temp/pH as `–`. In single-batch mode only that batch.
- **No readings yet list** (D-09): sub-header `No readings yet` with count, below the chart, same row anatomy as the G6 lists: batch id, product, type spelled out, and `Day {N}` of fermentation; tap opens the batch detail. Sorted by day descending. Copy never uses "due", "overdue" or "missing". Scope: active beer and cider. Empty: `Every active beer and cider batch has a reading.` When no readings exist anywhere the chart body shows `.bp-empty`: `No Plato readings have been recorded yet.`
- Ignores Period; honours Source and Staff (staff included, production-style). Global Type narrows beer/cider.

### G9 Source mix

- **Chart (decision)**: stacked column over time (not doughnut: it needs a time axis and a share option), x buckets from Group by, series `Kiosk` (cat-1, includes `kiosk_recipe`), `Online` (cat-2), `Manual` (cat-3), `Zoho scan` (cat-4), `Other` (cat-5, research and internal; only non-empty when staff batches are included), `Unknown` (cat-6, blank source). Series order as listed. Legend names all six; a series with zero in the range is omitted from the legend.
- **Options**: segment `Count | Share` (default Count; Share is 100% stacked with `%` y ticks and tooltips showing both). Measure (batches or litres) follows the global bar.
- **Note**: `Staff batches hidden` / `Including staff batches` (mix view).
- **Subtitle**: `Started batches by source · YTD · by month`.
- **Table**: `Period` | `Kiosk` | `Online` | `Manual` | `Zoho scan` | `Other` | `Unknown` | `Total` (Share mode shows percentages).
- **Click**: bar segment drills.
- **Empty**: `No batches match these filters.` + `Reset filters`.
- Global Source filter, if set, shows only that source and the subtitle says `Source: Kiosk`.

### G10 Data health (D-14)

- **Anatomy**: list widget, no chart, no toggle. Five category rows, each an accordion header (`<button aria-expanded>`, 44px+): label left, count right in 700, then `›`/rotated chevron glyph `▾`. Categories in order:
  1. `No vessel` (active batches with no vessel)
  2. `Missing completion date` (completed batches with no `completed_at`)
  3. `No invoice link` (no `zoho_so_number`)
  4. `Blank source`
  5. `Stale active batches` (active more than 90 days)
- **Expanded content**: up to 5 rows (batch id, product, type spelled out, and a 12px detail such as `Active 112 days` / `Staff batch`), then `Show all {N}` and a text button `Open these batches` that drills (banner above). A row opens the batch detail.
- **Count 0**: row is non-expandable, count shown as `0` with `✓` glyph and `--ink-tertiary` text. Neutral, never red or amber on any category, including high counts.
- **Note** (12px, under subtitle): `No invoice link means no Zoho sales order is stored on the batch. It does not mean the batch is unbilled.`
- **Subtitle**: `All batches · ignores the filters above`.
- **Shared vessels are not listed here** (D-14); G6 owns them.
- **Staff**: staff batches are included and tagged `Staff batch` in the row detail.
- **Empty (all five zero)**: `.bp-empty` `No data issues found.`

---

## Accessibility and touch

- Every interactive element (toggle segments, option segments/selects, legend toggles, list rows, accordion headers, table link buttons, `Show all`) is at least 44px high; chart hit zones use full-column `mode: 'index'`.
- Chart/Table toggle and option segments are `role="radiogroup"`; arrow keys move, Space/Enter select; focus ring 2px `--ledger-focus`. After toggling, focus stays on the toggle.
- Charts: `role="img"` + `aria-label`; the Table view is the accessible alternative (hidden captions, `scope` attributes). The currently hidden view is removed from the DOM or `hidden` so screen readers do not read both.
- Colour is never the sole signal (see Color); stacked separators 2px; type names spelled out in lists, tables and tooltips.
- `prefers-reduced-motion`: Chart.js animation off; accordion open/close without animation.

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Primary CTA | None new. The only CTAs remain Phase 95's `Apply Date Range` / `Apply Filters`. New actions are secondary: `Show all {N}`, `Open these batches`, `Reset filters` |
| Section headings | `Production`, `Floor today`, `Products & sales`, `Data health` |
| Widget titles | `Production over time`, `Pipeline`, `Cycle time`, `Products`, `Top 10 products`, `Workload`, `Vessels`, `Task health`, `Fermentation`, `Source mix`, `Data health` |
| View toggle | `Chart` / `Table` (aria-label `View as`) |
| Empty states | G1/G2/G4/G9: `No batches match these filters.` + `Reset filters`; G3: `No completed batches in this period.`; G5: `No open tasks due in the next {14 or 30} days.`; G6 lists: `No vessels are shared right now.` / `Every active batch has a vessel.`; G7: `No open tasks are overdue.` / `No tasks were ticked off in this period.`; G8: `No Plato readings have been recorded yet.` / `Every active beer and cider batch has a reading.` / `Fermentation curves cover beer and cider.`; G10: `No data issues found.` |
| Error states | Inherited: `Charts could not load. Reload the page to try again.`; `Failed to load dashboard: {message}. Reopen the Dashboard tab to try again.`; widget-level `Not available yet.` for missing server fields |
| Neutral list headings | `Shared vessels`, `No vessel`, `No readings yet`, `No invoice link`, `Missing completion date`, `Blank source`, `Stale active batches` |
| Banned words | "double-booked", "conflict", "unbilled", "due" or "overdue" for readings, "on-time rate", "completions by staff", "error" on neutral lists |
| Notes | `Staff batches hidden` / `Including staff batches`; `Ignores the filters above`; `Tick times can lag the work, so this is not an on-time rate.`; `More than one active batch is using the same vessel. This is allowed.`; `No invoice link means no Zoho sales order is stored on the batch. It does not mean the batch is unbilled.`; `litres estimated from standard batch sizes` |
| Destructive confirmation | None. No destructive actions or writes in this phase (lists navigate to the existing batch detail; no new write path) |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable (no shadcn) |
| third-party | none | not applicable |
| npm vendor file | Chart.js 4.5.1 (already vendored in Phase 95; no change) | Version and SHA-256 recorded in Phase 95. No new libraries, plugins or CSP domains in Phase 96 |

---

## Implementation Notes for Planner

- Reuse: `chart()` (js/brewpad.js:1415), `openDashDrill` / `dashDrillLabel`, `wineBreakdownBuckets` / `mergeWineSkuLookup` as the base for G4, `buildDashV2Model` / `renderDashboardV2` for the section shell, `.bp-seg`, `.bp-select`, `.bp-empty`, `.bp-drill-banner`, `.bp-stat-card--link`. The Phase 95 `.bp-widget` markup needs the new `.bp-widget-head` / controls structure; migrate the KPI-adjacent re-hosted widgets to it (G1 replaces "Batches per period", G4 replaces "Wine breakdown").
- The header/table/list/accordion building blocks (`widgetShell`, `viewToggle`, `dataTable`, `listRows`) should be shared pure helpers so each of G1–G10 is small; table models come from the same builder as the chart (one model, two renderers) so numbers cannot diverge.
- Server data (Claude's Discretion in CONTEXT): the UI assumes task titles and flags for open and completed tasks, all readings for active beer/cider batches, vessels (`type`, `capacity_liters`, `archived`) and `batches.vessel_id`. Absent fields must degrade to `Not available yet.` per widget (stale 60 s cache pitfall from Phase 95 review).
- Tests (jsdom, one file per widget family): table and chart models identical; banner labels exactly as the table above; singular/plural; no zero placeholder before data; shared vessel counted once; archived vessels excluded; no-vessel row opens the batch detail (no banner); G7 has no on-time rate or staff text anywhere; G8 expected line omitted when OG or target FG is missing; G10 never says "unbilled"; banned-word guard test over all new copy; 7-day bin edges and 95th percentile cap in G3; Monday–Sunday buckets and Vancouver calendar days for overdue ageing; type totals agree across widgets for the same filters (Phase 94 D-20).
- Open (non-blocking): confirm the five G2 stage labels against actual stored statuses; confirm cat-1..5 distinguishability on the iPad; confirm the G8 20-line cap is enough once beer volume grows.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
