# Phase 95: Global filters and chart engine - Context

**Gathered:** 2026-10-28
**Status:** Ready for planning

<domain>
## Phase Boundary

The BrewPad **v2 dashboard**, behind `?dash=v2`, is driven by one sticky **global filter bar** (D2). Every
widget is drawn through one shared **Chart.js `chart()` helper** (D3). Every bar, segment and KPI tile
**clicks through** to the Batches tab, filtered to exactly those batches (D4). KPI tiles show **trend deltas**
against the previous equivalent period (D5).

The phase also adds an explicit **staff / family / R&D flag** on batches, because the staff toggle needs it.
That includes a one-time, owner-reviewed candidate backfill.

**Not in this phase:** the new graphs G1–G10 (Phase 96), beer and cider sections (Phase 97), alerts (Phase 98), and
the responsive/performance pass, chart table views and making v2 the default (Phase 99). This phase re-hosts
today's widgets (tiles, month chart, wine breakdown) on the new engine and filters. It does not add new graphs.

</domain>

<decisions>
## Implementation Decisions

### Approval
- **D-01:** The owner approved handoff items **D2, D3, D4 and D5** on 2026-10-28. Tick them in §7 of
  `.planning/research/brewpad-dashboard-v2.md`. Every other unticked §7 item stays out of scope.

### Release
- **D-02:** The redesign ships **behind `?dash=v2`**. The current dashboard stays the default.
  Opening `brewpad.html?dash=v2` turns v2 on, and the choice is **remembered per device** (localStorage, with a way to
  switch back), so the shop iPad opts in once. v2 becomes the default in Phase 99 or at owner sign-off.
- **D-03:** The current (v1) dashboard is **frozen**: bug fixes only. New work goes into v2, and v1 doesn't need to
  stay in step.

### Filters (D2)
- **D-04:** The filter bar is sticky on scroll and collapses to a sheet on phones. Its controls:
  - Type: All · Wine · Beer · Cider. Seltzer and other count under All, per Phase 94 D-04.
  - Period: 30d · 90d · 6m · 12m · YTD · All · custom range.
  - Group by: week · month.
  - Measure: batches · litres.
  - Source: kiosk · online · manual · zoho_scan · research · internal · **Unknown**.
  - A **staff toggle**.
- **D-05:** **Defaults** when v2 opens: **YTD, grouped by month, measure batches, type All**. Weeks run
  **Monday–Sunday**, as in the Phase 93 kiosk ledger. All dates are calendar dates in America/Vancouver, per Phase 94 D-19.
- **D-06:** Filter state is kept in the **URL hash**, so a copied URL reproduces the view, and in **localStorage**,
  so it's remembered on that device. The hash wins when both are present.
- **D-07:** Batches with no recorded `source` (82 of 215 on 2026-10-27) appear under an **"Unknown"** source option.
  "All" includes them. **No source backfill.**

### Staff / family / R&D batches
- **D-08:** Add an **explicit flag** to a batch, e.g. a boolean `staff_batch`, editable in BrewPad. It's set
  automatically for `source` = `internal` or `research` on create. Don't detect staff batches by customer name going forward.
- **D-09:** A one-time **candidate backfill** follows the B2/B3 pattern: a `--dry-run` CLI lists every proposed
  batch, the owner reviews the full list in-session, then `--apply --expect=N`. The candidates are every
  `internal`/`research` batch plus customers **McLachlan** and **Inn**. On production, run it after
  replay + verify, per the Phase 94 runbook.
- **D-10:** Staff batches are hidden by default **only in mix views**: the wine breakdown now, and the source mix
  and leaderboard later. Production views (fermenting, started, completed, cycle time, month chart, and later capacity)
  **always include** them, consistent with Phase 94 D-12. The toggle adds them to mix views.

### Measure
- **D-11:** Litres per batch default to 23 L for wine and cider. Beer is **28 L for started and in-progress counts** and
  **25 L for completed counts**. `target_volume_l` overrides when set, though it's empty on every batch today.
  Seltzer and other use 23 L unless the planner finds a better default. Flag that as an open question, don't invent one.

### Chart engine (D3)
- **D-12:** Use **Chart.js 4** at a pinned exact version, **self-hosted** in `js/vendor/` like qrcode and jspdf.
  Load it **only when the v2 dashboard opens**. That means no new domain and no CSP change: brewpad.html has no CSP
  tag, and public pages are untouched (CLAUDE.md rule 12 still checked).
- **D-13:** Wrap it in a small `chart()` helper so each widget is about 20 lines. Brand colours: **wine = burgundy,
  cider = gold, beer = amber**, with beer amber deep enough to stay distinct from gold, contrast-checked.

### Click-through (D4)
- **D-14:** Clicking a bar, segment or tile opens the Batches tab showing **exactly that batch set**, with a
  **dismissible banner**, e.g. "From dashboard: Wine started in Jun 2026 · 33 batches ✕". Clearing it returns to
  the normal list and status chips. The set comes from the **same data layer** as the chart (Phase 94 D-20), so
  the count always matches the number clicked.

### Trend deltas (D5)
- **D-15:** Each delta compares with the **immediately preceding window of the same length**: 30d, 90d, 6m and 12m
  compare with the previous window, and a custom range with the window just before it. **YTD** compares with the same
  Jan 1–today stretch last year. **All shows no delta.** Display ▲/▼ with the change.

### Post-research decisions (owner, 2026-10-27, plan-phase session)
- **D-16:** The `kiosk_recipe` source value counts under the **Kiosk** source filter option. There is no separate option.
- **D-17:** Seltzer and other batches use **23 L** in the litres measure, labelled as an estimate. This resolves the D-11 open question.
- **D-18:** The one-time staff-flag backfill writes **directly to the Postgres-only column without bumping `last_updated`**,
  like the Phase 94 `TYPE_SET_SQL` path. It has **no replay step**. `batches-verify` must still report 0 mismatches.
- **D-19:** `staff_batch` is auto-set **only on create**. A later source edit to internal/research does not set it,
  and staff tick the box by hand.

### Carried forward (locked, do not re-ask)
- Every widget reads `getDashboardData(rows, asOf, filters)` and the stored `batch_type` (Phase 94 D-20).
- Totals count started batches only: primary, secondary and complete (D-17).
- Start-based buckets use `start_date` and completion buckets use `completed_at` (D-18).
- The dashboard loads from `get_dashboard_stats` through the admin-proxy seam, cached ~60 s (D-21).
- Postgres batch store only (D-01 of Phase 94).
- `update_batch` always nests fields in `updates:{}`.
- Classify by `cf_type` or SKU, never by product name.
- Production data writes need the owner's OK in-session after a `--dry-run`.

### Claude's Discretion
- **Visual layout:** filter-bar layout and phone sheet, chart styling, tooltip format, and how the custom-range picker
  looks. The UI design contract settles these (`/gsd-ui-phase 95` recommended before planning).
- **Staff flag details:** the exact column name and where staff edit it (detail pane next to Type is the natural spot).
- **Delta format:** absolute vs percentage. Whichever reads better per tile, recorded in the UI spec.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone and handoff
- `.planning/research/brewpad-dashboard-v2.md` §4 Phase B (D2–D5 spec), §5 constraints, §7 approval list
- `.planning/ROADMAP.md`: "v5.0 BrewPad Dashboard v2" rules and "Phase 95" success criteria

### Phase 94 foundations (data layer this phase builds on)
- `.planning/phases/94-dashboard-correctness-and-data-foundations/94-CONTEXT.md` D-04, D-12, D-17..D-21
- `.planning/phases/94-dashboard-correctness-and-data-foundations/94-UI-SPEC.md` (tile and colour conventions)
- `.planning/phases/94-dashboard-correctness-and-data-foundations/94-REVIEW.md` IN-01..IN-05. IN-03 (re-classify
  a name-sourced type on product rename) is still open and touches the same code.
- `docs/RUNBOOK.md` "Batch type and completion dates (Phase 94)": the backfill/replay/verify procedure the staff-flag
  backfill must follow

### Project rules
- `./CLAUDE.md` rules 1–13 (CSP rule 12; build artifacts; tests)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Data layer (`js/brewpad.js`):** `getDashboardData(rows, asOf, filters)` (:475), `dashboardWindow(key, asOf)` (:399),
  `effectiveBatchType` (:414) and `cycleDays` (:378). Extend these with the new filters (source, staff,
  group-by week, litres measure) rather than adding a parallel path.
- **Batch filters:** `filterBatchesByStatus`, `filterBatchesByUnlinked`, `filterBatchesByReadyToBottle` and
  `filterBatchesByNeedsType` (:203–:604), plus the status chips at `renderBatchList` (:5029). The drill-down
  set and banner plug in here.
- **Vendor pattern:** `js/vendor/` already serves qrcode, jspdf, fuse and sentry, loaded by script tag in brewpad.html.
- **Server aggregate:** `zoho-middleware/lib/batch-pg-read.js` dashboard SELECT (:76) returns lean rows. Add `source` (if
  missing) and the staff flag there. **Never** add customer names to the aggregate.

### Established Patterns
- **Postgres-only columns:** migration 0007 (additive, guard + allowlist). The staff flag would be 0008. Phase 94
  WR-02 keeps Postgres-only fields out of the sheet mirror (`lib/ops-mirror.js`) and out of the
  `batches-parity` comparisons. Follow the same opt-in read approach.
- **Backfills:** a dry-run-default CLI with `--apply --expect=N`, the trusted channel in `batch-pg-update.js`,
  replay + verify on production (`scripts/backfill/*`). Note the replay CLI's 30 s timeout and missing resume: about 14 s per
  batch in production. Fix that or budget for it before the staff-flag backfill.
- **Tests:** frontend Jest (jsdom), middleware Jest plus real-Postgres `test:db` (Testcontainers). Use Node 24 locally.

### Integration Points
- `renderDashboard` (:4332) is v1, which stays frozen. v2 needs its own render entry, selected by the `?dash=v2`/localStorage flag.
- The `brewpad.html` script order is where Chart.js loads, lazily, for v2 only.
- The batch detail pane Type row (Phase 94-08) is a natural place for the staff checkbox.

</code_context>

<specifics>
## Specific Ideas

- Banner copy example: "From dashboard: Wine started in Jun 2026 · 33 batches ✕".
- The shop iPad is the main device. Opting into v2 must survive reloads on that device.

</specifics>

<deferred>
## Deferred Ideas

- **Source backfill:** inferring the 82 blank sources from invoice evidence. Declined for now; "Unknown" is shown instead.
- **New graphs (G1–G10):** Phase 96. **Beer/cider sections:** Phase 97. **Alerts:** Phase 98. **Table views,
  performance, v2 as default:** Phase 99.

### Reviewed Todos (not folded)
These matched the phase on keywords only, so none were folded:
- Restore staff attribution on admin writes: unrelated (audit attribution, not staff batches).
- Beer & Cider launch pages: shipped/unrelated.
- BrewPad bottled status not reflecting without refresh: separate bug.
- Ready to Bottle filter on the batch view: already shipped (Phase 69).

</deferred>

---

*Phase: 95-global-filters-and-chart-engine*
*Context gathered: 2026-10-28*

<!-- Planner notes from research (Claude's Discretion, accepted): sticky filter bar uses top:0 inside .bp-panel, not var(--bp-shell-height); period code keys stay 6mo/12mo with UI labels 6m/12m; Chart.js pinned to 4.5.1 (4.6.1 is under two weeks old). -->
