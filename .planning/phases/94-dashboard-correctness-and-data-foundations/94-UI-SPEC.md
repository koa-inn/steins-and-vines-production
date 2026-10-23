---
phase: 94
slug: dashboard-correctness-and-data-foundations
status: approved
reviewed_at: 2026-10-23
shadcn_initialized: false
preset: none
created: 2026-10-23
---

# Phase 94 — UI Design Contract

> Scope: four small surfaces inside the EXISTING BrewPad app (brewpad.html, js/brewpad.js ES5, css/brewpad.css). No new design system, component library, chart library or CSS framework. Every value below reuses an existing BrewPad token or class. Primary device: iPad Safari (PWA, touch). Edit sources only; never `js/brewpad.min.js` / `css/brewpad.min.css` (run `npm run build`).

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (shadcn gate not applicable: static HTML, vanilla ES5, no React/components.json) |
| Preset | not applicable |
| Component library | none (hand-rolled `bp-*` classes in css/brewpad.css) |
| Icon library | none (text glyphs only, e.g. `←`, `—`) |
| Font | `--font-body` Lato / Helvetica Neue / Arial (css/brewpad.css:14); `--font-display` Georgia not used in this phase |

Tokens live in `:root` at css/brewpad.css:13-66. Do not add tokens. Surfaces: `--cellar-canvas`, `--cellar-surface`, `--cellar-raised`; ink: `--ink-primary/secondary/tertiary/muted`; brand: `--stain`, `--barrel`.

---

## Spacing Scale

Existing BrewPad values are reused as-is; new rules written this phase use only multiples of 4.

| Token | Value | Usage in this phase |
|-------|-------|---------------------|
| xs | 4px | Gap between type-row items; label margin-top (existing `.bp-stat-label` uses 2px, leave) |
| sm | 8px | Stat grid gap (`.bp-stat-grid`, css:1493); filter chip gap-ish |
| md | 16px | Stat grid bottom margin; detail section spacing |
| lg | 24px | Not used |
| xl-3xl | 32/48/64px | Not used |

Exceptions: touch targets are `min-height: 44px` (existing convention, e.g. css:562, 2248) for the type select and the "Needs a type" chip. Existing stat-card padding `10px 14px` (css:1494) and detail-info padding `12px` are legacy and untouched.

---

## Typography

Reuse existing sizes; the new tile adds no new size or weight.

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Body / info rows | 0.875rem (14px) | 400 | 1.4 (existing) |
| Label (`.bp-stat-label`, per-type row, footnote) | 0.75rem (12px) | 400 (label) / 700 (type name only) | 1.4 |
| Heading (`.bp-detail-section-title`) | 0.75rem (12px) | 700 | existing |
| Display (`.bp-stat-num`, css:1495) | 1.7rem (~27px) | 700 | 1.1 |

Weights in use: 400 and 700 only (matches BrewPad). Form controls: 16px (prevents iOS zoom-on-focus, css:2255 note).

---

## Color

BrewPad is a warm light theme; no new colors.

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `--cellar-canvas` #e8e2ca | Page background |
| Secondary (30%) | `--cellar-raised` #faf8f2 / `--cellar-surface` #f5f1e6 | Stat cards, detail info panel |
| Accent (10%) | `--stain` #370e13 | See reserved list |
| Destructive | `--batch-danger` #a83232 | Not used in this phase (no destructive actions) |

Accent reserved for: (1) the big numbers in the stat tiles (existing `.bp-stat-num` color `--stain`, css:1495). This applies to all four tiles: Fermenting now, Started this year and Completed this year keep their existing accent number colour unchanged, and the executor must not strip it; (2) the active state of the "Needs a type" filter chip (existing `.bp-filter-btn--active`, css:566). Nothing else.

Supporting colors: secondary text `--ink-secondary` (mean, "based on N", per-type row); warning state for "excluded" count and "Needs a type" count badge: `--batch-warning` #b87a1a on `--batch-warning-bg` (existing tokens, used only when count > 0). Manual-type marker uses `--ink-tertiary` text, no color accent.

---

## Surfaces

### 1. Cycle-time KPI tile (D-10, D-11, D-13) — live on current dashboard, no `?dash=v2`

Replaces the 4th `.bp-stat-card` ("Avg days to complete") in the existing `.bp-stat-grid` built at js/brewpad.js:4030-4034. Grid stays 2 columns (css:1493); the tile spans the full row (`grid-column: 1 / -1`) so the type row and footnote fit on iPad portrait without wrapping. Add one modifier class `bp-stat-card--wide`; no other new card styling.

Structure inside the tile (all existing classes where possible):
- Label (`.bp-stat-label`, placed first for this tile): `Days to complete (median)`.
- Row 1, flex, baseline-aligned, gap 16px: big `.bp-stat-num` = median days (integer, no unit suffix on the number); beside it `.bp-stat-label` text `mean {N}d`.
- Row 2 `.bp-stat-label`: `Based on {N} batches, {M} excluded (no completion date)`. If M = 0 omit the "excluded" clause: `Based on {N} batches`. When M > 0 the M phrase uses `--batch-warning` color.
- Row 3 `.bp-stat-label`, flex-wrap, gap 4px 8px: one item per type with at least one completed batch, order wine, beer, cider, seltzer, other: `Wine 63d` (type name weight 700, number 400), separated by ` · `. Types with zero completed batches are omitted entirely (D-11). Row omitted if no type has data.

Other three tiles (Fermenting now, Started this year, Completed this year) keep layout; only their numbers change source (see Surface 4). The three stay 2-up above the wide tile (order: Fermenting now, Started this year, Completed this year, then the wide cycle-time tile). Rationale: odd tile count in a 2-column grid; wide tile avoids an orphan.

Median = middle value (mean of two middles for even N), rounded to whole days; mean rounded to whole days.

States:
| State | Presentation |
|-------|--------------|
| Loading | Dashboard-level loading already shown by existing dashboard load; tile not rendered until aggregate returns. Do not show a zero. |
| No completed batches with `completed_at` | Big number `—`, line 2: `No completed batches with a completion date yet`; rows 1(mean) and 3 omitted |
| Error | Whole-dashboard failure keeps existing `.bp-empty` pattern (js/brewpad.js:3958-3960); copy below |
| Stale cache | None visible; aggregate cached ~60 s server side (D-21), no staleness UI |

Accessibility: tile is a `div role="group" aria-label="Days to complete"`; type row is plain text, not interactive.

### 2. Batch type edit control (D-04, D-06, D-08)

Location: batch detail pane info grid, js/brewpad.js:6290-6299 (`.bp-detail-info`). Add a row immediately after the "Product" row (js/brewpad.js:6289, inside `renderBatchDetail`, starts js/brewpad.js:6250; the similar row at js/brewpad.js:4956 is a different view and is not touched) using the existing `.bp-detail-info-row` / `.bp-detail-info-label` markup (css:743-757):

- Label: `Type`
- Control: native `<select class="bp-select" id="bp-detail-type" aria-label="Batch type">` (css:2245-2282, 44px min height, 16px font, iPad-safe native picker). Options in order: Wine, Beer, Cider, Seltzer, Other (values `wine|beer|cider|seltzer|other`; `KNOWN_BATCH_TYPES` js/brewpad.js:299).
- Beneath/beside the select, small `.bp-stat-label`-style hint (0.75rem, `--ink-tertiary`) showing provenance: `Set automatically (recipe)` / `(Zoho product)` / `(schedule)` / `(product name)` / `Not recognised, please choose` for `other` from rule 5 / `Set by hand` for `manual` / `Not yet classified` when `batch_type_source` is NULL and the client fallback resolves to `other`. When `batch_type` is NULL and `resolveBatchType` (js/brewpad.js:299-357) resolves a real type, show the select with that type and `Set automatically (schedule)`.
- Effective type (RESEARCH Pitfall 6) = stored `batch_type`, else `resolveBatchType` fallback when NULL. Every widget, the select value and the chip use effective type.
- Interaction: change saves immediately on `change` (no Save button), disabled with `.bp-select:disabled` (css:2282) while the request is in flight, then success toast via `showToast('Type updated', 'success')` (js/brewpad.js:1317). On failure: revert the select to previous value and `showToast('Could not update type. Try again.', 'error')`. Saving writes `batch_type_source = 'manual'` and the hint switches to `Set by hand`.
- Choosing `Other` by hand is allowed and recorded as manual (removes the batch from "Needs a type").
- No confirmation dialog: change is reversible by choosing again.
- Deleted/disabled batches: no dedicated read-only flag exists in BrewPad. The executor derives it from `statusKey` (`b.status` lowercased, js/brewpad.js:6260) being `deleted` or `disabled` (same test as js/brewpad.js:229) and renders plain text instead of a select.

### 3. "Needs a type" filter (D-07) — minimal

Reuse the Batches status chip row (js/brewpad.js:4655-4684) and mirror the Phase 90 "Unlinked" chip exactly (js/brewpad.js:4666, 4681-4684; `filterBatchesByUnlinked` pattern):
- New chip appended after `Unlinked`: `{ val: 'needsType', label: 'Needs a type' }`, label rendered `Needs a type ({count})`, count always shown including `(0)`, same as Unlinked.
- Class `.bp-filter-btn` / `--active` (css:552-570), 44px height. No orange badge (count already in the label).
- Population: batches whose effective type is `other` AND `batch_type_source != 'manual'` (NULL source counts as not manual). Filtering reuses the batch list rows; no new list component.
- Active-filter empty state uses `.bp-empty` (css:382): `Every batch has a type.`
- Full data-health card is Phase 96; do not build it.

### 4. Corrected totals and copy (D-17..D-20) — no visual redesign

All widgets read from the single `getDashboardData` layer, so only numbers and labels change:
- `Started this year` and `Completed this year`: labels unchanged; add `title`/aria-label `Calendar year to date ({year}), Vancouver time` only. Because `title` does not show on iPad touch, also add one visible caption directly under the three-tile group (above the wide cycle-time tile, which stays last in the grid), existing `.bp-stat-label` 12px muted text (`--ink-secondary`): `This year = Jan 1 to today`.
- `Fermenting now` counts primary + secondary only (D-17); pending keeps its existing chip badge count.
- Type totals in any widget (month chart, wine breakdown, type counts) must equal across widgets; if a widget intentionally covers a subset, its heading must say so (e.g. `Started batches only`).
- Any chart/month labels remain as today; bucketing changes source field only (start_date for started, completed_at for completed).

---

## Aggregate-call States (S1, D-21)

Single aggregate fetch replaces per-batch `get_batch` N+1 inside `loadDashboard` (js/brewpad.js:3939-3962).

| State | Behaviour |
|-------|-----------|
| Loading | Reuse the existing dashboard loading state. The first paint must not show `0` or `—` placeholders as if they were data |
| Success | Render dashboard; no per-widget spinners (previous progressive N+1 fill-in disappears) |
| Error | Existing pattern: `<p class="bp-empty">` in `#bp-dashboard-inner` (js/brewpad.js:3958-3960) |
| Partial/degraded | No partial rendering; all-or-nothing so totals can never disagree |

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Primary CTA | None added this phase (existing `+ New Batch` FAB unchanged) |
| Tile label | `Days to complete (median)` |
| Tile mean | `mean {N}d` |
| Year caption | `This year = Jan 1 to today` |
| Tile basis | `Based on {N} batches, {M} excluded (no completion date)` |
| Tile empty | `—` plus `No completed batches with a completion date yet` |
| Type row | `Wine 63d · Beer 24d · Cider 30d` (types with no data hidden) |
| Type field label | `Type` |
| Type hints | `Set automatically (recipe)` / `(Zoho product)` / `(schedule)` / `(product name)` / `Not recognised, please choose` / `Set by hand` / `Not yet classified` |
| Type save success | `Type updated` |
| Type save error | `Could not update type. Try again.` |
| Filter chip | `Needs a type ({count})` |
| Filter empty state | `Every batch has a type.` |
| Dashboard error | `Failed to load dashboard: {message}. Reopen the Dashboard tab to try again.` (extends existing `Failed to load dashboard: ` string at js/brewpad.js:3960) |
| Destructive confirmation | none; no destructive actions in this phase (type edit is reversible; backfills are CLI-only with `--dry-run`, not UI) |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable (no shadcn) |
| third-party | none | not applicable |

---

## Implementation Notes for Planner

- Pattern citations: stat tiles css:1493-1496 + js:4030-4034; filter chip js:4655-4684 + css:552-570; info row js:6290-6299 + css:735-757; select css:2245-2282; toast js:1317; empty state css:382; dashboard error js:3958-3960.
- Tests (`tests/frontend/`, `_setStateForTest`): median/mean math, hidden zero-data types, `M excluded` omission at 0, empty-state tile, select options/value mapping, `needsType` chip count including 0.
- Assumptions recorded (not blocking): tile spans full width; "Needs a type" placed as a chip rather than a separate list; save-on-change with no confirm; manual hint text wording is a default, adjustable at checker review.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
