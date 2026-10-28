# Phase 95: Global filters and chart engine - Pattern Map

**Mapped:** 2026-10-27
**Files analyzed:** 20 new/modified
**Analogs found:** 19 / 20 (Chart.js wrapper has no in-repo analog)

All paths are relative to `/Users/koa/dev/steins-and-vines-website`. Middleware paths are under `zoho-middleware/`. Line numbers were read this session and are accurate for the current tree. Phase 94's `94-PATTERNS.md` remains accurate for the Phase 94 pieces it covers (migration 0006/0007 shape, `FIELD_KINDS`, `batch-store`, backfill CLI skeleton, test harnesses); this file only adds what Phase 95 touches differently.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `zoho-middleware/migrations/0008_staff_batch.sql` | migration | batch (DDL) | `migrations/0007_batch_type.sql` | exact |
| `zoho-middleware/lib/batch-pg-read.js` (+`b.staff_batch` in `DASH_STATS_BATCHES_SQL` :75, `addBatchType` :151) | service | request-response (read) | itself (Phase 94 batch_type additions) | exact |
| `zoho-middleware/lib/batch-pg-create.js` (+`staff_batch` $31) | service | CRUD (create) | itself, `INSERT_BATCH_SQL` :54-62 and `resolveBatchType` :175 | exact |
| `zoho-middleware/lib/batch-pg-update.js` (+`updates.staff_batch` branch) | service | CRUD (update) | itself, batch_type block :328-357 and `TYPE_SET_SQL` :63 | exact |
| `zoho-middleware/lib/batch-rules.js` (+`normalizeStaffBatch`, `STAFF_AUTO_SOURCES`) | utility (pure) | transform | itself, `normalizeBatchType` / `BATCH_TYPES` | exact |
| `zoho-middleware/scripts/backfill/staff-batch-backfill.js` | utility (CLI) | batch | `scripts/backfill/batch-type-backfill.js` | exact |
| `zoho-middleware/scripts/backfill/batches-parity.js` (`IGNORED_KEYS` :41) | utility (CLI) | batch | itself | exact (one-line modify) |
| `docs/RUNBOOK.md` (Phase 95 subsection) | docs | n/a | "Batch type and completion dates (Phase 94)" section | exact |
| `js/brewpad.js` data layer: `getDashboardData` extension, `windowFromFilters`, `previousWindow`, `weekStartOf`, `batchLitres`, `sourceMatches`, `formatDelta`, id sets | utility (pure ES5) | transform | `getDashboardData` :475, `dashboardWindow` :399, `inWindow` :408, `normBatchSource` :219 | exact |
| `js/brewpad.js` filter state (`parseDashHash`, `writeDashHash`, localStorage) | utility | event-driven | none for hash; localStorage try/catch idiom in file | no analog (hash), partial |
| `js/brewpad.js` `loadChartJs()` + `chart()` | utility | request-response (lazy script) | script tags in `brewpad.html:24-25` (vendor pattern only) | partial |
| `js/brewpad.js` `renderDashboardV2()` shell + KPI tiles + wine breakdown on new engine | component | request-response | `renderDashboard` :4332, persistent shell in `renderBatchList` :5029 | role-match |
| `js/brewpad.js` drill-down (`openDashDrill`, `_dashDrill`, banner, `applyBatchFilter`) | component | event-driven | `initDelegation` pipeline tile :11059-11067, `applyBatchFilter` :4899 | role-match |
| `js/brewpad.js` Staff row + `setStaffBatch` in detail pane | component | CRUD (update) | `setBatchType` :2978, Type row :6700-6714, change handler :6892-6910 | exact |
| `js/brewpad.js` seams (`getStateForTest`, `_setStateForTest`, `module.exports`) | config (test seam) | n/a | itself :12274-12305 | exact |
| `js/vendor/chart.umd.min.js` + `js/vendor/README.md` | config (vendor asset) | static | `js/vendor/qrcode.min.js` (no README analog) | partial |
| `brewpad.html` (no Chart script tag; lazy only; build restamps `brewpad.min.js?v=`) | config | n/a | `brewpad.html:24-27` | exact |
| `css/brewpad.css` (`.bp-dash-filters`, `.bp-seg`, `.bp-chart`, `.bp-drill-banner`, `--chart-*`) | config (style) | n/a | `.bp-filter-btn` :552, `.bp-panel` :313, `.bp-stat-card` | role-match |
| `tests/frontend/brewpad-dashboard-v2-*.test.js` | test | transform / event-driven | `tests/frontend/brewpad-dashboard-data.test.js` | exact |
| `zoho-middleware/__tests__/db/*staff*`, `__tests__/backfill/staff-batch-backfill-plan.test.js`, parity key test | test | CRUD / batch | `__tests__/db/batch-pg-update-type.test.js`, `batch-type-backfill-plan.test.js`, `batches-parity-type-keys.test.js` | exact |

## Pattern Assignments

### `zoho-middleware/migrations/0008_staff_batch.sql` (migration)

**Analog:** `zoho-middleware/migrations/0007_batch_type.sql` (whole file, 18 lines). Same header comment style, `-- Up Migration` / `-- Down Migration`, additive only, no CHECK, PG-only note.

```sql
-- Up Migration
alter table batches add column batch_type text;
comment on column batches.batch_type is 'wine|beer|cider|seltzer|other; NULL = not yet classified (Phase 94)';
...
-- Down Migration
alter table batches drop column completed_at_source;
```

Difference: `alter table batches add column staff_batch boolean not null default false;` plus a `comment on column`. Header must say: PG-only like `unit_seq`/`batch_type`, not in `BATCH_COLUMNS`, ships to prod only after 0007, never edit once applied. No backslashes (guard bans them). Verify with `npm run migrate:guard`. Test analog: `__tests__/db/batches-type-migration.test.js`.

---

### `zoho-middleware/lib/batch-pg-read.js` (staff_batch in aggregate and opt-in extras)

**Analog:** itself. The aggregate already selects `b.source` and `b.target_volume_l` (lines 75-85), so only add `b.staff_batch`:

```js
var DASH_STATS_BATCHES_SQL =
  'select b.batch_id, b.status, b.batch_type, b.batch_type_source, ' +
  ...
  'b.completed_at, b.completed_at_source, b.vessel_id, b.source, b.product_sku, b.product_name, ' +
```

Insert `b.staff_batch, ` after `b.source,`. Never add `customer_*` (column whitelist; Phase 94 test `batch-pg-dashboard-stats.test.js` asserts absence).

Opt-in extras (lines 151-154), used by `listBatches`/`getBatchDetail` through `includeType`:

```js
function addBatchType(batch, row) {
  batch.batch_type = row && row.batch_type ? String(row.batch_type) : null;
  batch.batch_type_source = row && row.batch_type_source ? String(row.batch_type_source) : null;
}
```

Add `batch.staff_batch = !!(row && row.staff_batch === true);`. Keep out of `BATCH_COLUMNS`/`serializeBatch`. Aggregate post-processing map is at :268-275 (row mapper where `target_volume_l` goes through `numOrNull`); `staff_batch` is already a JS boolean from pg, no conversion needed. Test analogs: `__tests__/db/batch-pg-dashboard-stats.test.js`, `batch-pg-read-type.test.js`.

---

### `zoho-middleware/lib/batch-pg-create.js` (auto-set on create)

**Analog:** itself. `INSERT_BATCH_SQL` is at :54-62 and currently ends `batch_type, batch_type_source) values ... $29, $30) returning batch_id`:

```js
  'recipe_id, recipe_snapshot, target_volume_l, scale_factor, unit_seq, ' +
  'batch_type, batch_type_source) values ' +
  '($1, $2, ..., $20, ' +
  '$21, $22, $23, $24, $25, $26, $27, $28, $29, $30) returning batch_id';
```

Append `staff_batch` and `$31`, and push one value at the end of `values` (built near :228-262; read it before editing so the order matches). Value is derived from the already-normalised lower-case `source` (`internal` or `research` -> true), never from `p` (payload). Precedent for deriving from `source` in `resolveBatchType` (:175-179):

```js
var source = String(p.source || 'manual').toLowerCase();
if (source === 'manual' || source === 'internal') {
```

Put the source set (`STAFF_AUTO_SOURCES = ['internal','research']`) in `batch-rules.js` so create and backfill share it. D-19: create only, so do not touch `batch-pg-update.js` source-flip logic. (Open question OQ2 in RESEARCH says recommend set-on-flip, but D-19 is locked: do not.) Test analog: `__tests__/db/batch-pg-create-type.test.js`, `batch-pg-create-internal.test.js`.

---

### `zoho-middleware/lib/batch-pg-update.js` (`updates.staff_batch`)

**Analog:** itself, the Phase 94 `batch_type` branch, which sits outside `FIELD_KINDS` (lines 328-357) and feeds `addSet` (:444-445):

```js
var typeSet = null;
if (updates.batch_type !== undefined) {
  var normalizedType = batchRules.normalizeBatchType(updates.batch_type);
  if (!normalizedType) {
    return fail('invalid_input', 'batch_type must be one of: wine, beer, cider, seltzer, other');
  }
  ...
}
...
addSet('batch_type', typeSet.type);
```

Copy: the `!== undefined` gate, `fail('invalid_input', ...)` for bad values, and the `addSet(col, value)` call next to the batch_type `addSet`. Accept `true/false/'true'/'false'` only (see RESEARCH "Staff update branch" snippet). Do NOT add `staff_batch` to `FIELD_KINDS`. Bump of `last_updated` on this normal edit path is acceptable (mirror drops unknown keys).

**Backfill write (D-18, no `last_updated` bump):** follow the dedicated-statement precedent at :63-64 and its use at :534:

```js
var TYPE_SET_SQL =
  'update batches set batch_type = $2, batch_type_source = $3 where batch_id = $1';
...
if (derivedType) await client.query(TYPE_SET_SQL, [id, derivedType.type, derivedType.source]);
```

Add an equivalent `STAFF_SET_SQL = 'update batches set staff_batch = $2 where batch_id = $1'` (constant SQL, `$n` only) and export a small `setStaffBatch(client, id, value)` so the CLI does not carry ad-hoc SQL. Test analog: `__tests__/db/batch-pg-update-type.test.js` (uses `pgHarness`/`rollbackEachTest`, see 94-PATTERNS).

---

### `zoho-middleware/scripts/backfill/staff-batch-backfill.js` (CLI)

**Analog:** `zoho-middleware/scripts/backfill/batch-type-backfill.js` (read in full this session). Copy its structure:

**Header/exports/flags** (lines 1-27 doc block; :29-40 requires; :47-73 `parseArgs`): refuses Postgres URL on argv, `--dry-run`, `--apply`, `--expect=<n>`, `--with-names`; `--apply` without `--expect` throws, `--expect` without `--apply` throws, `--apply` + `--dry-run` throws.

```js
if (POSTGRES_URL_RE.test(arg)) {
  throw new Error('pass the database via BACKFILL_DATABASE_URL, never on the command line');
}
...
if (opts.apply && opts.dryRun) throw new Error('--dry-run and --apply cannot be combined');
if (opts.apply && opts.expect === null) {
  throw new Error('--apply requires --expect=<candidates> from the reviewed dry run');
}
```

**Read-only candidate read** (:140-153): `begin transaction read only` / `commit` / rollback-on-error / `client.release()` in `finally`.

**One transaction per batch write** (:155-179): `begin` -> write -> `commit` else `rollback`. Differences: the write is `setStaffBatch` (or `STAFF_SET_SQL`) behind `select ... for update` on the row, re-checking `staff_batch = false` under the lock; no `updateBatch`, no trusted channel, no `actor`.

**Runner** (:207-262): `runX(opts, deps)` returns `{exitCode, candidates, written, skipped}`; logs every candidate row; dry run returns before any write; `candidates.length !== opts.expect` -> `EXIT.CHECKS_FAILED`; stop on first non-skippable error.

```js
if (candidates.length !== opts.expect) {
  log('Refusing to apply: candidates ' + candidates.length + ' != --expect ' + opts.expect +
    '. Re-run the dry run and re-review.');
  return { exitCode: EXIT.CHECKS_FAILED, ... };
}
```

**Candidate SQL** (new, constant with bound params, per D-09): `source in ('internal','research')` OR whole-word case-insensitive match of `McLachlan` / `Inn` against `customer_name, customer_firstname, customer_lastname`; only rows with `staff_batch = false`. Each dry-run line prints `batch_id`, the matched reason (`source:internal`, `name:McLachlan`...) and the matched field name, but NOT the customer name unless `--with-names` (copy the `opts.withNames` guard at :221-222). Whole-word `Inn` must not match "Dinner"; Postgres regex `~* '\mInn\M'` with a bound pattern parameter.

**Next-step logging** (:194-201, `logNext`): here, D-18 means no replay; replace with "run batches-verify, expect 0 mismatches" for production and nothing for staging.

**main()/bootstrap**: copy `batch-type-backfill.js` `main()` shape (builds `db.createPool(process.env.BACKFILL_DATABASE_URL, { max: 2 })`, `pool.end()`, `process.exit(result.exitCode)`, `if (require.main === module) main();`). Drop `bootstrapZoho`/`fetchItems`; no Zoho call needed. Test analog: `__tests__/backfill/batch-type-backfill-plan.test.js` (fake pool, `parseArgs` refusal tests) and `__tests__/db/batch-type-backfill.test.js` (real PG, idempotent re-run lists 0).

---

### `zoho-middleware/scripts/backfill/batches-parity.js` (one line)

**Analog:** itself, :41.

```js
var IGNORED_KEYS = { access_token: true, batch_type: true, batch_type_source: true };
```

Add `staff_batch: true`. Add a NEW test file modelled on `__tests__/backfill/batches-parity-type-keys.test.js` (CLAUDE.md rule 10: never edit existing tests). Also add a test asserting `serializeBatch` output and the ops-mirror bundle contain no `staff_batch` key.

---

### `js/brewpad.js` data-layer extension (`getDashboardData` and friends)

**Analog:** the Phase 94 section itself (lines 355-595). ES5, pure, no wall clock, everything keyed off `asOf.today`.

**Constants/helpers to reuse unchanged** (:358-412): `DASH_WINDOW_DAYS = { '30d': 30, '90d': 90, '6mo': 180, '12mo': 365 }` (code keys stay `6mo`/`12mo`; map UI `6m`/`12m`), `DASH_TYPES`, `DASH_STARTED_STATUSES`, `dayNumber`, `addDays`, `cycleDays`, `medianOf`, `meanOf`, `inWindow`, `normBatchSource` (:219), `effectiveBatchType` (:414), `toDashRows` (:430; add `staff_batch: !!b.staff_batch`).

**Window function to extend** (:399-406):

```js
function dashboardWindow(key, asOfToday) {
  var end = asOfToday;
  if (key === 'all') return { key: 'all', start: '0000-01-01', end: end };
  if (DASH_WINDOW_DAYS[key]) {
    return { key: key, start: addDays(end, -(DASH_WINDOW_DAYS[key] - 1)), end: end };
  }
  return { key: 'ytd', start: String(end).slice(0, 4) + '-01-01', end: end };
}
```

Leave as-is (v1 uses it). Add `windowFromFilters` (honours `filters.range = {start,end}`) and `previousWindow` beside it. Do not change its behaviour.

**Core loop to extend, not fork** (:485-563). Keep this skeleton: classify once -> `typeFilter` -> items -> single pass computing counts. Add `sourceMatches` after the type filter, push `row.batch_id` into id arrays at the same statements that increment counters (so `count === ids.length`):

```js
if (inWindow(row.start_date, win)) {
  started++;
  totalsByType[it.type]++;          // becomes: startedIds.push(row.batch_id) ... started = startedIds.length
}
if (it.status === 'complete' && inWindow(row.completed_day, win)) {   // CR-01: complete rows only
  completed++;
```

**Bucket bug to NOT copy** (:509-545): the existing month buckets are built from `months` and `bucketByKey[...]` without `inWindow`, so chart totals can differ from the Started tile. The v2 bucket step must require `inWindow(row.start_date, win)` AND the bucket match, gap-filled from `win.start` (for `all`, from the earliest `start_date`). Keep v1's return keys (`monthBuckets`, `totals`, `cycle`...) intact because v1 and existing tests read them (`brewpad-dashboard-data.test.js`).

**Mix vs production views (D-10):** add an `opts.mix` argument consumed only by the wine breakdown; tiles, month/period chart and cycle time ignore `filters.staff`. Test: tile values identical with staff toggle on and off.

**Week key:** `(dayNumber(ymd) + 3) % 7` days since Monday (no frontend helper exists; the server mirror is `lib/kiosk-history.js:256`). Code in RESEARCH "ES5 selection + buckets".

**Imports/exports:** add each new pure fn to the top-level export block (~:12320, `Object.assign(module.exports || {}, {...})`), alongside `filterBatchesByUnlinked`.

**Test analog:** `tests/frontend/brewpad-dashboard-data.test.js` lines 1-45 (preamble: stub `google`, `fetch`, `localStorage`, `sessionStorage`; wire `js/lib/auth` globals; `require('../../js/brewpad')`; fixed `ASOF = { today: '2026-10-23', year: 2026, tz: 'America/Vancouver' }`; `row(o)` factory with every lean-row key; `WINDOWS`/`TYPES` loops). Copy the preamble and `row()` factory verbatim into each new `brewpad-dashboard-v2-*.test.js` (add `staff_batch: false` to the factory) rather than editing the old file.

---

### `js/brewpad.js` filter state, hash and localStorage

**No in-repo analog for hash/URL state.** Verified by grep: `brewpad.js` has no `location.hash`, `URLSearchParams` or `history.*`. Use RESEARCH "Hash parse (whitelist, replaceState)" code, plus the rule: if the hash has any filter key, use hash only; else localStorage; else defaults.

Partial analog for storage: existing localStorage use is wrapped in try/catch (Safari private mode throws); keys `bp_dash_v2` and `bp_dash_filters` are new. Use `history.replaceState(null, '', location.pathname + location.search + '#...')` so `?dash=v2` survives, and wrap `decodeURIComponent` in try/catch. Whitelist every value and validate `from`/`to` as `YYYY-MM-DD` with `from <= to <= asOf.today`. Never write hash text into `innerHTML`; use `escapeHTML` / `textContent`.

---

### `js/brewpad.js` `loadChartJs()` and `chart()`

**Partial analog only:** vendor files are loaded by static script tag (`brewpad.html:24-25`):

```html
<script src="js/vendor/qrcode.min.js"></script>
<script src="js/vendor/jspdf.umd.min.js"></script>
```

Chart.js must NOT be added there (D-12, lazy). Use the dynamic injection and `chart()` code in RESEARCH "chart() helper (ES5)" (cached Promise, clear on error, `Chart.getChart(canvas)` destroy before re-create, reduced-motion check, `'nearest'` then `'index'` hit-test for stacked click). Pin `?v=4.5.1`. Callers: `renderDashboardV2()` only. Jest: install a fake `window.Chart` (jsdom has no canvas); never load the real bundle in tests.

---

### `js/brewpad.js` `renderDashboardV2()` and dispatch

**Analog (entry/dispatch):** `renderDashboard` :4332-4336:

```js
function renderDashboard() {
  var inner = document.getElementById('bp-dashboard-inner');
  if (!inner) return;
  var d = _dashSummary || {};
```

Add one line at the very top: `if (isDashV2()) { return renderDashboardV2(); }` (v1 body frozen, D-03). `renderDashboard` is invoked by `eagerLoad`, `loadDashboard`, `loadWineSnapshot`, so the dispatch covers all of them.

**Analog (persistent shell):** `renderBatchList` :5029 only creates its shell when `#bp-batch-results` is missing, then updates parts. Copy that: build filter bar + widget containers once, update widget contents on filter change, do not rewrite `#bp-dashboard-inner.innerHTML` each time (chart instances, open picker, sticky scroll would be lost).

**Tile vocabulary** (from `renderDashboard`, see 94-PATTERNS): `bp-stat-grid`, `bp-stat-card`, `bp-stat-num`, `bp-stat-label`, `bp-stat-card--wide`; `TYPE_COLORS`/`TYPE_LABELS`/`TYPE_ORDER` constants are in `renderDashboard`. Tiles become `<button>` elements carrying the id-set key so a click reads the same array that produced the number. Empty state: `<p class="bp-empty">`.

**Panel scroll fix:** sticky bar is `top: 0` inside `.bp-panel` (css:313, `position:absolute; inset:0; overflow-y:auto`), NOT `var(--bp-shell-height)` (planner note in CONTEXT, RESEARCH Pitfall 1).

**Tab switch:** `switchTab` (:3170) must resize or re-render live charts when entering `dashboard` (hidden panels measure 0x0, Pitfall 3).

---

### `js/brewpad.js` drill-down (click-through)

**Analog (entry):** `initDelegation` dashboard click handler, :11059-11067:

```js
dashInner.addEventListener('click', function (e) {
  var tile = e.target.closest('.bp-pipeline-tile');
  if (tile) {
    _batchStatusFilter = tile.getAttribute('data-status');
    _batchSearch = '';
    _batchesLoaded = false;
    switchTab('batches');
    return;
  }
```

Add a v2 branch before it: resolve `data-*` -> `openDashDrill(spec)` that sets `_dashDrill = { ids, count, label }`, `_batchStatusFilter = 'all'`, clears `_batchSearch` and `_batchProductFilter`, `_batchesLoaded = false`, then `switchTab('batches')`. The existing pipeline-tile branch must clear `_dashDrill`. `'all'` is essential: the default chip is `'active'` and would drop complete batches, breaking the count-match rule.

**Analog (list filtering seam):** `applyBatchFilter` :4899-4909 is the single place `_batchesData` is derived from `_allBatchesData`:

```js
function applyBatchFilter() {
  if (_batchStatusFilter === 'readyToBottle') {
    _batchesData = readyToBottleRows();
  } else if (_batchStatusFilter === 'unlinked') {
    _batchesData = filterBatchesByUnlinked(_allBatchesData);
  } else if (_batchStatusFilter === 'needsType') {
    _batchesData = needsTypeRows();
  } else {
    _batchesData = filterBatchesByStatus(_allBatchesData, _batchStatusFilter);
  }
}
```

Intersect with `_dashDrill.ids` at the start (source = `_allBatchesData` filtered by id set), then apply the chip logic to that source. `loadBatches` (:4930) re-calls `applyBatchFilter` and `renderBatchList` on fresh cache; when `_allBatchesData` is empty (emptied by `afterBatchWrite`) it refetches, so the drill must tolerate that. Banner goes above the chips in the persistent list shell; dismiss restores `_batchStatusFilter = 'active'`. Chip click path: `selectBatchStatusFilter` :4983.

**Id sets:** banner N is `ids.length` from the data layer (D-14), never a separate count.

---

### `js/brewpad.js` Staff checkbox and `setStaffBatch`

**Analog (write):** `setBatchType` :2978-2990:

```js
function setBatchType(batchId, nextType) {
  return adminApiPost('update_batch', { batch_id: batchId, updates: { batch_type: nextType } }).then(function (res) {
    var rows = _dashData && _dashData.batches ? _dashData.batches : [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].batch_id === batchId) {
        rows[i].batch_type = nextType;
        rows[i].batch_type_source = 'manual';
      }
    }
    afterBatchWrite(batchId, { refreshOpenDetail: true, listAffecting: true });
    return res;
  });
}
```

Copy it: nested `updates:{ staff_batch: bool }` and `batch_id`, patch the cached `_dashData.batches` row so mix views update immediately, then `afterBatchWrite` (which also zeroes `_dashLoadTime`).

**Analog (markup):** Type row :6700-6714; place the Staff row immediately after it, same `bp-detail-info-row` / `bp-detail-info-label` classes, `escapeHTML` on every dynamic value, disabled/deleted plain-text branch via the same `statusKey` test (:6703). Provenance hint like `TYPE_SOURCE_HINTS` (:2992): derive from `source` (internal -> "Set automatically (internal batch)", research -> "...(research batch)", else "Set by hand").

**Analog (handler):** :6892-6910; disable control, call, toast on success, revert value and `showToast('Could not update ...', 'error')` on failure.

```js
typeSelect.disabled = true;
setBatchType(b.batch_id, nextType).then(function () {
  prevType = nextType; typeSelect.disabled = false; showToast('Type updated', 'success');
}).catch(function () {
  typeSelect.value = prevType; typeSelect.disabled = false;
  showToast('Could not update type. Try again.', 'error');
});
```

Staff flag value for the detail pane comes from `get_batch` (via `includeType` extras), not the aggregate cache (Review WR-02 note at :3005: prefer what `get_batch` returned).

---

### `js/brewpad.js` test seams

**Analog:** :12274-12305. Additive pattern:

```js
getStateForTest: function () { return { ..., _dashData: _dashData }; },
_setStateForTest: function (patch) {
  if ('_dashData' in patch) _dashData = patch._dashData;
  ...
},
```

Add `_dashDrill`, `_batchSearch` if not present, and v2 filter state keys, additively (existing tests must pass untouched). Add `_renderDashboardV2ForTest` next to `_renderDashboardForTest` (:12274).

---

### `js/vendor/chart.umd.min.js` and `js/vendor/README.md`

**Analog:** `js/vendor/qrcode.min.js`, `jspdf.umd.min.js`, `fuse.min.js`, `sentry.min.js` (no README exists, so README is new). Version: 4.5.1, SHA-256 `48444a82d4edcb5bec0f1965faacdde18d9c17db3063d042abada2f705c9f54a`, 208,522 bytes. Download via `npm pack` in the scratchpad dir, NOT in the repo. `**/*.min.js` is ESLint-ignored. Plan needs a verify task re-hashing the file and checking the README and commit message agree. Rule 12 CSP check: record "checked, no change" (brewpad.html has no CSP meta; public pages untouched).

---

### `css/brewpad.css`

**Analogs:** `.bp-filter-btn` (:552) and `.bp-filter-btn--active` (:566) for segmented controls; `.bp-panel` (:313) for sticky containment; `var(--cellar-raised)` (:20, used throughout) for the 2px stacked-segment separator colour; `.bp-stat-card` / `.bp-stat-grid` for tiles. Add `--chart-wine/-cider/-beer` custom properties (cider `#a8841a`, beer `#9a4e0c` per research) and read them once via `getComputedStyle` from `chart()` callers. Edit `css/brewpad.css` only; `npm run build` regenerates the min file.

---

## Shared Patterns

### PG-only column (never mirrored)
**Source:** `lib/batch-rules.js:25` `BATCH_COLUMNS`; 0007 migration header; `batches-parity.js:41`.
**Apply to:** migration 0008, create, update, read, backfill. `staff_batch` stays out of `BATCH_COLUMNS`, `serializeBatch`, mirror bundle, parity compare. Tests added as new files only.

### Business rejection vs infrastructure error
**Source:** `lib/batch-pg-create.js:70-72` (`fail(error, message)` resolves `{ok:false,...}`); infra errors propagate and roll back.
**Apply to:** the `staff_batch` update branch and `setStaffBatch`.

### Constant SQL, bound params
**Source:** `batch-pg-update.js:63-64` `TYPE_SET_SQL`, `batch-type-backfill.js` `CANDIDATES_SQL`.
**Apply to:** `STAFF_SET_SQL`, staff candidate query (name patterns bound, not interpolated).

### Write then bust caches
**Source:** `setBatchType` :2978 -> `afterBatchWrite(batchId, { refreshOpenDetail: true, listAffecting: true })`.
**Apply to:** `setStaffBatch`. Always send `batch_id` and nested `updates` (top-level silently no-ops; stale `gb:<batchId>` cache otherwise).

### One data layer, ids next to counts
**Source:** `getDashboardData` :475 (Phase 94 D-20).
**Apply to:** every tile, bar, segment, banner. Counts are `ids.length`. Fixed `asOf`/`now` in tests; never the wall clock.

### Escaping and XSS
**Source:** `escapeHTML` usage throughout `renderBatchDetail` (:6700-6717).
**Apply to:** banner label, filter labels, tooltips, hash-derived text. Whitelist-parse hash/localStorage values first.

### ES5 and build
**Source:** CLAUDE.md. `var`, function expressions, no arrow/template literal/`includes`/`Object.entries`. Edit `js/brewpad.js` and `css/brewpad.css` only; `npm run build` after; never edit `*.min.*`. Run `npm test`, `cd zoho-middleware && npm test`, `npm run lint` before commit. Node 24 for tests.

### Production backfill procedure
**Source:** `docs/RUNBOOK.md` "Batch type and completion dates (Phase 94)"; Phase 84/94 memory (in-container via `railway ssh`, tunnel fails). Dry run -> owner reviews every row in-session -> `--apply --expect=N` -> `batches-verify` must show 0 mismatches. Staging: Postgres only, never replay/verify. Log the production apply in `87-CUTOVER-LOG.md` "SQL fixes".

## No Analog Found

| File / Concern | Role | Data Flow | Reason |
|----------------|------|-----------|--------|
| URL-hash filter state (`parseDashHash`/`writeDashHash`) | utility | event-driven | No `location.hash`/`history.*` use anywhere in `brewpad.js`; use RESEARCH code and unit-test whitelist, precedence, malformed input |
| `chart()` Chart.js wrapper and lazy `loadChartJs()` | utility | request-response | No canvas charting exists (v1 uses CSS bars); only the vendor script-tag convention is shared |
| Frontend Monday-week helper | utility | transform | Only server-side `lib/kiosk-history.js:256` exists; write the 3-line `weekStartOf` |
| `js/vendor/README.md` provenance record | docs | n/a | No README in `js/vendor/` today |

## Notes for the planner

- CONTEXT D-19 (create-only auto-set) overrides RESEARCH OQ2 (set on source flip). Do not add flip logic.
- CONTEXT D-16/D-17/D-18 resolve RESEARCH OQ1/OQ3/OQ5: `kiosk_recipe` counts under Kiosk, seltzer/other use 23 L labelled estimated, backfill writes without bumping `last_updated` and has no replay step.
- Unresolved in RESEARCH and still open: OQ4 (cycle-time tile click-through; recommend drill to the contributing ids) and the sticky `top` offset (use `top: 0`).
- The v1 `monthBuckets` ignores the window; do not reuse `bucketBatchesByMonthType` or the existing month-bucket loop for v2.

## Metadata

**Analog search scope:** `js/brewpad.js` (targeted ranges: 355-610, 2975-3020, 4332-4346, 4895-4945, 6696-6717, 6890-6912, 11055-11095, 12274-12305), `zoho-middleware/lib/{batch-pg-read,batch-pg-create,batch-pg-update}.js`, `zoho-middleware/migrations/0007_batch_type.sql`, `zoho-middleware/scripts/backfill/{batch-type-backfill,batches-parity}.js`, `tests/frontend/brewpad-dashboard-data.test.js`, `brewpad.html`, `css/brewpad.css`, `js/vendor/`, prior `94-PATTERNS.md`
**Files scanned:** ~14 read, plus directory listings and greps
**Pattern extraction date:** 2026-10-27
