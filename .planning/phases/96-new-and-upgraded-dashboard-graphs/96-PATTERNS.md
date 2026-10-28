# Phase 96: New and upgraded dashboard graphs - Pattern Map

**Mapped:** 2026-10-28
**Files analyzed:** 14 (new or modified)
**Analogs found:** 14 / 14 (all in-repo; no analog for a few sub-pieces, see end)

All line numbers are for the working tree on 2026-10-28 (HEAD 1c1a9488). `js/main.js` / `js/main.min.js` are not touched: `js/brewpad.js` is a source file (it is NOT one of the numbered modules), edit it directly and run `npm run build` afterwards for the CSS/JS stamp, reverting unrelated re-stamped files.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `zoho-middleware/lib/batch-pg-read.js` (extend `getDashboardStats`: task titles + completed tasks, all readings, vessels, `recipe_snapshot` fields) | service (SQL read) | request-response, batch read | same file, `DASH_STATS_*_SQL` + `getDashboardStats` (L73-307) | exact (extend) |
| `zoho-middleware/lib/batch-store.js` (`dashStats` memo, only if new fields need enrichment) | service | request-response + 60 s memo | same file L146-171 | exact (probably unchanged) |
| `zoho-middleware/__tests__/db/batch-pg-dashboard-stats.test.js` (new key-set / new SQL cases) | test (real PG) | request-response | same file (extend) | exact |
| `zoho-middleware/__tests__/batch-store-dash-stats.test.js` (memo + enrichment with new fields) | test (mocked) | request-response | same file (extend) | exact |
| `js/brewpad.js` pure data helpers (new, exported): G1-G10 model builders, `dashWidgetShell`/table model builders, task-kind classifier, stage mapper, histogram bins | utility (pure ES5) | transform | `getDashboardData` (L582+), `wineBreakdownBuckets` (L1318), `periodSkeleton` (L504), `buildDashV2Model` (L1173) | exact |
| `js/brewpad.js` widget renderers `renderDashV2*` (G1..G10) inside the IIFE | component (DOM + Chart.js) | event-driven render | `renderDashV2PeriodChart` (L5460), `renderDashV2Wine` (L5523), `renderDashV2Widgets` (L5588) | exact |
| `js/brewpad.js` shell/slots in `renderDashboardV2` (4 headed sections, `.bp-dash-grid`) | component | render | `renderDashboardV2` (L5798-5817) | exact (extend) |
| `js/brewpad.js` event handlers (`onDashV2Click/Change/Keydown`: view toggle, option segs, Show all, accordion, table-link drills) | controller (delegated events) | event-driven | `onDashV2Click` (L5669+), `data-dash-wine-dim` branch (L5688) | exact (extend) |
| `js/brewpad.js` `chart()` extensions (dashed line datasets, data labels, 100% stack, per-point colour, line `onClick` returning dataset index) | utility | transform | `chart()` (L1415-1537) | exact (extend, keep signature) |
| `js/brewpad.js` module.exports test seam (bottom of file) | config | n/a | L13942+ `Object.assign(module.exports, {...})` block (entries at L13980-14015: `wineBreakdownBuckets`, `chart`, `dashDrillLabel`) | exact |
| `js/brewpad.js` state fields for new data (`_dashData` carries new arrays; `_dashV2Charts` keys per widget) | store | in-memory | `_dashData` (L2237), `_dashV2Model` (L2242), `_dashV2Charts` (L2246), `dashAggregateFromStats` (L5004) | exact |
| `css/brewpad.css` (six `--chart-cat-*` tokens, `.bp-dash-section-title`, `.bp-dash-grid`, `.bp-widget-head`, `.bp-table`, list rows, accordion) | config (styles) | n/a | `:root` chart tokens (L40-44), `.bp-widget*` block (L3062-3081), `.bp-seg*` (L3021-3033), Phase 95-08 block (L3070+) | exact |
| `brewpad.html` (only if slots live in HTML; they do not today, `renderDashboardV2` injects them) | config | n/a | none needed | n/a |
| `tests/frontend/brewpad-dashboard-v2-<family>.test.js` (one file per widget family: production G1-G3, floor G5-G8, products-sales G4/G9, data-health G10, copy guard) | test (jsdom) | n/a | `tests/frontend/brewpad-dashboard-v2-widgets.test.js` | exact |

## Pattern Assignments

### `zoho-middleware/lib/batch-pg-read.js` (service, request-response)

**Analog:** same file, Phase 94/95 aggregate. Extend, do not replace; keep per-row column whitelist (no `select *`, no `customer_*`, `notes`, `access_token`, snapshot columns raw).

**SQL constants pattern** (L73-99). Module-level constants, `$1` = timezone, explicit columns:
```javascript
var DASH_STATS_TASKS_SQL =
  'select t.batch_id, t.task_id, to_char(t.due_date, \'YYYY-MM-DD\') as due_date, t.completed, ' +
  "to_char(t.completed_at at time zone $1, 'YYYY-MM-DD') as completed_day, " +
  't.is_packaging, t.is_transfer ' +
  'from batch_tasks t join batches b on b.batch_id = t.batch_id ' +
  "where b.status in ('primary', 'secondary') order by length(t.task_id), t.task_id";
var DASH_STATS_READINGS_SQL =
  'select distinct on (r.batch_id) r.batch_id, r.reading_at, r.degrees_plato, r.temperature, r.ph ' +
  'from plato_readings r join batches b on b.batch_id = r.batch_id ' +
  "where b.status in ('primary', 'secondary') order by r.batch_id, r.reading_at desc";
```
Gaps to fill (CONTEXT "Integration Points"): add `t.title` to the task select (G5); add a second, windowed completed-task read (G7 completions over time, e.g. last 12-24 months of `completed = true`, `title`, `completed_day`) rather than all history; add an all-readings query for active beer/cider batches (G8; drop `distinct on`, keep the `status in ('primary','secondary')` join, order by `batch_id, reading_at`); add a vessels query (`vessel_id, type, capacity_liters, archived` from migration 0004 `vessels`, L25-39); add `ferm_schedules`-derived planned length and `recipe_snapshot` OG/target FG fields as narrow derived columns (parse in JS in `getDashboardStats`, do not ship the raw snapshot text). Check that `batch_tasks` has a `title` column (0005_batches.sql L76: `title text not null default ''`) and `plato_readings` columns (L91-101).

**Composition pattern** (L268-307): sequential `.then` chain on one client, numeric coercion via `numOrNull`, return added arrays beside the existing keys:
```javascript
  }).then(function (res) {
    out.latestReadings = res.rows.map(function (r) {
      r.degrees_plato = numOrNull(r.degrees_plato);
      ...
      return r;
    });
    return client.query(DASH_STATS_STAFF_SQL);
  })
  ...
    return ok({ asOf: {...}, batches: out.batches, tasks: out.tasks, latestReadings: out.latestReadings,
                staffBatchIds: out.staffBatchIds, summary: summary.data });
```
Add new keys (e.g. `completedTasks`, `readings`, `vessels`) to the `ok({...})` object. Existing keys must keep their shape (v1 and Phase 95 widgets read them). `numeric` columns arrive as strings: coerce with `numOrNull`.

**Note:** the frontend already fetches `get_vessels` in the eager load (L4935-4939, `r2`). Planner should weigh using that for G6 against adding `vessels` to the aggregate; the aggregate keeps G6 inside the 60 s memo and one request, and the stale-cache guard (below) is simpler if everything comes from one payload. CONTEXT marks this as Claude's Discretion.

---

### `zoho-middleware/lib/batch-store.js` (service, memoised read)

**Analog:** same file L146-171 (`dashStats`). Only touched if new fields need joining from the kiosk product index (G4 beer style / recipe, cider recipe may need `cf_*` data; classify by `cf_type`/SKU, never by name).
```javascript
function dashStats() {
  if (!isPostgres()) return Promise.resolve(null);
  if (_dashMemo && _clock() - _dashMemo.at <= DASH_MEMO_TTL_MS) { return Promise.resolve(_dashMemo.value); }
  var gen = _dashGen;
  return dispatch('dashStats', function (client) {
    return pgRead().getDashboardStats(client, { now: new Date() });
  }).then(function (value) {
    if (!value || !value.ok) return value;
    return typeHints().kioskProductIndex().catch(function () { return {}; }).then(function (index) {
      var idx = index || {};
      value.data.batches.forEach(function (row) {
        var hit = idx[row.product_sku];
        if (hit) { row.product_subcategory = hit.cf_subcategory || ''; ... }
      });
      if (gen === _dashGen) _dashMemo = { at: _clock(), value: value };
      return value;
    });
  });
}
```
Enrichment must stay failure-tolerant (`.catch(function () { return {}; })`) and respect the `_dashGen` race guard.

---

### Middleware tests (test)

**Analog 1:** `zoho-middleware/__tests__/db/batch-pg-dashboard-stats.test.js` (real PG, `npm run test:db`). Pattern: `describeDb`, `pgHarness.startPostgres/applyMigrations`, `rollbackEachTest`, `insertBatch(n, fields)` / `insertTask(...)` helpers (L51-70), and a `LEAN_KEYS` sorted whitelist assertion (L8-14). Extend `LEAN_KEYS` only for new per-batch columns; add cases for: task `title` present, completed-task window, all readings for active batches only, vessels incl. archived flag, no customer_* leakage.

**Analog 2:** `zoho-middleware/__tests__/batch-store-dash-stats.test.js` (mocked): `jest.mock('../lib/batch-pg-read', ...)`, `stats()` fixture, `_setDashClockForTest` / `_clearDashMemoForTest`. Extend the `stats()` fixture with the new arrays and assert memo + enrichment still work.

**Route allow-list:** `routes/pos.js` L4300 / L4338 already allow `get_dashboard_stats`; no route change if the action name stays. A new action would need entries in both maps and `batch-proxy.js` `STATS_ACTION_TO_OP` (L42); prefer extending the existing action. Pitfall (memory): reads may retry, writes must not; this is a read.

---

### `js/brewpad.js` pure data helpers (utility, transform)

**Analog:** `getDashboardData` + `wineBreakdownBuckets` + `periodSkeleton`. Pure ES5 (`var`, `function`, no arrow/let/const/template strings), exported through the module.exports seam, jsdom-tested.

**Selection layer to reuse (do not re-classify rows):** `getDashboardData` L582-615 applies type once, via `effectiveBatchType(r, catMap)`, then `sourceMatches`:
```javascript
var t = effectiveBatchType(r, catMap);
var rStatus = String(r.status || '').toLowerCase();
...
if (typeFilter !== 'all' && t !== typeFilter) continue;
if (!sourceMatches(r, f.source)) continue;
items.push({ row: r, type: t, status: rStatus });
```
and per-bucket id sets (L617-625: `idSets.startedByType`, `idSets.completedByType`, `litres.*ByType`, `periodBuckets` with `ids: emptyTypeLists()`, `counts`, `litres`, `all`). G1 "Completed" mode needs a completed-bucket twin of `periodBuckets` (Phase 94 D-18: completion bucketed by `completed_day`, `status === 'complete'` only, see CR-01 comment at L682). G2 pipeline, G3 histogram, G6, G10 need active-status groupings; add them as new fields on the `getDashboardData` return or as separate pure functions that take `cur`/`rows` so type totals agree across widgets (Phase 94 D-20). Prefer separate pure functions over growing `getDashboardData` where the widget ignores filters (G6, G10).

**Constants to reuse** (L361-363): `DASH_STARTED_STATUSES`, `DASH_TYPE_LABELS`, `DASH_MONTH_LABELS`. Dates: `dayNumber`, `addDays`, `weekStartOf`, `periodSkeleton(start, end, group)` (L504-528) for Monday-Sunday buckets and Vancouver calendar dates; never `new Date()` for day maths (use `asOf.today`). Stats: `medianOf`, `meanOf`, `cycleDays(start, completed)` (L378-385) for G3 and the median in its subtitle.

**Breakdown builder to generalise for G4** (L1318-1358): signature `wineBreakdownBuckets(rows, skuLookup, dimension, topN)` returns `[{label, count, ids}]`, with Unknown-last and `Other` roll-up. D-16/UI-SPEC want `Unspecified` and `Other ({n} more)` and beer/cider dimensions: write a new generic `dashBreakdownBuckets(rows, valueOf, topN)` that takes an accessor instead of a SKU lookup, keep `wineBreakdownBuckets` untouched (v1 and existing tests call it), and feed the wine accessor from `mergeWineSkuLookup` (L1288).
```javascript
var product = skuLookup ? skuLookup[String(r.product_sku)] : null;
var dv = product ? product[dimension] : null;
if (!product || dv === null || dv === undefined || String(dv).trim() === '') { unknownIds.push(r.batch_id); continue; }
```

**Delta/label helpers:** `formatDelta` (L1230), `dashDrillLabel` (L1265), `dashGroupThousands` (L1206). `dashDrillLabel` only knows verbs `fermenting`, `cycle`, and `started/completed` with `bucketLabel`; UI-SPEC banner copy for G2 ("Beer at Secondary"), G3 ("completed in 21-27 days"), G5 ("Racking due Nov 4"), G6, G7, G9, G10 does not fit. Either extend `dashDrillLabel` with new `verb` branches or add a sibling `dashDrillLabel2(subject, count)` that returns `'From dashboard: ' + subject + ' · ' + count + (count === 1 ? ' batch' : ' batches')`. Keep the existing branch behaviour (existing tests lock it) and keep the `' batch'`/`' batches'` singular/plural from L1280.

**Pure shell helpers (UI-SPEC "Implementation Notes"):** `widgetShell`, `viewToggle`, `dataTable`, `listRows` should be pure functions returning HTML strings (escape every dynamic string with the existing `escapeHTML`, as at L5455), with the table and chart built from one model object ("one model, two renderers").

**Planner decisions this phase must pin:** task-kind classifier (`is_transfer` or title match -> `Racking / transfer`; `is_packaging` or Bottling/Packaging -> `Packaging`; "Lower to"/"Crash to" -> `Temperature step`; Filtering; else Other); G2 status-to-stage map (stored statuses are `pending|primary|secondary|complete|...`; "Ready to bottle" is a task-derived state in the existing summary `readyToBottle`, see `buildDashboardSummary`, so it needs a real definition and an `Other stage` bucket); G3 7-day bins with a p95 cap; G10 five category predicates (no `zoho_so_number`, blank `source` via `normBatchSource`, stale > 90 days, no `completed_at` on `status === 'complete'`, no `vessel_id` on active).

---

### `js/brewpad.js` widget renderers (component, render + Chart.js)

**Analog:** `renderDashV2PeriodChart` (L5460-5521) and `renderDashV2Wine` (L5523-5586). Copy this skeleton for every graph.

**Widget scaffold** (L5408-5418) is created once per slot, then reused:
```javascript
function dashV2Widget(slotId, title) {
  var slot = document.getElementById(slotId);
  if (!slot) return null;
  if (!slot.firstChild) {
    slot.innerHTML = '<div class="bp-widget"><h2 class="bp-widget-title"></h2><p class="bp-widget-sub"></p>' + ... +
      '<div class="bp-widget-body"></div></div>';
    slot.querySelector('.bp-widget-title').textContent = title;
  }
  return slot;
}
```
UI-SPEC changes the markup to `.bp-widget-head > .bp-widget-titles (h3.bp-widget-title + p.bp-widget-sub) + .bp-widget-controls`, widget title demoted to 14px, and an `h2.bp-dash-section-title` per section. Migrating `dashV2Widget` changes the DOM that `brewpad-dashboard-v2-widgets.test.js` queries (`#bp-dash-v2-period canvas`, `#bp-dash-v2-wine canvas`, `.bp-widget-title`, `.bp-widget-chips`): CLAUDE.md rule 10 forbids editing existing tests unless asked, so keep slot ids `bp-dash-v2-period` / `bp-dash-v2-wine` and `.bp-widget-title`/`.bp-widget-sub` class names on the migrated G1/G4 widgets, or have the owner OK a test update. Flag this to the planner.

**State machine helpers to reuse as is:** `dashV2Msg(slotId, key, title, msgHtml)` (empty/loading/error body, destroys the chart), `dashV2EmptyHtml()` (`No batches match these filters.` + `Reset filters` button with `data-dash-reset`), `dashV2Canvas(slotId, title)` (persistent canvas + `.bp-chart-legend`, `data-state="chart"`), `destroyDashV2Slot(key)`, `dashV2LegendHtml(items)`.

**Chart call + drill pattern** (L5501-5520), the template for every bar/segment click:
```javascript
_dashV2Charts.period = chart(el.canvas, {
  type: 'bar', labels: labels, series: series, stacked: true,
  measure: lit ? 'litres' : 'batches', tooltipTotal: true,
  ariaLabel: (...) + parts.join(', '),
  onClick: function (hit) {
    var m = _dashV2Model;
    var bk = m && m.cur.periodBuckets[hit.index];   // read the CURRENT model, not a closed-over one
    if (!bk) return;
    var ids; ...
    openDashDrill({ ids: ids.slice(), label: dashDrillLabel({ typeLabel: typeLabel, verb: 'started', bucketLabel: bk.label, count: ids.length }) });
  }
});
```
Rules carried from here: `onClick` receives `{index, key}` (key = series `key`); always read `_dashV2Model` inside the handler (the chart outlives a re-render); store the chart in `_dashV2Charts[<key>]` so `destroyDashV2Slot`/`resizeDashV2Charts` (L5620) cover it. A drill resolving to one batch must call the existing batch-detail opener instead of `openDashDrill` (UI-SPEC); find it via `grep -n "function openBatchDetail\|function showBatchDetail" js/brewpad.js` before planning.

**Render orchestration** (L5588-5618), pattern for the Chart.js lazy load, the `_dashV2Seq` stale-render guard, and failure handling:
```javascript
var seq = ++_dashV2Seq;
if (model.cur.started === 0) { renderDashV2PeriodChart(model); renderDashV2Wine(model); return; }
if (!window.Chart) { dashV2Msg(..., 'Loading charts…'); }
function fail() { dashV2Msg(..., 'Charts could not load. Reload the page to try again.'); }
loadChartJs().then(function () {
  if (seq !== _dashV2Seq || !isDashV2()) return;
  try { renderDashV2PeriodChart(_dashV2Model); renderDashV2Wine(_dashV2Model); } catch (e) { fail(); }
}, function () { if (seq !== _dashV2Seq || !isDashV2()) return; fail(); });
```
Phase 96 must keep this guard. Non-chart parts (tables, lists G6/G8/G10, Table view) must render even when Chart.js fails (UI-SPEC). Note the early `cur.started === 0` return: G5-G8, G10 ignore Period/started filters, so they must not be gated on `cur.started`.

**Empty-before-data pitfall** (95-REVIEW): never render `0` before data exists; see the `showDashV2NoData` path in `refreshDashV2` (L5321-5329). Stale-cache guard: each new widget checks the presence of its server array (`_dashData && _dashData.completedTasks` etc.) and renders `Not available yet. Reopen the Dashboard tab to refresh.` through `dashV2Msg`.

**Legend/colour source:** `readChartTheme()` (L1365-1387) memoises token values; add the six `--chart-cat-*` tokens and ink ramp colours there (with hex fallbacks, same `v('--name', '#fallback')` form). `_resetChartJsForTest` clears the memo.

---

### `js/brewpad.js` shell in `renderDashboardV2` (component)

**Analog:** L5798-5817. Today it injects a flat list of slots:
```javascript
inner.innerHTML = '<div id="bp-dash-v2" class="bp-dash-v2">' +
  '<div id="bp-dash-filters" ...></div><div id="bp-dash-range" class="bp-dash-range" hidden></div>' +
  '<div id="bp-dash-v2-tiles"></div><div id="bp-dash-v2-period"></div><div id="bp-dash-v2-wine"></div></div>';
var shell = document.getElementById('bp-dash-v2');
shell.addEventListener('click', onDashV2Click);
shell.addEventListener('change', onDashV2Change);
shell.addEventListener('input', onDashV2Input);
shell.addEventListener('keydown', onDashV2Keydown);
```
Replace the slot list with four `<section>` blocks (`<h2 class="bp-dash-section-title">` + hint + `.bp-dash-grid`) holding one slot div per widget, in UI-SPEC order. Keep the `!document.getElementById('bp-dash-v2')` build-once guard and the four delegated listeners (all new widget interaction goes through delegation on `shell`; no per-widget listeners, so re-renders do not leak).

---

### `js/brewpad.js` delegated events (controller, event-driven)

**Analog:** `onDashV2Click` L5669+, the wine dimension chips branch (L5688-5692), `onDashV2Keydown` (radiogroup arrows for `.bp-seg-btn[data-dash-ctl]`, L5728-5790).
```javascript
if ((el = t.closest('[data-dash-wine-dim]'))) {
  var wd = el.getAttribute('data-dash-wine-dim');
  if (wd && wd !== _dashV2WineDimension) { _dashV2WineDimension = wd; renderDashV2Wine(_dashV2Model); }
  return;
}
```
Pattern for per-widget options: a `data-dash-w` attribute carrying `widgetKey:optionKey:value`, per-widget option state in a module-level object (e.g. `_dashV2WidgetOpts = {}`, in memory, never in the hash, per UI-SPEC), and a re-render of only that widget. The existing global-filter segs use `data-dash-ctl` + `.bp-seg-btn` and are wired to filter state in `paintDashV2Controls`/`commitDashV2State`: do NOT reuse `data-dash-ctl` for widget options, or they will change global filters. Use a different data attribute and add a branch before the generic fall-through. Keyboard: extend the existing radiogroup arrow handling to the new `data-dash-w` segs (arrow keys move, Space/Enter select, focus stays on the toggle after re-render, so re-query by `data-` values after innerHTML replacement).

Drill from table links reuses the same spec object as the chart: store the id arrays on the model and look them up by `data-dash-id` index at click time (as chart `onClick` does with `hit.index`), never serialise id lists into the DOM.

---

### `js/brewpad.js` `chart()` extensions (utility)

**Analog:** `chart()` L1415-1537. Current cfg: `type, labels, series[{key,label,data,colour}], stacked, horizontal, measure ('litres'|else batches), tooltipTotal, ariaLabel, onClick({index,key})`. Fixed behaviours: destroys any existing chart on the canvas (L1418-1419), legend off (custom HTML legend), reduced-motion handling, tooltip `label` callback appends `batch/batches` or `L`, `valueOf` handles horizontal. Needs for Phase 96:
- unit-aware tooltips beyond batches/litres (tasks, days, `°P`, percent in G9 Share): add `cfg.unit` / `cfg.tooltipLabel(item)` override, default behaviour unchanged;
- dashed/unfilled line datasets and per-series `borderDash`, `pointRadius`, `fill:false` (G8 expected line; `ds.borderColor` already set for `type === 'line'` at L1447-1450), mixed bar + vertical-line overlay for G3 planned length (inline plugin object in `options.plugins` per UI-SPEC, no annotation plugin);
- `cfg.yMax`/`cfg.percent` for 100% stack, `cfg.xTitle/yTitle` for `°P`, `cfg.dataLabels` via a tiny inline plugin (count printed at bar end for G2, G6, G7);
- `onClick` for line charts: `getElementsAtEventForMode(evt, 'nearest', { intersect: true }, true)` is already used (L1517); for G8 return `datasetIndex` as well as `key` so a point resolves to a batch.
Constraints: `Chart.getChart` / `getElementsAtEventForMode` are what `FakeChart` implements in tests (widgets test L58-71), so any new Chart API used must be added to the fake or the config asserted instead. Keep the signature backward-compatible: `tests/frontend/brewpad-dashboard-v2-chart.test.js` exercises it. Per-widget heights are CSS-driven on `.bp-chart` (L3065, 3071), so put height overrides on a modifier class on the widget body, not in `chart()`.

---

### `js/brewpad.js` module.exports seam

**Analog:** the block at L13942+ (`module.exports = Object.assign(module.exports || {}, {...})`): every new pure helper is exported here by name (`wineBreakdownBuckets: wineBreakdownBuckets,`, `dashDrillLabel: dashDrillLabel,`, `chart: chart,`). IIFE-scoped renderers are reached through the other `Object.assign` block (L13792+, e.g. `_renderDashboardV2ForTest`, `_setDashV2ChartsForTest`, `_setStateForTest`); add `_set...ForTest` accessors there for new state (e.g. `_dashData.completedTasks`) only if `_setStateForTest` cannot already set `_dashData` (it can: widgets test mount() passes `_dashData: { asOf, batches, staffBatchIds }`).

---

### `css/brewpad.css` (config)

**Analog:** `:root` tokens L40-44 and the Phase 95 widget block L3062-3081.
```css
  /* Chart series (Phase 95) */
  --chart-wine: #6e1a2c;
  --chart-cider: #a8841a;
  --chart-beer: #9a4e0c;
  --chart-other: var(--ink-tertiary);
```
Add exactly the six UI-SPEC tokens (`--chart-cat-1..6`, `-6` = `var(--chart-other)`), then new rules after L3081 under a `/* ===== Phase 96 ===== */` banner. Existing selectors to extend, not redefine: `.bp-widget` (L3062), `.bp-widget-title` (L3063, currently 16px, UI-SPEC demotes to 14px: change it, and check nothing else shares it), `.bp-widget-sub`, `.bp-chart` (240px / 200px at <= 600px, L3065/3071), `.bp-seg` / `.bp-seg-btn` (L3021-3033; the selected fill rule at L3032-3033 already gives the accent fill), `.bp-select` (L2306-2343), `.bp-empty` (L388), `.bp-chart-legend*` (L3077-3079). New: `.bp-dash-section-title`, `.bp-dash-grid` (2 col at >= 768px, `align-items: start`), `.bp-widget-head/-titles/-controls/-note`, `.bp-table-wrap/.bp-table/.bp-table-link`, list-row and accordion classes. All touch targets `min-height: 44px`; spacing multiples of 4; `prefers-reduced-motion` respected. `*.min.css` is a build artifact, never edit.

---

### Frontend tests (test, jsdom)

**Analog:** `tests/frontend/brewpad-dashboard-v2-widgets.test.js`. Copy its preamble and harness verbatim (L1-60 area): `global.google`, `global.fetch` stub, `sessionStorage` shim, `auth` globals, `require('../../js/brewpad')`; `TODAY` from `toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })`; `lean(id, type, start, extra)` row factory (extend with `vessel_id`, `completed_day`, `staff_batch`); `makeFakeChart()` with `instances`, `getChart`, `destroy`, `resize`, `getElementsAtEventForMode`; `mount(opts)` building the DOM stubs and `bp._setStateForTest({ _allBatchesData, _dashData: { asOf, batches, staffBatchIds }, ... })`; `go(hash)` / `renderV2(hash)`. Add the new server arrays to `_dashData` in `mount`. Extra assertions the UI-SPEC lists: chart model equals table model; banner text exact; singular/plural; no zero placeholder before data; shared vessel counted once; archived excluded; no-vessel row opens detail with no banner; G7 has no on-time or staff text; G8 expected line omitted when OG/target FG missing; banned-word guard over rendered copy (`double-booked`, `conflict`, `unbilled`, `on-time rate`, `completions by staff`; "due"/"overdue" only banned in G8 reading copy); G3 bin edges and p95 cap; Mon-Sun buckets and Vancouver days; type totals agree across widgets for the same filters. Do not edit existing test files; add new `brewpad-dashboard-v2-*.test.js` files (one per family), and run the full frontend and middleware suites (CLAUDE.md rules 1, 7).

## Shared Patterns

### Single data layer and type agreement
**Source:** `js/brewpad.js` `getDashboardData` L582-615, `buildDashV2Model` L1173-1204.
**Apply to:** every widget G1-G9. Classify once via `effectiveBatchType` (stored `batch_type`), never by product name; widgets that honour global filters take `model.cur` (same `run(range)` result as the tiles), widgets that "ignore the filters" (G6, G10, and G2 active stages for Period) compute from raw `_dashData.batches` with only the filters UI-SPEC says they honour. Staff handling: `staffIds` map from `_dashData.staffBatchIds` (L5336-5337) and `staff: st.staff === '1'`; production and capacity views include staff, mix views (G4, G9) hide by default (Phase 95 D-10).

### Click-through
**Source:** `openDashDrill(spec)` L6422-6434 plus `dashDrillLabel` L1265.
**Apply to:** every drill. `spec = { ids: string[], label: string }`; it sets `_dashDrill`, clears search/product filter, and `switchTab('batches')`. The tab-bar `handleTabBarClick` (L6438) clears the drill. Single-batch results bypass the banner. Do not write a second drill mechanism.

### Chart creation
**Source:** `chart()` L1415 + `loadChartJs()` L1389 + `readChartTheme()` L1365.
**Apply to:** all charts. Chart.js only via `window.Chart` after `loadChartJs()`; self-hosted `js/vendor/chart.umd.min.js?v=4.5.1`; no new libraries/plugins/CSP domains (CLAUDE.md rule 12 unaffected).

### Empty / loading / error copy
**Source:** `dashV2Msg`, `dashV2EmptyHtml` (L5426-5438), and strings `Loading charts…`, `Charts could not load. Reload the page to try again.`.
**Apply to:** all widgets; new copy exactly per UI-SPEC "Copywriting Contract". Escape dynamic text with `escapeHTML`.

### Server read contract
**Source:** `adminApiGet('get_dashboard_stats')` used at L4935 (eager load) and L5019 (`fetchDashboardAggregate`), result stored in `_dashData` via `dashAggregateFromStats` (L5004-5007, `stats = r.data`). New arrays ride inside `r.data`, so no frontend plumbing beyond reading `_dashData.<newKey>`. In sheets mode `_dashData` is null: every Phase 96 widget must handle `_dashData === null` or missing keys with the `Not available yet…` message (stale 60 s memo can omit new keys right after deploy).

### Pure ES5, no build-artifact edits
**Source:** CLAUDE.md. `var`/`function` only, no arrow functions or template literals in `js/brewpad.js`; ESLint via `npm run lint`; after edits run `npm run build`, then `npm test`, `cd zoho-middleware && npm test`, `npm run lint`.

## No Analog Found

| File / Piece | Role | Data Flow | Reason |
|--------------|------|-----------|--------|
| Table view builder (`.bp-table`, sticky header/first column, clickable `<tr>` link buttons) | component | transform | No data tables exist in the dashboard yet; v1 uses stat cards only. Use UI-SPEC "Widget anatomy". Closest DOM idiom: `.bp-chart-legend` HTML generation at L5452 for escaping and string-building style |
| Accordion list (G10) and "Show N / Show all" lists (G6, G8) | component | event-driven | No accordion in the dashboard. Look for an existing `aria-expanded` toggle elsewhere in `js/brewpad.js` (`grep -n "aria-expanded"`) before inventing; otherwise follow UI-SPEC |
| Histogram with planned-length vertical lines (G3), data-label plugin (G2/G6/G7), dashed expected curve (G8) | utility | transform | `chart()` has no overlay/label support; build as small inline plugins inside `chart()` options per UI-SPEC |
| Task-kind classification and stage mapping | utility | transform | New domain logic; only `is_packaging`/`is_transfer` flags and task `title` strings exist. Titles listed in CONTEXT D "Claude's Discretion" |
| `recipe_snapshot` parsing (OG, target FG, schedule length) | utility | transform | `recipe_snapshot` is a `text` column (0005_batches.sql L55) not currently read by the aggregate; locate the JSON shape with `grep -n "recipe_snapshot" zoho-middleware/lib/*.js` (batch-create writes it) before specifying the parse |

## Metadata

**Analog search scope:** `js/brewpad.js`, `css/brewpad.css`, `zoho-middleware/lib/{batch-pg-read,batch-store,batch-proxy}.js`, `zoho-middleware/routes/pos.js`, `zoho-middleware/migrations/0004-0005`, `zoho-middleware/__tests__/{db/batch-pg-dashboard-stats,batch-store-dash-stats}.test.js`, `tests/frontend/brewpad-dashboard-v2-widgets.test.js`.
**Files scanned:** about 12 read in part or full, plus greps across `js/`, `zoho-middleware/`, `tests/frontend/`.
**Pattern extraction date:** 2026-10-28
