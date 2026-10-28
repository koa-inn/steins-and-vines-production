---
phase: 95
slug: global-filters-and-chart-engine
status: approved
reviewed_at: 2026-10-27
shadcn_initialized: false
preset: none
created: 2026-10-27
---

# Phase 95 — UI Design Contract

> Scope: the BrewPad v2 dashboard behind `?dash=v2` (brewpad.html, js/brewpad.js ES5, css/brewpad.css). Sticky global filter bar, shared Chart.js `chart()` helper, click-through to Batches with a banner, trend deltas on KPI tiles, and a staff checkbox in the batch detail pane. No new design system. Primary device: shop iPad Safari (PWA, touch). Edit sources only, never `js/brewpad.min.js` / `css/brewpad.min.css` (run `npm run build`). v1 dashboard is frozen (CONTEXT D-03).

Sources: decisions D-01..D-15 from 95-CONTEXT.md are locked. Visual tokens reuse 94-UI-SPEC.md. Items marked (default) are researcher choices inside "Claude's Discretion".

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (static HTML, vanilla ES5; no React, no components.json) |
| Preset | not applicable |
| Component library | none (hand-rolled `bp-*` classes in css/brewpad.css) |
| Icon library | none (text glyphs only: `▲ ▼ ✕ ←`) |
| Chart library | Chart.js 4, exact pinned version, self-hosted at `js/vendor/chart.umd.min.js` (D-12) |
| Font | `--font-body` Lato / Helvetica Neue / Arial (css:14). Chart.js `defaults.font.family` set to the same stack |

Tokens live in `:root` at css/brewpad.css:13-66. Do not add tokens except the three chart series colours below. Surfaces: `--cellar-canvas`, `--cellar-surface`, `--cellar-raised`; ink: `--ink-primary/secondary/tertiary/muted`; brand: `--stain`, `--barrel`; control: `--ctrl-bg`, `--ctrl-border`.

Chart.js loading (D-12): inject a `<script src="js/vendor/chart.umd.min.js">` dynamically, only when v2 opens. Same-origin, so no CSP change. Verified: brewpad.html has no CSP meta tag and existing vendor scripts (qrcode, jspdf) load the same way. Public pages are untouched. Do not load from a CDN.

---

## Spacing Scale

New rules use multiples of 4 only.

| Token | Value | Usage in this phase |
|-------|-------|---------------------|
| xs | 4px | Gap inside a segmented control; delta glyph gap; banner glyph gap |
| sm | 8px | Gap between filter controls; stat grid gap; chart legend item gap |
| md | 16px | Filter bar padding; widget card padding; gap between widgets |
| lg | 24px | Gap between dashboard sections |
| xl | 32px | Not used |
| 2xl-3xl | 48/64px | Not used |

Exceptions: all touch targets `min-height: 44px` (existing convention). Filter bar sticks at `top: var(--bp-shell-height)` (56px). Phone bottom sheet max-height 85vh. Existing legacy stat-card padding `10px 14px` is untouched.

---

## Typography

Reuses 94-UI-SPEC sizes; no new size or weight.

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Body (banner text, filter option text, tooltip body) | 0.875rem (14px) | 400 | 1.4 |
| Label (filter group labels, delta text, axis ticks, legend, banner count) | 0.75rem (12px) | 400 (700 for filter group labels and active segment) | 1.4 |
| Heading (widget title, sheet title) | 1rem (16px) | 700 | 1.2 |
| Display (`.bp-stat-num`) | 1.7rem (~27px) | 700 | 1.1 |

Weights: 400 and 700 only. Form controls (date inputs, selects) 16px to prevent iOS zoom-on-focus. Chart axis ticks 12px; never smaller.

---

## Color

Warm light theme; no change to page colours.

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `--cellar-canvas` #e8e2ca | Page background |
| Secondary (30%) | `--cellar-raised` #faf8f2 / `--cellar-surface` #f5f1e6 | Filter bar, widget cards, stat tiles, sheet |
| Accent (10%) | `--stain` #370e13 | See reserved list |
| Destructive | `--batch-danger` #a83232 | Not used (no destructive actions) |

Accent reserved for: (1) `.bp-stat-num` big numbers (unchanged); (2) the selected segment/chip fill in the filter bar (`--stain` background, `--cellar-raised` text); (3) the "Filters" button count badge on phones. Nothing else. Banner, deltas and chart series do not use accent.

Chart series colours (D-13), the only new tokens, defined in `:root`:

| Token | Value | Series | Contrast on #faf8f2 |
|-------|-------|--------|---------------------|
| `--chart-wine` | #6e1a2c (burgundy) | Wine | ~11:1 |
| `--chart-cider` | #a8841a (gold) | Cider | ~3.3:1 (meets 3:1 graphics) |
| `--chart-beer` | #9a4e0c (deep amber) | Beer | ~5.7:1 |
| `--chart-other` | `--ink-tertiary` #9a8672 | Seltzer and other, under All | ~3:1 (default) |

Beer amber is deliberately darker and more orange than gold and differs from `--batch-warning` #b87a1a (do not reuse warning for series). Checker/executor must verify gold vs amber are distinguishable at 3:1 against each other adjacent in a stacked bar; if not, add a 2px `--cellar-raised` separator between stacked segments (default: always add it). Colour is never the only cue: legend and tooltips name the type, and Phase 99 adds table views.

Delta colours: neutral by default. Increase uses `--batch-success`, decrease uses `--batch-danger` ONLY for measures where up is good (started, completed). Cycle time delta: lower is good, so colours invert. Fermenting now: no colour (neutral `--ink-secondary`). Glyph and sign carry meaning too.

---

## Surfaces

Visual hierarchy: the KPI tile row (accent numbers + deltas) is the primary focal point; the sticky filter bar and the batches-per-period chart are secondary; remaining re-hosted widgets are tertiary.

### 1. Global filter bar (D-04, D-05, D-06)

Element: `<div id="bp-dash-filters" class="bp-dash-filters" role="group" aria-label="Dashboard filters">` at top of the v2 dashboard, `position: sticky; top: var(--bp-shell-height); z-index` below the shell header. Background `--cellar-raised`, bottom border 1px `--ledger-line`, padding 8px 16px.

Controls, in order (tablet and wider, single row that wraps to two on iPad portrait):

| Control | Form | Options | Default |
|---------|------|---------|---------|
| Type | Segmented control, single select | All, Wine, Beer, Cider | All |
| Period | Segmented control + "Custom" segment | 30d, 90d, 6m, 12m, YTD, All, Custom | YTD |
| Group by | Segmented control | Week, Month | Month |
| Measure | Segmented control | Batches, Litres | Batches |
| Source | Native `<select class="bp-select">` | All sources, Kiosk, Online, Manual, Zoho scan, Research, Internal, Unknown (values: kiosk, online, manual, zoho_scan, research, internal, null/empty) | All sources |
| Staff | Checkbox-style toggle button, `aria-pressed` | "Include staff batches" | off |

Segmented control: `.bp-seg` container with `.bp-seg-btn` buttons, `min-height: 44px`, 14px text, border 1px `--ctrl-border`, `--r-md` radius, gap 0 between segments; selected = accent fill (see Color). Implemented as `role="radiogroup"` with `role="radio"` buttons and `aria-checked`. Keyboard: arrow keys move, Space/Enter select.

Each control has a 12px/700 `--ink-secondary` label above it (Type, Period, Group by, Measure, Source). Staff toggle has its own text as label.

Custom range: choosing "Custom" opens an inline row beneath the bar (not a popover; iPad-safe) with two native `<input type="date">` labelled "From" and "To", 16px, 44px high, and an "Apply Date Range" button (`.bp-btn`). Native pickers give the iPad wheel UI. Validation: From must be on or before To; max To is today (Vancouver). Invalid shows inline error `From must be on or before To.` in `--batch-danger` 12px and Apply Date Range stays disabled. Chart updates only on Apply Date Range. The Custom segment label shows the range once applied: `Jun 1 – Jul 15`. Weeks are Monday–Sunday; dates are Vancouver calendar dates.

Active-filter summary: when any filter differs from default, a "Reset" text button (`.bp-link-btn`, 44px) appears at the end of the bar: `Reset filters`. Reset restores D-05 defaults.

Phone (width <= 600px, collapses per D-04): bar shows a single row: `Filters` button (44px, with count badge of non-default filters) plus a one-line summary text (12px, truncated with ellipsis, e.g. `YTD · Month · Batches · All`). Tapping `Filters` opens a bottom sheet: `role="dialog" aria-modal="true" aria-labelledby`, backdrop `rgba(44,34,24,0.4)`, sheet `--cellar-raised`, radius `--r-lg` top corners, padding 16px, controls stacked full width with 16px gap, sticky footer with `Apply Filters` (primary) and `Reset`. Close by Apply Filters, backdrop tap, or `✕` (44x44). Focus moves into the sheet on open and back to `Filters` on close; Esc closes. Phone applies on `Apply Filters`; tablet applies immediately on each tap.

State persistence (D-06): hash format `#dash=v2&type=wine&period=ytd&group=month&measure=batches&source=kiosk&staff=0&from=&to=`; only non-default keys written. Hash wins over localStorage on load. Every filter change calls `history.replaceState` (not pushState, so Back does not step through filter taps).

v2 opt-in switch (D-02): v2 header shows a small text button `Back to classic dashboard` (`.bp-link-btn`, 44px, `--ink-secondary`) at the top right of the dashboard; v1 shows `Try new dashboard` at the same spot. Both write the localStorage flag and re-render. The shop iPad opts in once.

Staff behaviour (D-10): toggle off hides staff batches in mix views only. A 12px `--ink-secondary` note under the wine breakdown heading says `Staff batches hidden` when off and `Including staff batches` when on. Production views (tiles, month chart) always include them and show no note.

### 2. Chart engine `chart()` helper (D-12, D-13)

Contract for every widget, so each is about 20 lines:

- Call: `chart(canvasEl, { type: 'bar'|'doughnut'|'line', labels, series: [{ key, label, data, colour }], stacked, onClick })`. Returns the Chart instance; the helper destroys the previous instance on the same canvas before drawing (no leaks on filter change).
- Canvas lives in a `.bp-chart` wrapper, `position: relative`, fixed height 240px on tablet and 200px on phone, `maintainAspectRatio: false`, `responsive: true`.
- Widget card: `.bp-widget`, background `--cellar-raised`, border 1px `--ledger-line`, radius `--r-lg`, padding 16px, 16px gap between cards. Title is the Heading role. One-line subtitle 12px `--ink-secondary` states the active measure and period, e.g. `Started batches · YTD · by month`.
- Defaults: no chart title, no animation longer than 200ms (disabled when `prefers-reduced-motion`), gridlines `--ledger-soft`, axis line `--ledger-line`, ticks 12px `--ink-secondary`, bars `borderRadius: 3` and `borderSkipped`, stacked segments separated by a 2px `--cellar-raised` border. Y axis starts at 0 and has integer ticks for batches, thousands separators for litres.
- Legend: custom HTML legend below the chart (not canvas legend), 12px, swatch 12x12 plus label, wraps, each item a button (44px high) only when click toggles series; otherwise static. Series order is always wine, cider, beer, other.
- Tooltip: Chart.js tooltip, background `--ink-primary`, text `--cellar-raised`, 12px, padding 8px, radius `--r-md`. Format: title = bucket label (`Jun 2026` or `Week of Jun 1`), then one line per series `Wine: 33 batches` or `Wine: 759 L`, total line `Total: {N}` when stacked. `intersect: false, mode: 'index'` for bars so a finger tap anywhere in the column works.
- Click target: bars at least 44px wide; where a bucket is narrower (week grouping on phone), the click hit zone is the full column via `mode: 'index'`. Cursor `pointer` on clickable elements. Doughnut segments click the same way.
- Accessibility: canvas has `role="img"` and `aria-label` summarising the chart (`Started batches by month, year to date. Wine 33, Beer 12 ...`). Full data tables come in Phase 99; do not build them here.
- Fonts and colours are read once from CSS custom properties via `getComputedStyle`, not hard-coded in widget code.

States (applies to every widget):

| State | Presentation |
|-------|--------------|
| Loading | Whole dashboard waits for the aggregate (Phase 94 all-or-nothing). Widgets render only once data is present; no zero placeholders. Chart.js script not yet loaded: show `.bp-empty` `Loading charts…` in the widget slot |
| Filtered to zero | Replace the canvas with `.bp-empty`: `No batches match these filters.` and a `Reset filters` link button |
| Chart.js failed to load | `.bp-empty`: `Charts could not load. Reload the page to try again.` Tiles still render (they do not need Chart.js) |
| Data error | Existing pattern from Phase 94: `Failed to load dashboard: {message}. Reopen the Dashboard tab to try again.` |

### 3. Re-hosted widgets (this phase adds no new graphs)

| Widget | Chart type | Notes |
|--------|-----------|-------|
| KPI tiles: Fermenting now, Started, Completed, Days to complete (median) | none (tile) | Keep the Phase 94 tile layout and the wide cycle-time tile. Tiles are `button`s when clickable (see 4). Started/Completed labels follow the Period filter: `Started ({period label})`; replace "this year" copy with the period. `Fermenting now` ignores the Period filter and states `Right now` as caption |
| Batches per period | Stacked bar, one series per type, x = week/month buckets | Honours Measure (batches or litres) and Group by |
| Wine breakdown | Horizontal bar, wine sub-types (existing breakdown categories) | Hides staff batches by default (D-10); carries the staff note |

Litres measure (D-11): litres are computed on the data layer, not in the chart. Tooltip and axis label show `L`. When a litres figure is estimated from the default (no `target_volume_l`), the widget subtitle appends `litres estimated from standard batch sizes`. Seltzer and other litres default is an open question for the planner (CONTEXT D-11); the UI shows them under the estimate note and does not invent a size.

### 4. Click-through and banner (D-14)

- Clickable: every bar (a bar is one type within one bucket, when stacked), every doughnut/breakdown segment, and every KPI tile. Tiles use `<button class="bp-stat-card bp-stat-card--link">` with a visible 1px `--ledger-emphasis` border change and a `›` glyph top right at 12px `--ink-tertiary`. Focus ring: 2px `--ledger-focus`.
- Tap switches to the Batches tab and shows the exact set. The count always equals the number on the clicked bar/tile because both come from the same data layer set.
- Banner: `<div class="bp-drill-banner" role="status">` at the top of the Batches list, above the status chips. Background `--batch-info-bg`, 1px left border `--batch-info`, padding 8px 16px, text 14px: `From dashboard: Wine started in Jun 2026 · 33 batches` plus a dismiss button `✕` (44x44, `aria-label="Clear dashboard filter"`). Banner text pattern: `From dashboard: {Type} {measure verb} in {bucket} · {N} batches` where verb is `started`, `completed` or `fermenting`; a tile click omits bucket and uses the period, e.g. `From dashboard: Completed YTD · 71 batches`. Singular: `1 batch`.
- Clearing (✕) removes the banner and the forced set; the Batches tab returns to the normal list and status chips. Switching tab back to Dashboard does not clear it; reaching the Batches tab by the tab bar after a clear shows the normal list.
- While a drill-down is active, the status chips apply on top of the set (they narrow it); the banner count shows the dashboard set size and the list heading shows the visible count.
- Empty (set cannot match, e.g. rows changed after refresh): `.bp-empty` `No batches in this set any more.` with the banner still dismissible.

### 5. Trend deltas (D-15)

- Layout inside a tile: under the big number, one line, 12px: `▲ 12 vs prev 90d`. Absolute change is the primary form for count tiles (default); percentage is added in brackets only when the previous value is 5 or more and the change is 10% or more: `▲ 12 (+25%) vs prev 90d`. Cycle time uses days: `▼ 3d vs prev 90d`.
- Comparison label by period: 30d, 90d, 6m, 12m use `vs prev {period}`; YTD uses `vs same period last year`; custom uses `vs prior {N} days`. Period `All` shows no delta line at all (not even a placeholder).
- Zero change: `– no change vs prev 90d` in `--ink-secondary`. Previous value is zero and current is non-zero: `▲ 12 vs prev 90d` with no percentage. Both zero: `– no change`.
- Insufficient prior data (previous window starts before the first batch date): `No earlier data to compare`.
- Fermenting now has no delta (point-in-time).
- Glyph colours as in Color. Delta line has `aria-label` e.g. `Up 12 compared with previous 90 days`.

### 6. Staff / family / R&D flag control (D-08)

Batch detail pane (`renderBatchDetail`), a new `.bp-detail-info-row` directly after the Type row:

- Label `Staff batch`.
- Control: native checkbox in a 44x44 hit area (`<input type="checkbox" id="bp-detail-staff">`) plus text `Staff, family or R&D (hidden from mix charts)` in 14px.
- Provenance hint, 12px `--ink-tertiary`: `Set automatically (internal batch)` / `Set automatically (research batch)` / `Set by hand` / omitted when unset by default.
- Save on change (same pattern as the Type select): disabled while in flight, toast `Staff flag updated` on success; on failure revert and toast `Could not update staff flag. Try again.` No confirmation (reversible).
- Hidden/read-only for deleted or disabled batches (render plain text `Yes`/`No`), same rule as Type.
- Not shown on the v1 dashboard (frozen) but the detail pane is shared, so it appears in both. That is acceptable.

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Primary CTA | `Apply Date Range` (custom range row), `Apply Filters` (phone sheet). The only primary action introduced |
| Opt-in / opt-out | `Try new dashboard` / `Back to classic dashboard` |
| Filter labels | `Type`, `Period`, `Group by`, `Measure`, `Source` |
| Period options | `30d`, `90d`, `6m`, `12m`, `YTD`, `All`, `Custom` |
| Source options | `All sources`, `kiosk`, `online`, `manual`, `zoho_scan`, `research`, `internal`, `Unknown` (display as Title-case words in UI: Kiosk, Online, Manual, Zoho scan, Research, Internal, Unknown) |
| Staff toggle | `Include staff batches` |
| Reset | `Reset filters` |
| Phone entry | `Filters` (+ count badge) |
| Custom range errors | `From must be on or before To.` |
| Empty state heading | `No batches match these filters.` |
| Empty state body | Link: `Reset filters` |
| Click-through banner | `From dashboard: {Type} {started/completed/fermenting} in {bucket} · {N} batches` with dismiss `✕` (aria-label `Clear dashboard filter`) |
| Banner empty | `No batches in this set any more.` |
| Delta | `▲ {N} vs prev {period}` / `▼ {N} vs prev {period}` / `– no change vs prev {period}` / `No earlier data to compare` |
| Staff note | `Staff batches hidden` / `Including staff batches` |
| Litres estimate note | `litres estimated from standard batch sizes` |
| Staff flag label | `Staff batch` |
| Staff flag success / error | `Staff flag updated` / `Could not update staff flag. Try again.` |
| Chart load error | `Charts could not load. Reload the page to try again.` |
| Dashboard error | `Failed to load dashboard: {message}. Reopen the Dashboard tab to try again.` |
| Destructive confirmation | None. No destructive actions in this phase (filters, drill-down and the staff flag are reversible; the backfill is CLI-only with `--dry-run`) |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable (no shadcn) |
| third-party | none | not applicable |
| npm vendor file | Chart.js 4 (self-hosted, pinned exact version) | Download from the official release, record version and SHA-256 in `js/vendor/` README or commit message, scan for no unexpected network calls. Plan must include a verification step that the version + SHA-256 are actually recorded. Checked 2026-10-27: no CSP change needed (no CSP tag in brewpad.html) |

---

## Implementation Notes for Planner

- Pattern citations: segmented chips follow `.bp-filter-btn` (css:552-570); select `.bp-select` (css:2245-2282); toast `showToast` (js/brewpad.js:1317); empty state `.bp-empty` (css:382); stat tiles css:1493-1496; detail info row css:735-757; vendor loading pattern `js/vendor/`.
- iPad Safari: sticky inside a scrolling container needs checking against the PWA shell; confirm with the phone-width iframe harness (memory: Chrome won't shrink below ~600px) and an iPad UAT. Hash writes must use `replaceState`.
- Tests (`tests/frontend/`, jsdom): hash parse/serialise round trip and hash-over-localStorage precedence; defaults; delta text per period type (30d, YTD, custom, All hides); zero/both-zero/insufficient-data deltas; banner text and singular; banner count equals drill set; `chart()` destroys the previous instance; staff toggle excludes staff only from mix widgets; Unknown source matches null/empty source.
- Open questions (not blocking): seltzer/other litres default (CONTEXT D-11); gold-vs-amber distinguishability to confirm visually on the iPad; percentage threshold on deltas is a researcher default (5 prior, 10 percent).

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS
- [x] Dimension 2 Visuals: PASS
- [x] Dimension 3 Color: PASS
- [x] Dimension 4 Typography: PASS
- [x] Dimension 5 Spacing: PASS
- [x] Dimension 6 Registry Safety: PASS

**Approval:** approved 2026-10-27 (FLAGs on Copywriting, Visuals, Registry Safety addressed inline)
