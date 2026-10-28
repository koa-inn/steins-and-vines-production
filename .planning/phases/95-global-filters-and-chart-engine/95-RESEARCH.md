# Phase 95: Global filters and chart engine - Research

**Researched:** 2026-10-27
**Domain:** BrewPad v2 dashboard (vanilla ES5 frontend + Express/Postgres middleware): global filters, self-hosted Chart.js 4, click-through, trend deltas, staff-batch flag
**Confidence:** HIGH on codebase facts and Chart.js packaging (verified in this session); MEDIUM on iPad Safari behaviour (needs UAT)

## Summary

Everything this phase needs already has a seam in the code. `getDashboardData(rows, asOf, filters)` (js/brewpad.js:475) is the single computation but it currently returns counts only, supports only `window` + `type`, and buckets months independently of the window. Phase 95 extends it (not a parallel path) with: custom/previous ranges, `source`, `staff`, `group` (week|month), `measure` (batches|litres), and returns **batch-id sets** next to every count so a chart click, a tile click and the number on screen are the same set by construction (D-14, Phase 94 D-20).

The dashboard aggregate (`DASH_STATS_BATCHES_SQL`, zoho-middleware/lib/batch-pg-read.js:76) **already returns `source`** and `target_volume_l`; it needs only `staff_batch` added. The server work is small and follows the Phase 94 migration 0007 pattern: migration 0008 (`boolean not null default false`, verified to pass both migration guards locally), Postgres-only (not in `BATCH_COLUMNS`, so not mirrored), opt-in on list/detail reads, an `update_batch` branch handled outside `FIELD_KINDS`, auto-set on create for `internal`/`research`, and a dry-run-default backfill CLI. The backfill should use a write that does **not** bump `last_updated` (precedent: `TYPE_SET_SQL`, batch-pg-update.js:63), which removes the need for the slow, non-resumable sheet replay entirely.

Chart.js: **pin 4.5.1** (published 2025-10-13). Latest 4.6.1 was published 2026-10-22, only 5 days ago, so it fails the "at least 2 weeks old" rule. `dist/chart.umd.min.js` exists in 4.5.1 (208,522 bytes, MIT, no network calls, no optional chaining or `??` in the bundle). Tests mock `window.Chart`; jsdom has no canvas.

**Primary recommendation:** Add a pure, id-returning selection layer to `getDashboardData`, build a v2 render entry (persistent filter-bar shell + widgets) dispatched from the top of `renderDashboard`, vendor `chart.umd.min.js@4.5.1` lazily, and ship the staff flag as migration 0008 plus a no-`last_updated`-bump backfill.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Owner approved D2, D3, D4, D5 on 2026-10-28. Tick them in section 7 of `.planning/research/brewpad-dashboard-v2.md` (already ticked in the file as read 2026-10-27). Every other unticked section 7 item stays out of scope.
- **D-02:** Ships behind `?dash=v2`. Current dashboard stays default. `brewpad.html?dash=v2` turns v2 on, remembered per device (localStorage, with a way to switch back).
- **D-03:** v1 dashboard is frozen: bug fixes only.
- **D-04:** Sticky filter bar, collapses to a sheet on phones. Type: All, Wine, Beer, Cider (seltzer/other count under All, per Phase 94 D-04). Period: 30d, 90d, 6m, 12m, YTD, All, custom range. Group by: week, month. Measure: batches, litres. Source: kiosk, online, manual, zoho_scan, research, internal, Unknown. Staff toggle.
- **D-05:** Defaults: YTD, month, batches, type All. Weeks Monday-Sunday as in the Phase 93 kiosk ledger. Dates are America/Vancouver calendar dates (Phase 94 D-19).
- **D-06:** Filter state in URL hash and localStorage. Hash wins when both present.
- **D-07:** Batches with no recorded `source` (82 of 215 on 2026-10-27) appear under "Unknown". "All" includes them. No source backfill.
- **D-08:** Explicit flag on a batch (e.g. boolean `staff_batch`), editable in BrewPad, set automatically for `source` = `internal` or `research` on create. Do not detect staff batches by customer name going forward.
- **D-09:** One-time candidate backfill following the B2/B3 pattern: `--dry-run` CLI lists every proposed batch, owner reviews the full list in-session, then `--apply --expect=N`. Candidates: every `internal`/`research` batch plus customers McLachlan and Inn. On production, run after replay + verify per the Phase 94 runbook.
- **D-10:** Staff batches hidden by default only in mix views (wine breakdown now; source mix and leaderboard later). Production views (fermenting, started, completed, cycle time, month chart, later capacity) always include them (Phase 94 D-12). The toggle adds them to mix views.
- **D-11:** Litres default 23 L wine and cider; beer 28 L for started and in-progress counts, 25 L for completed counts; `target_volume_l` overrides when set (empty on every batch today). Seltzer/other use 23 L unless the planner finds a better default. Flag as open question, do not invent one.
- **D-12:** Chart.js 4 at a pinned exact version, self-hosted in `js/vendor/`, loaded only when the v2 dashboard opens. No new domain, no CSP change (brewpad.html has no CSP tag; public pages untouched; CLAUDE.md rule 12 still checked).
- **D-13:** Small `chart()` helper, each widget about 20 lines. Wine = burgundy, cider = gold, beer = amber (deep enough to stay distinct from gold, contrast-checked).
- **D-14:** Clicking a bar, segment or tile opens the Batches tab showing exactly that batch set, with a dismissible banner (e.g. "From dashboard: Wine started in Jun 2026 · 33 batches ✕"). Clearing returns to the normal list and status chips. The set comes from the same data layer as the chart (Phase 94 D-20).
- **D-15:** Delta compares with the immediately preceding window of the same length (30d, 90d, 6m, 12m, custom = window just before it). YTD compares with the same Jan 1-today stretch last year. All shows no delta. Display up/down triangle with the change.
- **Carried forward:** every widget reads `getDashboardData(rows, asOf, filters)` and stored `batch_type`; totals count started batches only (primary, secondary, complete); start buckets use `start_date`, completion buckets use `completed_at`; dashboard loads from `get_dashboard_stats` through the admin-proxy seam cached ~60 s; Postgres batch store only; `update_batch` always nests fields in `updates:{}`; classify by `cf_type` or SKU never by product name; production data writes need the owner's OK in-session after a `--dry-run`.

### Claude's Discretion
- Visual layout (filter-bar layout, phone sheet, chart styling, tooltip format, custom-range picker). Settled by 95-UI-SPEC.md (approved).
- Staff flag details: exact column name and where staff edit it (detail pane next to Type).
- Delta format: absolute vs percentage, recorded in the UI spec.

### Deferred Ideas (OUT OF SCOPE)
- Source backfill (inferring the 82 blank sources). "Unknown" is shown instead.
- New graphs G1-G10 (Phase 96), beer/cider sections (Phase 97), alerts (Phase 98), table views / performance / v2 as default (Phase 99).
- Reviewed todos not folded: staff attribution on admin writes, Beer & Cider launch pages, bottled status refresh bug, Ready to Bottle filter (already shipped Phase 69).
</user_constraints>

<phase_requirements>
## Phase Requirements

No REQ-IDs exist yet; D2-D5 from the handoff are the requirement set.

| ID | Description | Research Support |
|----|-------------|------------------|
| D2 | Global filter bar (type, period, group-by, measure, source, staff toggle), sticky, phone sheet, state in hash + localStorage | Sections "Filter state", "Data layer extension", "Staff flag (server)", Pitfalls 1, 2, 7 |
| D3 | Chart.js 4 self-hosted, `chart()` helper, brand palette | Sections "Standard Stack", "Chart helper", Code Examples, Pitfalls 3, 4 |
| D4 | Every bar, segment and KPI tile opens Batches tab pre-filtered to exactly those batches | Sections "Drill-down", Pitfalls 5, 6 |
| D5 | KPI tiles show change vs previous equivalent period | Section "Delta math", Code Examples |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Frontend is static HTML, vanilla **ES5** JS (ESLint `ecmaVersion: 5`, `sourceType: script`): no `let`/`const`/arrow/template literals in `js/brewpad.js` or tests' targets. `**/*.min.js` is ESLint-ignored, so `js/vendor/chart.umd.min.js` needs no lint config change. [VERIFIED: eslint.config.* ignores]
- Never edit `js/brewpad.min.js` / `css/brewpad.min.css` / `js/main.js`; edit sources, run `npm run build` after any JS module change (rule 8-9). `npm run build` stamps `brewpad.min.js?v=` and `brewpad.min.css?v=` in brewpad.html.
- Before every commit: `npm test`, `cd zoho-middleware && npm test`, `npm run lint`. After touching shared utils (`zoho-middleware/lib/*.js`) run the FULL suites for both.
- Bug fixes: regression test first, one logical change per commit. Do NOT modify existing tests unless explicitly asked (rule 10). Phase 94 review fixes already changed three assertions; do not repeat that in this phase without owner say-so.
- Rule 12: CSP check on public pages when adding third-party services. This phase adds none (self-hosted vendor file, brewpad.html has no CSP meta). Record "checked, no change" in the plan.
- Middleware has its own `node_modules`; always `cd zoho-middleware`. Staging first; never push to production without approval.
- Never commit `.env` or credentials; no customer emails or names in the dashboard aggregate.
- Global CLAUDE.md says to use `gemini`; memory notes it is broken (IneligibleTierError). Not used; grep + Read instead.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Filter state (hash + localStorage) | Browser / Client | — | Pure client state; no server involvement |
| Window/bucket/delta/litres math | Browser / Client (js/brewpad.js data layer) | — | Phase 94 D-20: one client data layer over the lean aggregate; keeps counts, charts and drill sets identical |
| Lean row source (`source`, `staff_batch`, `target_volume_l`) | API / Backend (batch-pg-read.js) | Database | Aggregate SELECT whitelist; never customer names |
| `staff_batch` persistence, auto-set on create, edit via `update_batch` | API / Backend (batch-pg-create/update) | Database (migration 0008) | Postgres-only column, trusted-channel rules live server-side |
| Staff backfill | Backend CLI (scripts/backfill) | Database | Owner-reviewed dry run, `--apply --expect=N` |
| Chart rendering | Browser / Client (Chart.js canvas) | CDN/Static (vendor file on Pages) | Static self-hosted asset, lazy injected |
| Click-through list filtering | Browser / Client | — | Filters cached `_allBatchesData` by id set |
| Staff checkbox in detail pane | Browser / Client | API / Backend | UI toggles via `update_batch` |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Chart.js | **4.5.1** (pinned, vendored `js/vendor/chart.umd.min.js`) | Bar/doughnut/line charts, touch tooltips, responsive canvas | Locked by D-12/D-03. 4.5.1 published 2025-10-13; 4.6.1 (2026-10-22) is too new [VERIFIED: npm registry `npm view chart.js time`] |

### Supporting
None. No `chartjs-adapter-*`, no plugins (the UI spec uses a custom HTML legend and no time axis; buckets are pre-computed string labels).

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Chart.js 4.5.1 | 4.6.1 | Newer, but 5 days old; revisit after 2026-11-05 only if a fix is needed |
| Chart.js | ECharts | Locked out by D-12 (heatmaps are Phase 96 concern, not this phase) |
| Hand-drawn CSS bars (current v1) | — | No tooltips/click hit-testing; v1 stays frozen |

**Installation (vendor file, not an npm dependency):**
```bash
cd <scratch dir, NOT the repo>
npm pack chart.js@4.5.1 && tar xzf chart.js-4.5.1.tgz
cp package/dist/chart.umd.min.js /Users/koa/dev/steins-and-vines-website/js/vendor/chart.umd.min.js
shasum -a 256 js/vendor/chart.umd.min.js   # expect 48444a82d4edcb5bec0f1965faacdde18d9c17db3063d042abada2f705c9f54a
```
**Verified in this session** (4.5.1 tarball): `dist/chart.umd.min.js` = 208,522 bytes, SHA-256 `48444a82d4edcb5bec0f1965faacdde18d9c17db3063d042abada2f705c9f54a`; tarball SHA-256 `f540d98468457ac7a0aabb32006dfb066297e096c5ea063a5d80aa973d1c337a`; registry integrity `sha512-GIjfiT9dbmHRiYi6Nl2yFCq7kkwdkp1W/lp2J99rX0yo9tgJGn3lKQATztIjb5tVtevcBtIdICNWqlq5+E8/Pw==`. Header reads `Chart.js v4.5.1 ... MIT`. The only URLs in the bundle are comment/licence URLs (chartjs.org, kurkle/color); no `fetch`, `XMLHttpRequest` or `sendBeacon`. `dist/chart.umd.js` is the same code (208,518 bytes); both exist, use the `.min.js` name (matches the UI spec and ESLint ignore). Does not use optional chaining or `??`; uses ES2015 classes/spread and `ResizeObserver` (Safari 13.1+) [VERIFIED: grep of bundle]. The npm package depends on `@kurkle/color` which is bundled into the UMD file.

Record version + SHA-256 in a new `js/vendor/README.md` (no README exists in js/vendor today) AND the commit message; the plan needs a verification task that checks both (UI spec Registry Safety gate).

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| chart.js | npm | 10+ yrs (first release 2013) | 10.9M/wk (2026-10-20 to 10-26) | github.com/chartjs/Chart.js | [OK] | Approved (vendored file only; never `npm install`ed into the repo) |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
Note: `npm view chart.js scripts.postinstall` returned nothing (no postinstall). slopcheck's `install` subcommand runs `npm install` in the current directory; I ran it from a scratch dir, nothing was added to the repo. The planner should not run it from the repo root. [VERIFIED: slopcheck, npm registry]

## Architecture Patterns

### System Architecture Diagram

```
 brewpad.html?dash=v2  (or "Try new dashboard" button)
        |
        v
 isDashV2()  <-- localStorage flag / ?dash=v2 / hash dash=v2
        |
 renderDashboard()  [top-level dispatch line only; v1 body untouched]
        |-- v2 off --> v1 render (frozen)
        |-- v2 on  --> renderDashboardV2()
                          |
   get_dashboard_stats (admin-proxy, memo 60s, cleared by any write)
        |  rows: {batch_id,status,batch_type,start_date,completed_day,source,
        |         target_volume_l,staff_batch,product_*,...}
        v
 _dashData.batches ---> getDashboardData(rows, asOf, filters)
                          filters = parseHash()/localStorage -> {type,period|range,group,
                                    measure,source,staff}
                          |-- current window --> counts + id sets + buckets (week|month)
                          |-- previous window --> counts (for deltas, same function)
                          v
                  +-------+---------------------+
                  |                             |
          KPI tiles (buttons)         chart(canvas, cfg)  [lazy Chart.js]
          value + delta line          onClick -> (type,bucket) -> id set
                  |                             |
                  +------------ click ----------+
                                |
                      setDashDrill({ids,label,count})
                      _batchStatusFilter='all'; _batchSearch=''; _batchProductFilter=''
                                |
                      switchTab('batches') -> applyBatchFilter() restricts
                      _allBatchesData to id set -> banner (dismiss clears)

 Filter bar change --> write hash (replaceState) + localStorage --> re-render widgets only
```

### Recommended Project Structure
```
js/brewpad.js                 # data layer + v2 render + chart() inside/next to existing Phase 94 section
js/vendor/chart.umd.min.js    # pinned 4.5.1
js/vendor/README.md           # version + SHA-256 record (new)
css/brewpad.css               # bp-dash-filters, bp-seg, bp-widget, bp-chart, bp-drill-banner, --chart-* tokens
zoho-middleware/migrations/0008_staff_batch.sql
zoho-middleware/lib/batch-rules.js         # normalizeStaffBatch(), STAFF_AUTO_SOURCES
zoho-middleware/lib/batch-pg-read.js       # add staff_batch to DASH_STATS select + addBatchType extras
zoho-middleware/lib/batch-pg-create.js     # insert staff_batch
zoho-middleware/lib/batch-pg-update.js     # update_batch staff_batch branch
zoho-middleware/scripts/backfill/staff-batch-backfill.js
zoho-middleware/scripts/backfill/batches-parity.js  # IGNORED_KEYS += staff_batch
tests/frontend/brewpad-dashboard-v2-*.test.js
zoho-middleware/__tests__/(db|backfill)/...
```
No new JS module file is needed in the browser: brewpad.html loads `js/brewpad.min.js` directly, and brewpad.js is **not** concatenated (the `concat:js` step only builds main.js from `js/modules/`; `minify:js` runs `terser js/brewpad.js -o js/brewpad.min.js`). [VERIFIED: package.json scripts, brewpad.html line 27]. A single-file approach keeps the test seam (`module.exports` at the bottom, tests `require('../../js/brewpad')`) working. If brewpad.js grows unwieldy the planner may extract a `js/lib/` file, but then it must be added to brewpad.html script tags, the build, and ESLint; not recommended for this phase.

### Pattern 1: Selection layer that returns ids (D-14 core)
**What:** Extend `getDashboardData` so each item that is counted is also pushed into an id array. Counts are derived as `ids.length`, never counted separately. Buckets carry `ids[type]` arrays.
**When to use:** every widget and every tile. A click reads `bucket.ids[type]` (or the tile's id array) directly, so banner N == clicked number by construction.
**Example:** see Code Examples (selection and buckets).

Key design points:
- Add `filters.range = {start,end}` that overrides `window` (custom range and previous window both use it). `dashboardWindow(key, today)` stays; add `windowFromFilters(f, today)` and `previousWindow(win, key, firstStartDay)`.
- Filter order inside the single loop: classify -> `type` filter -> `source` filter -> (staff filter applies only where a caller asks for `mix: true`). `needsType` worklist stays unfiltered as today.
- Source match: `'unknown'` matches `source` null/undefined/empty/whitespace; otherwise lower-cased equality. Normalise with the existing `normBatchSource()` (brewpad.js:~225).
- Buckets must be **clipped to the window**: a bucket counts a row only if `inWindow(start_date, win)` AND it falls in the bucket. Otherwise the chart total differs from the "Started" tile (the F4 bug again). Current `monthBuckets` ignores the window and counts everything within the last N months; v2 must not reuse that.
- Generate gap-filled bucket skeleton from `win.start` (for `all`: from the earliest `start_date` in the filtered rows, or the earliest in all rows) to `win.end`. Week key = Monday on or before the day; label `Week of Jun 1`; month key `YYYY-MM`, label `Jun 2026` (add year; the current v1 labels are 3-letter months only and ambiguous across years in 12m/all).
- Return `data.series` per type for batches and litres so the chart code does not compute anything.

### Pattern 2: Persistent filter-bar shell, widgets re-render
**What:** Render the v2 shell (filter bar + widget containers) once, then update widget contents on filter change. Do not `innerHTML` the whole `#bp-dashboard-inner` on every change.
**Why:** (a) the sticky bar keeps focus/scroll position, (b) existing `renderBatchList` already uses this shell pattern ("persistent shell... only created when #bp-batch-results doesn't exist"), (c) charts need their canvas to survive between renders so `chart()` can destroy/recreate on the same canvas, (d) `eagerLoad()` and the 5-minute `startDashAutoRefresh()` both call `renderDashboard()` (line 4256 guard `_activeTab==='dashboard'`); a full rewrite each time would leak chart instances and reset the open custom-range picker.

### Pattern 3: Single dispatch line
`renderDashboard()` (:4332) gets one first-line dispatch: `if (isDashV2()) { return renderDashboardV2(); }`. v1's body is untouched (D-03). `loadWineSnapshot()` calls `renderDashboard()` after the catalog loads; with the dispatch it re-renders v2 correctly.

### Anti-Patterns to Avoid
- **Parallel data path for v2.** Violates Phase 94 D-20 and recreates F4 (120 vs 122 vs 204).
- **Counting and id-collecting separately.** The banner count and the chart number will drift.
- **Re-using `bucketBatchesByMonthType`** (brewpad.js:~625, a legacy Phase-pre-94 helper that uses client wall-clock) in v2.
- **Hard-coding colours in widget code.** UI spec: read CSS custom properties once via `getComputedStyle`.
- **Hash writes with `pushState`/`location.hash =`.** Use `history.replaceState` (UI spec) so Back does not step through filter taps.
- **Filtering the drill list by name/product.** Filter by `batch_id` set only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Charts, tooltips, hit-testing | Canvas/SVG drawing | Chart.js 4.5.1 | Touch tooltips, DPR scaling, resize |
| Bar click on stacked segment | pixel math | `chart.getElementsAtEventForMode(evt,'nearest',{intersect:true},true)` then fall back to `'index'` | Documented API [CITED: chartjs.org/docs/latest/developers/api.html] |
| Median/mean/day math | new helpers | existing `medianOf`, `meanOf`, `dayNumber`, `addDays`, `cycleDays`, `inWindow` | Already tested, DST-proof (UTC day numbers) |
| Source normalisation | new | `normBatchSource` (:~225) | Exists |
| Toasts, empty states, selects | new components | `showToast`, `.bp-empty`, `.bp-select`, `.bp-filter-btn` pattern | Per UI spec citations |
| Staff backfill plumbing | new CLI scaffolding | copy `scripts/backfill/batch-type-backfill.js` (parseArgs, `--apply --expect`, exit codes, read-only candidate tx, one tx per batch) | Proven review path |
| Migration safety | manual review | `npm run migrate:guard` (guard + allowlist) | Already passes for `add column ... boolean not null default false` [VERIFIED locally] |
| Week start | new algorithm | `(dayNumber(ymd) + 3) % 7` = days since Monday (1970-01-01 is a Thursday); mirror of server `kiosk-history.weekStart` | Phase 93 reuse is server-side only (zoho-middleware/lib/kiosk-history.js:256); no frontend helper exists, so write this 3-line one in brewpad.js |

**Key insight:** every piece except the `chart()` wrapper and the filter-bar UI is a small extension of an existing, tested function. The risk is consistency (same set everywhere), not volume.

## Detailed Findings

### Where logic plugs in (js/brewpad.js, 12,399 lines) [VERIFIED: grep/Read]
| Need | Location | Change |
|------|----------|--------|
| Window | `dashboardWindow` :399, `DASH_WINDOW_DAYS` :~357 keys `30d,90d,6mo,12mo` (note: **6mo/12mo**, not 6m/12m; 6mo=180 d, 12mo=365 d) | Map UI `6m`->`6mo`, `12m`->`12mo` in filter parse; add range override + previous-window fn |
| Classification | `effectiveBatchType` :414 | Reuse unchanged |
| Row adapter (sheets fallback) | `toDashRows` :~425 | Add `staff_batch: !!b.staff_batch`; `source` already passed |
| Data layer | `getDashboardData` :475 | Extend as above; keep existing return keys for v1 |
| v1 render | `renderDashboard` :4332 | One dispatch line |
| Data load | `eagerLoad` :~4185 / `loadDashboard` :4282 -> `_dashData` (aggregate), `_allBatchesData` (get_batches all statuses) | Unchanged |
| Tab switch | `switchTab` :3170 | On `dashboard`: resize/re-render v2 charts (hidden-canvas pitfall); on `batches`: apply drill |
| Batch list filtering | `applyBatchFilter` :4899 (status chip -> `_batchesData`), `renderBatchList` :5029, chip click `selectBatchStatusFilter` :4983 | Drill restricts first, banner above chips |
| Existing dashboard->batches nav | `initDelegation` :11062 (pipeline tile sets `_batchStatusFilter`, `_batchSearch=''`, `_batchesLoaded=false`, `switchTab('batches')`) | Model the drill entry on it |
| Detail pane Type row | `renderBatchDetail` :6704-6715, change handler :6892-6910, `setBatchType` :2977, `batchTypeInfo` :2998 | Add Staff row + `setStaffBatch` mirroring `setBatchType` |
| Test exports | `module.exports` :12320 (top-level pure fns) and :12186 (IIFE seams) | Export new pure fns; add seams for hash parse and v2 render |

There is **no existing `location.hash`, `URLSearchParams`, or `history.*` use anywhere in brewpad.js** (grep returned nothing), so hash keys cannot collide with tab routing. Google sign-in uses the GSI popup token client, not a redirect/fragment flow. localStorage keys in use: `sv_session_token`, SESSION_KEY, `linkDismissKey(batchId)`. Choose `bp_dash_v2` (opt-in flag) and `bp_dash_filters` (JSON). [VERIFIED: grep]

### Filter state
- Parse order: defaults <- localStorage JSON <- hash params (hash wins, per key; a missing hash key falls back to localStorage, which is stricter than "hash wins when both present" but consistent). Decide in the plan and test it: recommended rule = if the hash contains any filter key, use hash only (plus defaults), ignore localStorage entirely; otherwise localStorage. That makes a copied URL reproduce the view exactly.
- Hash format from UI spec: `#dash=v2&type=wine&period=ytd&group=month&measure=batches&source=kiosk&staff=0&from=&to=`; write only non-default keys. Validate every value against whitelists; unknown values fall back to the default (the hash is attacker-influenceable text rendered nowhere raw, but `from`/`to` must be validated as `YYYY-MM-DD` and `from<=to<=today`).
- `?dash=v2` query param sets the opt-in flag, then is left alone. The UI-spec in-app "Try new dashboard" / "Back to classic dashboard" buttons are the **primary** opt-in path: on iOS, a Home Screen web app's localStorage is separate from Safari's, so `?dash=v2` typed in Safari does not carry into the installed PWA [ASSUMED: WebKit storage partitioning behaviour; confirm on the shop iPad]. Make the button reachable from v1.
- Custom range label per UI spec, validated; `Apply Date Range` commits.
- Persist in localStorage guarded by try/catch (Safari private mode throws), as existing code does.

### Litres measure
- `batchLitres(row, kind)`: `target_volume_l` if finite and > 0; else wine 23, cider 23, beer 28 for `started`/in-progress and 25 for `completed`; seltzer/other fall back to **23** (open question OQ1). Flag each result `estimated: true` when the default was used so the widget subtitle can append `litres estimated from standard batch sizes`.
- `target_volume_l` comes back from SQL via `numOrNull`; treat 0 as unset.
- A beer batch that is both started and completed in the window counts 28 L in a "started" series and 25 L in a "completed" series (the two measures are separate series). The stacked "Batches per period" chart is started-based, so beer = 28 L there.
- Alternative data source noted but out of scope: `recipe_snapshot.batch_size_l` exists in `get_batches` rows but is deliberately excluded from the lean aggregate. Do not add snapshots to the aggregate.

### Delta math (D-15)
```
prevWindow(win, key, today):
  all        -> null (no delta line)
  30d/90d/6mo/12mo -> {end: addDays(win.start,-1), start: addDays(win.start, -N)}   // N = window days
  ytd        -> {start: (year-1)-01-01, end: sameMonthDayLastYear(today)}  // clamp Feb 29 -> Feb 28
  custom     -> N = dayNumber(to)-dayNumber(from)+1; {end: addDays(from,-1), start: addDays(from,-N)}
insufficient = prev.start < earliest start_date across ALL rows (before filters)
```
Compute the previous value by calling the same selection function with `range: prev`. Tiles: Started, Completed (count or litres per Measure), Days-to-complete median (lower is better, colours inverted per spec). Fermenting now has no delta. Delta text/colour/percentage rules are in 95-UI-SPEC section 5; implement as a pure `formatDelta(cur, prev, key, kind)` returning `{text, dir, cls, aria}` and unit-test it.

Note on Phase 94 caveat: 40 legacy completed batches were backfilled with estimated `completed_at` (`completed_at_source = 'backfill-task'`); prior-period completed/cycle comparisons across early 2026 therefore rest on estimated dates. Mention in the plan's verification, not a blocker.

### Drill-down (D-14)
- State: `_dashDrill = null | { ids: {batch_id:true}, count, label, window }` inside the IIFE.
- Entry: `openDashDrill(spec)` sets `_dashDrill`, `_batchStatusFilter = 'all'` (a value `filterBatchesByStatus` already supports, no chip highlights), clears `_batchSearch` and `_batchProductFilter`, then `switchTab('batches')`. Setting `'all'` is essential: the default chip is `'active'`, which would silently drop complete batches from a "Completed YTD" set and break the count-match rule.
- `applyBatchFilter` (:4899): if `_dashDrill`, start from `_allBatchesData.filter(id in set)` then apply the status chip narrowing (UI spec: chips narrow the set). `needsType`/`readyToBottle`/`unlinked` chips keep their own logic but intersect with the set.
- Banner (`.bp-drill-banner`, role=status) rendered into the persistent list shell **above the chips**; dismiss clears `_dashDrill`, restores `_batchStatusFilter='active'` (the default) and re-renders. Copy per UI spec; singular `1 batch`.
- Count authority: banner N = `ids.length` from the data layer. List heading shows visible count. If `_allBatchesData` is stale/empty (afterBatchWrite empties it; see `selectBatchStatusFilter` comment about the "list disappears" owner report), call `loadBatches()` first then apply; show `No batches in this set any more.` only when the intersection is empty.
- Drill survives the pipeline-tile path unchanged: clicking a v1 pipeline tile must clear `_dashDrill`.
- Bucket clicks: id set = rows matching type (and bucket) already clipped to the window. Tile clicks: Started -> started ids in window; Completed -> completed ids in window (status complete only, `completed_day` in window, per CR-01); Fermenting -> `activeNow` ids (status primary/secondary, type+source filters, ignores Period); Cycle time tile -> the completed-with-span ids that contributed (document; or non-clickable if the planner prefers).

### Chart helper (D-13)
See Code Examples. Behaviours to pin in tests: destroys prior instance on same canvas (`Chart.getChart(canvas)` or stored reference), `responsive:true, maintainAspectRatio:false`, animation off under `prefers-reduced-motion`, `interaction: {mode:'index', intersect:false}`, integer y ticks for batches, `Intl`-free thousands separator for litres (ES5-safe regex), colours read from CSS vars, `role="img"` + `aria-label` on canvas.

Loader: `loadChartJs()` returns a cached Promise; if `window.Chart` exists resolve; else inject `<script src="js/vendor/chart.umd.min.js?v=4.5.1">`, resolve onload, reject onerror (UI-spec failure copy). ES5 `Promise` is already used all over brewpad.js. Call it from `renderDashboardV2()` only.

### Staff flag (server) - pattern from migration 0007 / Phase 94
Migration `0008_staff_batch.sql` (never edit once applied; ships to prod only after 0007 is there):
```sql
-- Up Migration
alter table batches add column staff_batch boolean not null default false;
comment on column batches.staff_batch is 'staff/family/R&D batch; hidden from mix views (Phase 95)';
-- Down Migration
alter table batches drop column staff_batch;
```
Verified: `migration-allowlist.js` and `migration-guard.js` both pass this file [VERIFIED: ran both against a scratch copy]. Metadata-only add on PG 11+ (prod is PG 18.6). No CHECK constraint (89 D-03 precedent). No backslashes in the file (guard bans them).

Touch points (each mirrors a batch_type touch point):
1. `lib/batch-pg-read.js`: add `b.staff_batch` to `DASH_STATS_BATCHES_SQL` (:76); extend `addBatchType()` (:152) with `batch.staff_batch = row.staff_batch === true` (already opt-in via `includeType`, used by `listBatches` and `getBatchDetail` from batch-store :132/:140/:202). Keep it **out of** `BATCH_COLUMNS` (batch-rules.js:25) so `serializeBatch`, the mirror bundle (`ops-mirror.buildMirrorRequest`) and `batch-compare` never see it. The aggregate currently `select`s no customer columns; keep it that way.
2. `lib/batch-pg-create.js`: INSERT_BATCH_SQL (:57) has 30 params; add `staff_batch` as the 31st. Value = `source in ('internal','research')` (lower-cased), never from client payload. Kiosk/online/zoho_scan/manual -> false.
3. `lib/batch-pg-update.js`: handle `updates.staff_batch` outside `FIELD_KINDS` (as `batch_type` is, :328-356): accept boolean or `'true'/'false'` only else `fail('invalid_input', ...)`; do not allow when row is deleted/disabled? (UI hides it; server may still allow). `addSet('staff_batch', value)` goes through the normal `last_updated` bump (mirror still sends the same sheet-shaped state; harmless).
4. `scripts/backfill/batches-parity.js`: add `staff_batch: true` to `IGNORED_KEYS` (:41), as for `batch_type` (WR-02 pattern).
5. `ops-mirror.js` / `batches-verify`: no change expected because the column is not in `BATCH_COLUMNS`; add a test asserting the mirror payload and `serializeBatch` output contain no `staff_batch` key. Existing guard tests (`batches-parity-type-keys.test.js`) are the model for the new parity test; add new test files rather than editing old ones (CLAUDE.md rule 10).
6. `get_batches` list rows from Postgres include extras only via `includeType`; the frontend list does not need `staff_batch` (drill uses the aggregate), the detail pane does (`get_batch` -> `includeType`).

Provenance hint (UI spec: "Set automatically (internal batch)" / "(research batch)" / "Set by hand") needs no extra column if derived: `staff_batch && source==='internal'` -> internal hint; `source==='research'` -> research hint; `staff_batch` true otherwise -> "Set by hand". Slight inaccuracy possible if a batch is flipped to `internal` later; acceptable, or add a `staff_batch_source` text column to 0008 for parity with `batch_type_source` (planner choice; simpler = derive).

Source flip case (OQ2): `markBatchSource` can change `manual <-> internal` (Phase 90 D-05). D-08 says auto-set "on create". Recommend also setting `staff_batch = true` when a batch is moved to `internal`, and not touching it when moved back, but this is an owner call.

### Staff backfill (D-09) and the replay problem
- CLI `scripts/backfill/staff-batch-backfill.js`, copied structure from `batch-type-backfill.js` (dry run default; `--apply --expect=N`; exit 3 on mismatch; `BACKFILL_DATABASE_URL` env only; refuses a postgres URL on argv; read-only candidate tx; one tx + row lock per batch; ids/rules/counts only, no names unless `--with-names`).
- Candidates (fixed SQL, parameterised): `source in ('internal','research')` OR `customer_name`/`customer_firstname`/`customer_lastname` matching `McLachlan` or `Inn` (case-insensitive, **whole-word**, and the dry run lists the matching field so the owner can reject false positives such as "Dinner"/"Winn"; "Inn" is a short token). Output the full list; owner reviews every row in-session; `--expect=N` must equal reviewed count.
- Idempotent: only rows with `staff_batch = false` are candidates; a re-run lists 0.
- **Write path:** use a dedicated statement `update batches set staff_batch = true where batch_id = $1` that does **not** touch `last_updated` (same precedent as `TYPE_SET_SQL`, batch-pg-update.js:63-64, used by `rederiveType`). Consequences: no mirror drift, so no replay is needed and `batches-verify` stays at 0 mismatches; no `expectedVersion` invalidation in open BrewPad tabs (Phase 94 IN-04 side effect). Route it through a small exported `batchPgUpdate.setStaffBatch(client, id, value, {trusted:true})` or inline in the CLI's transaction; either way keep it behind the row lock.
- This resolves the "replay CLI 30 s timeout / no resume" concern for this phase: **verified still unfixed** (`batches-replay-to-sheet.js` still has `APPS_SCRIPT_TIMEOUT_MS = 30000`, stops at the first error, `--since` cannot resume because rows from one apply share a `last_updated`; the 94 review fixes did not touch it; last commit c6597e09). Memory notes ~14 s per Apps Script mirror call and a one-off driver on prod. Run order D-09 ("after replay + verify") is satisfied by running `batches-verify` after the apply and requiring 0 mismatches; a replay is only needed if the apply bumped `last_updated`. If the planner prefers `updateBatch` (which bumps), budget ~14 s x N and use the one-off resumable driver approach, or add `--ids`/resume to the CLI as a separate commit.
- Staging: Postgres only; never run replay/verify on staging (shared workbook). Production: run in-container via `railway ssh -s sv_middleware -e production -- sh -c '...'` with `BACKFILL_DATABASE_URL=$DATABASE_URL` (tunnel/`railway connect` fails per runbook). Add a Phase 95 subsection to docs/RUNBOOK.md next to "Batch type and completion dates (Phase 94)" and log the production apply in `87-CUTOVER-LOG.md` "SQL fixes".

### Tests
- Frontend: Jest 29 + jsdom, `testMatch tests/frontend/**/*.test.js`, TZ forced to America/Vancouver by jest.config.js. Existing brewpad tests stub `global.localStorage`, `fetch`, `google` and `require('../../js/brewpad')`; dashboard render tests (`brewpad-dashboard-render.test.js`) and `_renderDashboardForTest`, `_setStateForTest({_dashData,...})` seams exist. Add: `brewpad-dashboard-v2-data.test.js` (pure functions), `...-filters.test.js` (hash/localStorage), `...-render.test.js` (shell + fake Chart), `...-drill.test.js`, `...-staff.test.js`.
- Chart.js in jsdom: jsdom has no canvas implementation (`HTMLCanvasElement.getContext` returns null and logs "not implemented"), and no `canvas` npm package is installed [VERIFIED: node_modules scan]. Do **not** load the real library in Jest. Install a fake: `global.Chart = function (canvas, cfg) { Chart.instances.push(this); this.config = cfg; this.destroyed = false; }; Chart.prototype.destroy = function () { this.destroyed = true; }; Chart.prototype.getElementsAtEventForMode = function () { return fake; }; Chart.getChart = ...`. Assert on `config.type`, `data.labels`, `data.datasets[i].data/backgroundColor`, tooltips callbacks output, and invoke `config.options.onClick(evt, [], fakeChart)` to test click-through. The loader test: set `window.Chart` before and assert no script tag injected; remove and assert one `<script src*="chart.umd.min.js">` appended and promise resolves on `onload`.
- Real-browser coverage: one Playwright e2e or manual UAT on staging for the real library (stacked bar tap, sticky bar, sheet) since Jest cannot render. Existing `tests/e2e` is Playwright. Phone-width harness note from memory: Chrome will not shrink below ~600 px; use the same-origin 390 px iframe harness on staging.
- Middleware: Jest unit (`npm test`) plus `npm run test:db` (Testcontainers `postgres:16`; Docker CLI is installed locally but I could not confirm the daemon is running). Note the known mismatch: tests/CI use postgres:16 while prod/staging run PG 18.6 (memory) - the new column/SQL are trivially portable. Use Node 24 (`nvm`/installed v24.21.0); the current shell default is v20.20.2.
- Pure unit tests to write (from UI spec + this research): hash round trip; hash-over-localStorage precedence; invalid hash values fall back; Monday-Sunday week keys across a year boundary and a DST boundary (Nov 1-2 2026 fall-back, Mar 8 2026 spring-forward); bucket sums == tile totals for every filter combination; litres defaults including beer 28/25 and `target_volume_l` override and 0-as-unset; seltzer/other default; Unknown source matches null/''/whitespace; staff toggle excludes staff only from `mix` widgets and never from tiles/chart; delta per period type (30d, 6mo, YTD with Feb 29, custom, all=none), zero/both-zero/insufficient-data; banner text singular/plural; drill count equals visible list; chip narrowing after drill; dismiss restores defaults; `chart()` destroys previous instance; fermenting-now ignores Period.

## Runtime State Inventory

Not a rename/refactor phase, but it adds a column and a backfill, so the relevant runtime-state answers are:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `batches` rows (215 on 2026-10-27) get `staff_batch` default false; ~20-40 candidates to flip (unknown until dry run) | Migration 0008 + owner-reviewed backfill (data migration, not code edit) |
| Live service config | Apps Script sheet has no `staff_batch` column and must not get one (PG-only) | None - verified by exclusion from `BATCH_COLUMNS`/mirror/parity tests |
| OS-registered state | None - verified: no scheduled tasks reference batch columns | None |
| Secrets/env vars | None new. Backfill uses existing `BACKFILL_DATABASE_URL` | None |
| Build artifacts | `js/brewpad.min.js`, `css/brewpad.min.css`, `brewpad.html` version stamps regenerate via `npm run build` | Run build; commit artifacts |
| Browser state | Per-device localStorage keys `bp_dash_v2`, `bp_dash_filters` (new); Home Screen PWA storage is separate from Safari | Opt-in via in-app button on the iPad |

## Common Pitfalls

### Pitfall 1: Sticky offset double-counts the shell bar
**What goes wrong:** UI spec says `top: var(--bp-shell-height)` (56px). But the scroll container is `.bp-panel` (`position:absolute; inset:0; overflow-y:auto`, css:313), a child of `.bp-panels` which sits *below* the shell bar. The shell bar is not inside the scroller. With `top:56px` the filter bar would stick 56px below the top of the panel, leaving a visible gap that content scrolls through.
**How to avoid:** Use `position: sticky; top: 0` inside `#bp-dashboard-inner` (or adjust: if the planner nests the bar elsewhere, recompute). Verify in the phone-width harness and on the iPad. Treat the UI-spec value as a spec bug and record the deviation in the plan. Also `.bp-panel-inner` has `max-width:900px; padding:16px`; make the bar's background span via negative margin or put it outside `.bp-panel-inner`. [VERIFIED: css/brewpad.css:300-325, brewpad.html:66]
**Warning signs:** A gap above the bar when scrolled, or the bar vanishing under the shell on iOS.

### Pitfall 2: Whole-dashboard re-render destroys charts and filter focus
**What goes wrong:** `renderDashboard()` is called by `eagerLoad`, `loadDashboard` (every 5 min and on tab re-entry when stale), `loadWineSnapshot`. A naive v2 that rewrites `innerHTML` leaks Chart instances (each holds a canvas, listeners, a ResizeObserver) and closes the open picker/sheet.
**How to avoid:** Persistent shell (Pattern 2); `chart()` destroys by `Chart.getChart(canvas)`; also destroy all v2 charts when switching back to v1.

### Pitfall 3: Charts drawn into a hidden panel measure 0x0
**What goes wrong:** `switchTab` hides non-active panels with `display:none`. `eagerLoad` can finish while another tab is active, and Chart.js with `responsive:true` sizes from the container. The canvas renders blank until a resize.
**How to avoid:** In `switchTab('dashboard')` call `resize()` on live v2 charts (or re-render); tests: switching tab triggers `chart.resize`.

### Pitfall 4: Lazy script load race / failure
**What goes wrong:** Render requests Chart before the script loads; or load fails offline (the iPad is a PWA).
**How to avoid:** `loadChartJs()` promise; tiles and filters render immediately (they do not need Chart.js); widget slots show `Loading charts…`, then charts, or the failure copy. Cache one promise; on failure clear it so a re-open retries. No service worker exists (no `serviceWorker` in brewpad.html), so the vendor file is cached by the browser HTTP cache only; cache-bust with `?v=4.5.1`.

### Pitfall 5: Drill count drifts from the tapped number
**What goes wrong:** Chart bucket counts computed from `_dashData.batches` (aggregate) but the list built from `_allBatchesData` (`get_batches`), loaded at a different time; or the default `'active'` chip narrows the set.
**How to avoid:** Id sets from the aggregate; list = `_allBatchesData` intersect set; set `_batchStatusFilter='all'` on drill entry; banner N from the set; list heading from the intersection; handle `_allBatchesData` emptied by `afterBatchWrite`.

### Pitfall 6: Stacked-bar click is ambiguous
**What goes wrong:** With `mode:'index', intersect:false` (needed so phone taps work) `onClick` receives *all* datasets at that index, so you cannot tell which type segment was tapped.
**How to avoid:** First `getElementsAtEventForMode(evt,'nearest',{intersect:true},true)`; if one element, drill to (that dataset's type, that bucket); else fall back to `getElementsAtEventForMode(evt,'index',{intersect:false},true)` -> index only -> whole bucket (all types under the current Type filter), banner wording "Started in {bucket}". Specify this explicitly in the plan; the UI spec ("full column via mode:index") and D-14 both need it. [CITED: chartjs.org/docs/latest/developers/api.html]

### Pitfall 7: Hash / localStorage state bugs
**What goes wrong:** Hash edited by hand with garbage, `from>to`, or `to` in the future; localStorage unavailable; replaceState does not fire `hashchange`, so a pasted-while-open URL is ignored unless handled.
**How to avoid:** Whitelist-parse; try/catch around storage; listen for `hashchange` and re-apply; test invalid inputs. `history.replaceState(null,'', '#...')` also preserves the `?dash=v2` search part - build the URL from `location.pathname + location.search + '#...'`.

### Pitfall 8: Source option list misses real values
**What goes wrong:** The D-04 list (kiosk, online, manual, zoho_scan, research, internal, Unknown) omits `kiosk_recipe`, a real `source` written by `lib/brewpad-integration.js:864` (kiosk recipe sales) and referenced at js/brewpad.js:234,878. Those batches would be unselectable under any option except "All", and the sum of the per-source views would not equal "All".
**How to avoid:** Map `kiosk_recipe` into the **Kiosk** option (match `kiosk` or `kiosk_recipe`); map any other non-empty unrecognised value into a catch-all that is shown as "Other" only if present in data (or fold into Unknown). Ask the owner (OQ3). Add a test: sum over options == total.

### Pitfall 9: Staff toggle semantics
**What goes wrong:** Applying the staff toggle to tiles/month chart contradicts D-10 / Phase 94 D-12 (staff count toward production and cycle time).
**How to avoid:** Selection function takes `opts.mix`; only the wine breakdown passes `mix:true` in this phase. The toggle state is global but consumed only by mix widgets. Test that tiles are identical with the toggle on and off.

### Pitfall 10: Colour distinctness (gold vs amber)
`--chart-cider #a8841a` vs `--chart-beer #9a4e0c`: distinct in hue, but both warm and dark; the UI spec already requires a 2px `--cellar-raised` separator between stacked segments (default always add). Confirm visually on the iPad (listed as an open item in the UI spec). Never rely on colour alone: tooltips name the type.

### Pitfall 11: ES5 and lint
No `let/const/=>`/template strings/`Array.prototype.includes`/`Object.entries` (ecmaVersion 5 lint; `Object.assign` is only used in the export block today). Keep `for` loops and `function` expressions. Terser (`-c -m`) runs on brewpad.js; ES5 only.

### Pitfall 12: Existing wine-breakdown periods use their own state
`_dashWinePeriod`, `_dashWineDimension`, the v1 chips and `_dashChartHiddenTypes` are separate from the new global filters. In v2 the wine breakdown follows the **global** Period/Type/Source (UI spec "Re-hosted widgets"), keeping its subcategory/brand/manufacturer/time dimension chips as a widget-local control. Do not write the v1 state variables from v2.

## Code Examples

### ES5 selection + buckets (extension of getDashboardData)
```javascript
// Source: derived from js/brewpad.js:475 (Phase 94) - ES5, no wall clock
function weekStartOf(ymd) {                       // Monday on or before ymd
  var dow = (dayNumber(ymd) + 3) % 7;             // 0 = Monday (1970-01-01 was Thursday)
  return addDays(ymd, -dow);
}
function bucketKeyOf(ymd, group) {
  return group === 'week' ? weekStartOf(ymd) : String(ymd).slice(0, 7);
}
function sourceMatches(row, want) {               // want: 'all' | 'unknown' | 'kiosk' ...
  if (!want || want === 'all') return true;
  var s = normBatchSource(row.source);
  if (want === 'unknown') return s === '';
  if (want === 'kiosk') return s === 'kiosk' || s === 'kiosk_recipe';   // OQ3
  return s === want;
}
function batchLitres(row, kind, type) {           // kind: 'started' | 'completed'
  var v = row.target_volume_l;
  if (typeof v === 'number' && isFinite(v) && v > 0) return { l: v, est: false };
  var l = 23;
  if (type === 'beer') l = kind === 'completed' ? 25 : 28;
  return { l: l, est: true };                     // seltzer/other: 23 (OQ1)
}
```

### chart() helper (ES5)
```javascript
// Source: Chart.js 4 API [CITED: chartjs.org/docs/latest/developers/api.html]
var _chartJsPromise = null;
function loadChartJs() {
  if (typeof window !== 'undefined' && window.Chart) return Promise.resolve(window.Chart);
  if (_chartJsPromise) return _chartJsPromise;
  _chartJsPromise = new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    s.src = 'js/vendor/chart.umd.min.js?v=4.5.1';
    s.onload = function () { resolve(window.Chart); };
    s.onerror = function () { _chartJsPromise = null; reject(new Error('chart load failed')); };
    document.head.appendChild(s);
  });
  return _chartJsPromise;
}
function chart(canvas, cfg) {
  var Chart = window.Chart;
  var prev = Chart.getChart ? Chart.getChart(canvas) : null;
  if (prev) prev.destroy();
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var inst = new Chart(canvas, {
    type: cfg.type,
    data: { labels: cfg.labels, datasets: cfg.series.map(function (s) {
      return { label: s.label, data: s.data, backgroundColor: s.colour, borderColor: cfg.separator,
               borderWidth: cfg.stacked ? 2 : 0, borderRadius: 3, borderSkipped: false, _key: s.key };
    }) },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: reduce ? false : { duration: 200 },
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false } },
      scales: cfg.type === 'doughnut' ? {} : {
        x: { stacked: !!cfg.stacked }, y: { stacked: !!cfg.stacked, beginAtZero: true, ticks: { precision: 0 } } },
      onClick: function (evt, _els, ch) {
        var hit = ch.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, true);
        if (hit.length) return cfg.onClick({ index: hit[0].index, key: ch.data.datasets[hit[0].datasetIndex]._key });
        var col = ch.getElementsAtEventForMode(evt, 'index', { intersect: false }, true);
        if (col.length) cfg.onClick({ index: col[0].index, key: null });
      }
    }
  });
  return inst;
}
```
(The helper must keep `Chart.getChart` guarded; the Jest fake provides it. `precision:0` gives integer ticks for the batches measure only; switch to a litres tick callback for litres.)

### Hash parse (whitelist, replaceState)
```javascript
var DASH_DEFAULTS = { type: 'all', period: 'ytd', group: 'month', measure: 'batches', source: 'all', staff: '0', from: '', to: '' };
function parseDashHash(hash) {
  var out = {}, k;
  String(hash || '').replace(/^#/, '').split('&').forEach(function (kv) {
    var i = kv.indexOf('='); if (i < 1) return;
    out[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
  });
  return out;   // then validate each against whitelists; invalid -> default
}
function writeDashHash(state) {
  var parts = [], k;
  for (k in DASH_DEFAULTS) { if (state[k] !== DASH_DEFAULTS[k]) parts.push(k + '=' + encodeURIComponent(state[k])); }
  var url = location.pathname + location.search + (parts.length ? '#dash=v2&' + parts.join('&') : '#dash=v2');
  history.replaceState(null, '', url);
}
```
(`decodeURIComponent` throws on malformed input: wrap in try/catch.)

### Staff update branch (middleware)
```javascript
// In updateBatch, alongside the batch_type block (batch-pg-update.js ~:328)
var staffSet = null;
if (updates.staff_batch !== undefined) {
  var sv = updates.staff_batch;
  if (sv === true || sv === 'true') staffSet = true;
  else if (sv === false || sv === 'false') staffSet = false;
  else return fail('invalid_input', 'staff_batch must be true or false');
}
// ... later, with the other sets
if (staffSet !== null) addSet('staff_batch', staffSet);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| v1 hand-built CSS bars + inline-styled legend | Chart.js canvas via `chart()` | Phase 95 | Tooltips, hit-testing, resize |
| Month buckets independent of window (`monthBuckets`) | Window-clipped, week/month, id-carrying buckets | Phase 95 | Chart total == tile |
| Staff detected by customer name | Explicit `staff_batch` | Phase 95 (D-08) | Reliable mix views |
| Chart.js 3 -> 4 | `Chart.getChart(canvas)` replaces `chart.destroy` bookkeeping | v3/v4 | Safe re-render |

**Deprecated/outdated:** `bucketBatchesByMonthType` (uses wall clock; v1 only). `dashboardWindow('6mo'/'12mo')` names differ from UI labels.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Home Screen PWA localStorage is separate from Safari's on iOS, so `?dash=v2` in Safari does not opt in the installed PWA | Filter state | Low; the in-app button handles both cases. Confirm on the shop iPad |
| A2 | Seltzer/other litres default 23 L is acceptable | Litres (OQ1) | Over/under-states litres for those rare types; flagged estimated in UI |
| A3 | `kiosk_recipe` should roll into the "Kiosk" option | Pitfall 8 (OQ3) | Kiosk-recipe batches mis-attributed or unselectable |
| A4 | iPad Safari version supports ES2015 classes + ResizeObserver (Safari 13.1+) used by Chart.js 4.5.1 | Standard Stack | Charts fail to load on an old iPad; failure copy shows, tiles still work. Check iPadOS version |
| A5 | Customer-name candidate matching (McLachlan, Inn) as whole words is what the owner means; false positives caught in the dry run | Staff backfill | Wrong batches flagged if owner skims the list |
| A6 | Setting `staff_batch` when a batch is flipped manual->internal later (OQ2) | Staff flag | Mix views include/exclude inconsistently vs create-time rule |
| A7 | Mobile Safari tap fires Chart.js `onClick` reliably with `intersect:false` index mode | Pitfall 6 | Click-through fails on touch; needs iPad UAT, fallback is tap-to-tooltip then tap-tooltip |
| A8 | Timezone tests: `America/Vancouver` DST dates quoted (Mar 8, Nov 1 2026) | Tests | Test date choice only |

## Open Questions (RESOLVED)

1. **OQ1 Seltzer/other litres default (CONTEXT D-11).**
   - Known: wine/cider 23 L; beer 28/25 L; seltzer and other have no stated volume; `target_volume_l` is empty everywhere; seltzer/other are rare.
   - Unclear: owner's intended default.
   - Recommendation: 23 L, always marked "estimated"; ask the owner at plan review or accept as a one-line constant (`DASH_DEFAULT_LITRES`).
   RESOLVED: D-17 — seltzer and other use 23 L, labelled as an estimate (plan 95-03 batchLitres; plan 95-08 subtitle note).
2. **OQ2 Staff flag on later source flip.** Auto-set on create is locked; should `manual -> internal` via "Mark internal" set the flag? Recommend yes (set only, never clear), owner confirm.
   RESOLVED: D-19 — auto-set on create only; a later source edit does not set it (overrides the recommendation above). Plan 95-01 tests the source flip leaves staff_batch false.
3. **OQ3 `kiosk_recipe` and other source values in the Source filter.** D-04 list omits `kiosk_recipe`. Recommend Kiosk = kiosk + kiosk_recipe; any other unrecognised value shown in an "Other" option only when present. Owner confirm.
   RESOLVED: D-16 — `kiosk_recipe` counts under the Kiosk option; no separate option (plan 95-03 sourceMatches).
4. **OQ4 Cycle-time tile click-through.** Clicking "Days to complete" - drill to the contributing batches (completed with span in window) or non-clickable? UI spec lists every tile as clickable. Recommend drill to those ids and say so in the banner.
   RESOLVED: the cycle-time tile is clickable and drills to the contributing ids (`ids.cycle`) — plan 95-08 (ids from plan 95-03).
5. **OQ5 Backfill write: bump `last_updated` or not.** Recommended: not (avoids replay). If the planner/owner prefers going through `updateBatch`, replay of N batches at ~14 s each is required first.
   RESOLVED: D-18 — direct write to the Postgres-only column via `setStaffBatch`, no `last_updated` bump, no replay; `batches-verify` must still show 0 mismatches (plans 95-01, 95-02, 95-11).
6. **OQ6 Sticky offset.** UI-spec `top: var(--bp-shell-height)` appears wrong for this layout (Pitfall 1). Confirm on device; use `top:0`.
   RESOLVED: `top: 0` inside `.bp-panel` (planner-resolved discretion item), implemented in plan 95-06 and checked on the iPad in plan 95-10. (Related PWA opt-in concern A1: resolved by the in-app switch button plus `?dash=v2`, plan 95-06.)

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 24 | engines, tests | yes (v24.21.0 installed via nvm; shell default is v20.20.2) | 24.21.0 | `nvm use 24` |
| npm registry access | vendor download | yes | - | - |
| Docker daemon | `test:db` Testcontainers (postgres:16) | CLI present (28.0.2); daemon not confirmed | - | CI runs test:db; local unit tests do not need it |
| slopcheck | package check | yes (pip, /opt/anaconda3/bin) | - | - |
| Playwright / browser | e2e / sticky UAT | repo has tests/e2e; not exercised | - | Manual staging UAT on iPad |
| Railway CLI + prod container | staff backfill apply | per memory yes; in-container only | - | - |
| gemini CLI | global CLAUDE.md suggestion | no (broken per memory) | - | grep + Read |

**Missing dependencies with no fallback:** none.

## Security Domain

(`security_enforcement` is enabled; ASVS level 1.)

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no change | existing sv_session / Google sign-in |
| V3 Session Management | no change | existing |
| V4 Access Control | yes | `update_batch` / `get_dashboard_stats` already behind `authTiers.requireTiers(['legacy','session'])` (routes/pos.js:4345); device tier rejected |
| V5 Input Validation | yes | server whitelists `staff_batch` boolean; client whitelists hash/localStorage values and validates dates; escape all rendered text with `escapeHTML` |
| V6 Cryptography | no | - |
| V12 Files/Resources | yes | vendored third-party JS: pinned version + recorded SHA-256, no CDN |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| DOM XSS via crafted URL hash (filter values, banner label) | Tampering / Elevation | Whitelist parse; render labels via `escapeHTML`/`textContent`, never raw hash into `innerHTML` |
| Supply-chain tamper of vendored Chart.js | Tampering | Pin 4.5.1, record SHA-256 in js/vendor/README.md + commit, verify in a plan task |
| Customer PII leak through the aggregate | Info disclosure | Keep `DASH_STATS_BATCHES_SQL` a column whitelist; add only `b.staff_batch`; test asserts no `customer_*` keys (existing Phase 94 test is the model) |
| Client forging staff flag at create | Tampering | Server derives it from source; never read from payload |
| SQL injection in backfill candidate query | Tampering | Constant SQL, parameterised name patterns (`ILIKE` with bound params) |
| Backfill run against wrong env | Tampering | `BACKFILL_DATABASE_URL` env only, refuses URL on argv, `--expect=N` |

## Sources

### Primary (HIGH confidence)
- Repository code read this session: js/brewpad.js (data layer :357-:605, renderDashboard :4332, renderBatchList :5029, switchTab :3170, initDelegation :11040, detail pane :6695, exports :12136-:12399), css/brewpad.css (:300-325), brewpad.html, package.json, eslint/jest config, zoho-middleware/lib/{batch-pg-read,batch-pg-create,batch-pg-update,batch-rules,batch-store}.js, scripts/backfill/{batch-type-backfill,batches-replay-to-sheet,batches-parity}.js, scripts/migration-allowlist.js, migrations/0007_batch_type.sql, docs/RUNBOOK.md (Phase 94 section)
- npm registry (`npm view chart.js`, `npm pack chart.js@4.5.1/4.6.1`, bundle inspection, SHA-256) and npm downloads API
- slopcheck [OK] for chart.js
- https://www.chartjs.org/docs/latest/developers/api.html (getElementsAtEventForMode, destroy, Chart.getChart)
- https://www.chartjs.org/docs/latest/configuration/interactions.html (onClick signature, index/nearest modes, intersect)

### Secondary (MEDIUM confidence)
- Phase 94 memory notes (replay CLI timing ~14 s/batch; production one-off driver)

### Tertiary (LOW confidence)
- iOS Home Screen web-app storage isolation and tap behaviour in Chart.js (training knowledge; verify on the iPad)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - package verified end to end (registry, tarball, hash, licence, bundle contents)
- Architecture: HIGH - every integration point read in source; migration guard run locally
- Pitfalls: MEDIUM-HIGH - sticky offset and drill chip issues derived from code; iPad touch behaviour needs UAT

**Research date:** 2026-10-27
**Valid until:** 2026-11-26 (stable); re-check Chart.js latest only if 4.6.x is wanted (4.6.1 passes the 2-week rule on 2026-11-05)
