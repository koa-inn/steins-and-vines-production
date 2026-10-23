# Phase 94: Dashboard correctness and data foundations - Pattern Map

**Mapped:** 2026-10-23
**Files analyzed:** 22 new/modified
**Analogs found:** 21 / 22 (one partial)

All paths are relative to `/Users/koa/dev/steins-and-vines-website`. Middleware paths are under `zoho-middleware/`. Line numbers were read this session.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `zoho-middleware/migrations/0007_batch_type.sql` | migration | batch (DDL) | `migrations/0006_recipes_beer_category.sql` | exact |
| `zoho-middleware/lib/batch-rules.js` (+`classifyBatchType`, `BATCH_TYPES`, `buildDashboardStats`) | utility (pure rules) | transform | `lib/batch-rules.js` itself (`buildDashboardSummary` :743, `zoneParts` :717, `formatDay` :726) + `lib/recipe-rules.js` `BEER_CATEGORY_KEYS` :57 | exact |
| `zoho-middleware/lib/batch-pg-create.js` (+type on INSERT) | service | CRUD (create) | itself, `INSERT_BATCH_SQL` :53-60, `values` :231-260 | exact (modify) |
| `zoho-middleware/lib/batch-pg-update.js` (+`batch_type`, completed_at stamp, trusted channel, re-derive) | service | CRUD (update) | itself, `FIELD_KINDS` :69-90, `updateBatch` :259-350 | exact (modify) |
| `zoho-middleware/lib/batch-pg-read.js` (+`getDashboardStats`) | service | request-response (read) | itself, `getDashboardSummary` :197-209 + SQL constants :57-71 | exact |
| `zoho-middleware/lib/batch-store.js` (+`dashStats()` memo, clear in `finish()`, `resolveTypeHints` in `create`) | service (facade) | request-response + cache | itself, `dashboard()` :131-135, `finish()` :76-93, `create()` :201-213 | exact (modify) |
| `zoho-middleware/lib/batch-proxy.js` (+`STATS_ACTION_TO_OP`) | middleware | request-response | itself, `intercept` :62-101 | exact (modify) |
| `zoho-middleware/routes/pos.js` (allowlist entry, BrewPad proxy only) | route | request-response | itself, `ADMIN_PROXY_ACTIONS` :4295, `ADMIN_PROXY_READS` :4333 | exact (modify) |
| `zoho-middleware/scripts/backfill/batch-type-backfill.js` | utility (CLI) | batch | `scripts/backfill/batches-replay-to-sheet.js` (+ `batches-backfill.js` for `--dry-run` semantics) | role-match |
| `zoho-middleware/scripts/backfill/completed-at-backfill.js` | utility (CLI) | batch | `scripts/backfill/batches-replay-to-sheet.js` | role-match |
| `js/brewpad.js` pure helpers: `dashboardWindow`, `getDashboardData`, `cycleDays`, `median`, `filterBatchesByNeedsType`, effective-type | utility (pure, ES5) | transform | `filterBatchesByUnlinked` :216-231, `resolveBatchType` :299-357 | exact |
| `js/brewpad.js` `loadDashboard`/`renderDashboard` (tiles, month chart, wine breakdown) | component | request-response | itself :3939-4062 | exact (modify) |
| `js/brewpad.js` Batches chip row (+`needsType` chip) | component | event-driven | Unlinked chip :4666, :4683-4684, :4745-4746, :4783 | exact |
| `js/brewpad.js` detail pane Type row + select handler | component | CRUD (update) | info grid :6288-6299; `markBatchSource` :2693-2701; `unmarkInternalBtn` handler :6467-6482 | exact |
| `js/brewpad.js` seams (`getStateForTest`/`_setStateForTest`/`module.exports`) | config (test seam) | n/a | itself :11830-11855, :11870-11889 | exact |
| `css/brewpad.css` (`.bp-stat-card--wide`) | config (style) | n/a | `.bp-stat-grid`/`.bp-stat-card` css:1493-1496 | exact |
| `tests/frontend/brewpad-dashboard-data.test.js` | test | transform | `tests/frontend/brewpad-dashboard-chart.test.js` | exact |
| `tests/frontend/brewpad-batch-type-ui.test.js` | test | event-driven | `tests/frontend/brewpad-unlinked-filter.test.js` | exact |
| `zoho-middleware/__tests__/batch-rules-batch-type.test.js` | test | transform | `__tests__/batch-rules-sku-type.test.js` | exact |
| `zoho-middleware/__tests__/db/batch-pg-create-type.test.js`, `batch-pg-update-type.test.js`, `batch-pg-dashboard-stats.test.js`, `batches-type-migration.test.js`, `batch-type-backfill.test.js` | test (real PG) | CRUD | `__tests__/db/batch-pg-update-source.test.js` | exact |
| `zoho-middleware/__tests__/backfill/batch-type-backfill-plan.test.js`, `completed-at-backfill-plan.test.js` | test | batch | `__tests__/backfill/batches-replay-to-sheet.test.js` | exact |
| `zoho-middleware/__tests__/batch-store-dash-stats.test.js`, `batch-dash-stats-route.test.js` | test | request-response | `__tests__/batch-proxy-routes.test.js` (+ `batch-store.test.js`) | role-match |

## Pattern Assignments

### `zoho-middleware/migrations/0007_batch_type.sql` (migration)

**Analog:** `zoho-middleware/migrations/0006_recipes_beer_category.sql` (whole file, 13 lines)

```sql
-- 0006_recipes_beer_category.sql — Phase 89: optional beer_category on recipes.
-- Additive only (83 D-04). Plain nullable text, NO CHECK constraint (89 D-03): the deploy allowlist
-- forbids DROP CONSTRAINT, so the enum is enforced in lib/recipe-rules.js and apps-script/adminApi.gs.
-- D-13: ships to production only in the same promotion as 0004/0005 (node-pg-migrate order check).
-- Never edit this file once applied — add a new migration instead.

-- Up Migration
alter table recipes add column beer_category text;
comment on column recipes.beer_category is 'Optional beer tint key; app-level enum, see lib/recipe-rules.js BEER_CATEGORY_KEYS (Phase 89)';

-- Down Migration
alter table recipes drop column beer_category;
```

Copy: header comment block, `-- Up Migration` / `-- Down Migration` markers, nullable `text` columns, no CHECK, optional `comment on column`. Three columns on `batches`: `batch_type`, `batch_type_source`, `completed_at_source`. Down drops them in reverse order. Note in the header that these are PG-only (like `unit_seq`, comment at `lib/batch-compare.js:19`) and NOT in `BATCH_COLUMNS`. Prod order caveat: 0007 must follow 0006 (RESEARCH Pitfall 10).

Test analog: `__tests__/db/batches-migration.test.js` and `ops-migration.test.js` (real-PG apply/rollback). Guard: `npm run migrate:guard`.

---

### `zoho-middleware/lib/batch-rules.js` (pure `classifyBatchType`)

**Analog:** the same module (pure, ES5-style `var`/`function`, no I/O). Existing anchors: `BATCH_COLUMNS` :25, `serializeBatch` :160, `zoneParts` :717, `formatDay` :726, `buildDashboardSummary` :743. Enum source for the recipe rule: `lib/recipe-rules.js:57` `BEER_CATEGORY_KEYS`, normaliser at :73.

Pattern to follow (from RESEARCH Pattern 2, adjusted for D-22): hints are resolved by the caller; the classifier never fetches.

```js
var BATCH_TYPES = ['wine', 'beer', 'cider', 'seltzer', 'other'];
function normType(v) { var s = String(v || '').trim().toLowerCase(); return BATCH_TYPES.indexOf(s) !== -1 ? s : ''; }
// hints = { recipeType, zohoCfType, scheduleCategory } resolved by the caller
function classifyBatchType(batch, hints) { /* rule order: recipe, zoho, schedule, name, other */ }
```

D-22 recipe rule: `recipe_snapshot.beer_category` present (valid key) gives `beer`; else exact style-word match only (`cider|wine|seltzer|beer`); else fall through. Do NOT add `BATCH_TYPES`/new keys to `BATCH_COLUMNS` or `serializeBatch` (golden tests `__tests__/batch-rules.test.js`, `batches-spec-headers.test.js`).

Test analog: `__tests__/batch-rules-sku-type.test.js` lines 1-40 (header comment states the regression, `var rules = require('../lib/batch-rules')`, small `describe` with one `it` per case). Precedence 1-5, manual never overwritten, unknown goes to `other`.

---

### `zoho-middleware/lib/batch-pg-create.js` (modify)

**Analog:** itself. The single create choke point.

Add `batch_type, batch_type_source` to the column list and `$29, $30` (lines 53-60):

```js
var INSERT_BATCH_SQL =
  'insert into batches (status, product_sku, ... recipe_id, recipe_snapshot, target_volume_l, scale_factor, unit_seq) values ' +
  '($1, $2, ..., $27, $28) returning batch_id';
```

Append to `values` (lines 231-260, currently ends `scaleFactor, unitSeq`). Schedule category is already in scope: `schedule` is read in-transaction at :192 (`schedulePg.getSchedule(client, ...)`), so only rule 3 is computed here. Rules 1 and 2 arrive as `opts.hints` resolved before the transaction (do not call Zoho/Redis inside the tx; `__tests__/db/batch-create-latency.test.js` guards this).

Opts pattern (:163-168):

```js
async function createBatch(client, payload, opts) {
  var p = Object.assign({}, payload || {});
  opts = opts || {};
  var actor = str(opts.actor);
  var now = toDate(opts.now);
```

Business rejection style (:70-72, resolve do not throw): `function fail(error, message) { return { ok: false, error: error, message: message }; }`. Unknown type never rejects (D-07). Replay (`replayResult` :118) and dedup paths do not re-classify. Client-sent `batch_type` honoured only for `source` manual/internal, stored with source `manual`.

Test analog: `__tests__/db/batch-pg-create.test.js`, `batch-pg-create-internal.test.js` (source-specific create).

---

### `zoho-middleware/lib/batch-pg-update.js` (modify)

**Analog:** itself.

1. `FIELD_KINDS` (:69-90) is a fixed allowlist, field to kind. `completed_at: 'timestamp'` is already there. Add `batch_type: 'text'` handled with enum validation (new `kind`, or validate before `prepareFieldValues` like the Phase 90 source guard). `batch_type_source` and `completed_at_source` must NOT be in `FIELD_KINDS` (client cannot forge); stamp them server-side only, and only via an `opts.trusted` channel for backfills.
2. Source-guard precedent to copy for the manual-type guard (:274-287): shallow-copy `updates`, decide, never mutate the caller's object.

```js
if (updates.source !== undefined) {
  var sourceDecision = batchRules.sourceTransitionDecision(row.source, updates.source);
  if (sourceDecision.ok === false) return sourceDecision;
  var copy = {};
  Object.keys(updates).forEach(function (k) { copy[k] = updates[k]; });
  ...
  updates = copy;
}
```

3. D-23 stamp: after `prepareFieldValues` and where status handling lives (:315-323), when `values.status === 'complete'` and `row.completed_at` is blank and no `completed_at` supplied: set `values.completed_at = now` and `completed_at_source = 'status'`. Mirror how `fermentation_started_at` is stamped on pending to active (:320-322). Regression test FIRST (CLAUDE.md rule 3).
4. The dynamic SET builder (:325-339) uses `addSet(col, value)` with a fixed column list; add the source columns there, not from user input.
5. Packaging-completion existing stamp, for reference of the real-completion semantics: `lib/batch-pg-tasks.js:159-168` (`patchBatch(client, row, { status: 'complete', completed_at: now }, now)`). Real completions there should also set `completed_at_source` (e.g. `'task'`) if the plan wants all rows marked.
6. Return shape stays `{ ok:true, message, newVersion, _batchId, _vesselApplied }` (:343-349).

Test analog: `__tests__/db/batch-pg-update-source.test.js` (full harness):

```js
var pgHarness = require('./helpers/pg-harness');
var describeDb = pgHarness.describeDb;
var OPTS = { actor: 'staff@example.com', now: NOW };
describeDb('...', function () {
  beforeAll(async function () {
    var started = await pgHarness.startPostgres();
    var migrateResult = pgHarness.applyMigrations(started.connectionString);
    ...
    jest.resetModules();
    var db = require('../../lib/db');
    upd = require('../../lib/batch-pg-update');
    pool = db.createPool(started.connectionString);
  }, 120000);
  harness = pgHarness.rollbackEachTest(function () { return pool; });
  // addBatch helper inserts a minimal row; asserts via 'select * from batches where batch_id = $1'
```

---

### `zoho-middleware/lib/batch-pg-read.js` (add `getDashboardStats`)

**Analog:** itself, `getDashboardSummary` (:197-209) and SQL constants (:57-71).

Rules of the module (header :3-19): never require `pg`, takes `client`, SQL in module-level constants with `$n` only, results wrapped with `ok(data)`, nothing cached here.

```js
var DASHBOARD_BATCHES_SQL =
  'select batch_id, status, product_name, ... start_date ' +
  'from batches ' + ID_ORDER_BATCH;
var ACTIVE_BATCH_TASKS_SQL =
  'select t.* from batch_tasks t join batches b on b.batch_id = t.batch_id ' +
  "where b.status in ('primary', 'secondary') order by length(t.task_id), t.task_id";

function getDashboardSummary(client, opts) {
  var o = opts || {};
  return Promise.all([ client.query(DASHBOARD_BATCHES_SQL), client.query(ACTIVE_BATCH_TASKS_SQL) ])
    .then(function (res) { ... return ok(summary); });
}
```

New constants must be lean (RESEARCH Pattern 3): `to_char(start_date, 'YYYY-MM-DD') as start_date`, `to_char(completed_at at time zone 'America/Vancouver', 'YYYY-MM-DD') as completed_day`, `left join ferm_schedules ... category` for rule 3 and `schedule_category`, task counts via the existing `TASK_COUNTS_SQL` (:53-55) shape. Omit `customer_*`, `access_token`, `notes`, snapshots. `DEFAULT_TIMEZONE = 'America/Vancouver'` is at :26; compute `asOf.today` with `batchRules.formatDay(now, tz)`. Export in the `module.exports` block (:282-297).

Test analog: `__tests__/db/batch-pg-read.test.js` (real PG, golden). Assert absence of `customer_*`/`access_token` keys.

---

### `zoho-middleware/lib/batch-store.js` (add `dashStats`, memo, `finish()` invalidation)

**Analog:** itself.

Read-op template (:131-135):

```js
function dashboard() {
  return dispatch('dashboard', function (client) {
    return pgRead().getDashboardSummary(client, { now: new Date() });
  });
}
```

`dispatch` (:107-113) resolves `null` outside postgres mode, which is how sheets mode falls through. Add `dashStats` the same way, wrapped by a module-level memo `{ at, value }` with an injectable clock, TTL 60 s.

Invalidation point: every successful write passes through `finish(raw)` (:76-93). Clear the memo inside `if (raw && raw.ok)`. `remove` is built by `simpleWrite(... finish)` so it is covered.

```js
function finish(raw) {
  if (raw && raw.ok) {
    var seen = {};
    ...
  }
  return strip(raw);
}
```

Create path (:201-213): resolve type hints BEFORE `dispatch`/`runPg` (async Redis lookup of `zoho:kiosk-products`, key `C.CACHE_KEYS.KIOSK_PRODUCTS`, `lib/constants.js:23`; entries carry `item_id`, `sku`, `cf_type`; index by both sku and item_id, per `routes/catalog.js` ~860-875), then pass through `pgOpts`:

```js
var pgOpts = { actor: o.actor, now: o.now };
if (opts && typeof opts.replayWindowMs === 'number') pgOpts.replayWindowMs = opts.replayWindowMs;
return pgCreate().createBatch(client, payload, pgOpts);
```

Header constraint (:16-17): do NOT `require('./constants')` at the top (route tests mock it partially). Require lazily inside a helper like the existing `flag()`/`db()` accessors (:32-39).

Test analog: `__tests__/batch-store.test.js` (mocked pg modules), `batch-store-flag.test.js`.

---

### `zoho-middleware/lib/batch-proxy.js` (add stats action, separate map)

**Analog:** itself, `ACTION_TO_OP` (:21-39) and `intercept` (:62-101).

Do NOT add to `ACTION_TO_OP` or `WRITE_ACTIONS`: `__tests__/batch-proxy-routes.test.js` pins exactly 17 actions and iterates the map. Add a second map consulted by `intercept`:

```js
var opName = ACTION_TO_OP[action];
if (!opName) return false;           // becomes: ACTION_TO_OP[action] || STATS_ACTION_TO_OP[action]
...
if (flag.getMode() !== 'postgres') return false;   // sheets mode forwards to Apps Script
...
work = batchStore()[opName](payload, { actor: actor });
...
.catch(function (err) {
  log.error('[' + logTag + '] ' + action + ' (store) failed: ' + msg(err));
  res.status(502).json({ ok: false, error: 'server_error' });
});
```

Error contract: collapse to 502 `{ok:false,error:'server_error'}` with no detail; reads may be retried by the client (BrewPad read-retry), writes never. Export the new map alongside `ACTION_TO_OP`.

---

### `zoho-middleware/routes/pos.js` (allowlist, BrewPad proxy only)

**Analog:** itself, lines 4295-4341.

Add `get_dashboard_stats: true` to `ADMIN_PROXY_ACTIONS` (reads group, :4296-4303) AND `ADMIN_PROXY_READS` (:4333-4341). Do NOT touch the admin-panel proxy lists (`admin-proxy.test.js` pins 39). Auth is inherited:

```js
router.post('/api/batch/admin-proxy', function (req, res) {
  authTiers.requireTiers(['legacy', 'session'])(req, res, function () {
  ...
  if (batchProxy().intercept(action, payload, req, res, 'batch/admin-proxy')) return;
```

Test analog: `__tests__/batch-proxy-routes.test.js` lines 1-60 (mock `express` to capture `mockRouteHandlers['POST:/api/batch/admin-proxy']`, mock `../lib/session`, real `authTiers` and `batch-flag` driven by env, mocked `batch-store`). Reuse that harness for `batch-dash-stats-route.test.js`; do not edit the existing file.

---

### `scripts/backfill/batch-type-backfill.js` and `completed-at-backfill.js` (CLI)

**Analog:** `zoho-middleware/scripts/backfill/batches-replay-to-sheet.js` (229 lines). Also `batches-backfill.js` lines 569-700 for the `--dry-run` flag vocabulary and `backfill.js:30` `EXIT`.

Imports and exit codes (:26-33):

```js
var backfillCli = require('./backfill');
var EXIT = backfillCli.EXIT;               // { OK:0, ERROR:1, REJECTS_BLOCK:2, CHECKS_FAILED:3 }
var POSTGRES_URL_RE = /postgres(ql)?:\/\//;
```

Arg parsing (:42-64): copy verbatim. Refuses Postgres URLs on argv, unknown flags throw. D-09/D-16 want an explicit `--dry-run`; accept `--dry-run` (explicit no-op default) and `--apply`; passing both is an error (see `batches-backfill.js:639-640`).

```js
if (POSTGRES_URL_RE.test(arg)) {
  throw new Error('pass the database via BACKFILL_DATABASE_URL, never on the command line');
}
```

Read-only transaction per read (:74-105):

```js
var client = await pool.connect();
try {
  await client.query('begin transaction read only');
  ...
  await client.query('commit');
} catch (err) {
  await client.query('rollback').catch(function () {});
  throw err;
} finally {
  client.release();
}
```

Runner shape (:144-190): `async function runX(opts, deps)` with `deps = {pool, log, env}` and a result object `{exitCode, ...counts}`; dry run logs and returns before any write; `main()` (:192-219) builds `db.createPool(process.env.BACKFILL_DATABASE_URL, { max: 2 })`, runs, `pool.end()`, `process.exit(result.exitCode)`; guarded by `if (require.main === module) main();`; exports `{ runX, parseArgs, EXIT }` for tests.

Differences from the analog (new behaviour):
- Writes go through `batch-pg-update.updateBatch(client, { batch_id, updates: {...} }, { trusted: true, actor: 'backfill', now })` inside `db.withTransaction`, not ad-hoc SQL (RESEARCH Don't Hand-Roll). Re-assert `batch_type_source is distinct from 'manual'` under the row lock; row-count gate against the dry-run count.
- Dry-run output must list EVERY batch: `batch_id type rule product_sku` (type backfill) and `batch_id proposed_iso source` (completed-at), plus type x rule count table, needs-type count, and the count of proposed dates before `start_date`. Ids, counts, field names only (no customer data).
- B2 follow-up is the existing replay CLI itself: `node scripts/backfill/batches-replay-to-sheet.js --since=<apply start> --apply` (`completed_at` is a mirrored column). **Corrected at planning:** B3 needs the replay too on production (`updateBatch` bumps the mirrored `last_updated`); neither replays on staging.
- Zoho `cf_type` for historical SKUs: live all-items fetch, indexed by `sku` and `item_id` (RESEARCH backfill design step 2). No analog exists for the Zoho fetch inside a backfill; reuse `lib/zoho-api.js` `zohoGet`.

Test analog: `__tests__/backfill/batches-replay-to-sheet.test.js` (fake pool, no DB):

```js
var replay = require('../../scripts/backfill/batches-replay-to-sheet');
function fakePool(state, tombstones, existing) {
  var client = {
    query: jest.fn(function (sql, p) {
      if (/^(begin transaction read only|commit|rollback)$/.test(sql)) return Promise.resolve({ rows: [] });
      if (/from batches where last_updated/.test(sql)) { ... }
      return Promise.reject(new Error('unexpected query: ' + sql));
    }),
    release: jest.fn()
  };
  return { queries: queries, params: params, connect: jest.fn(function () { return Promise.resolve(client); }) };
}
it('refuses Postgres URLs and unknown flags', function () {
  expect(function () { replay.parseArgs(['--x=postgres://u:p@h/d']); }).toThrow(/BACKFILL_DATABASE_URL/);
```

Real-PG companions: `__tests__/db/batches-backfill.test.js`, `__tests__/db/backfill.test.js`.

---

### `js/brewpad.js` pure helpers (`getDashboardData`, `dashboardWindow`, needs-type filter, effective type)

**Analog:** `filterBatchesByUnlinked` (:216-231): top-level pure ES5 function, null-safe, normalised strings, exported at the bottom.

```js
function normBatchSource(source) {
  return String(source === null || source === undefined ? '' : source).trim().toLowerCase();
}
function filterBatchesByUnlinked(batches) {
  return (batches || []).filter(function (b) {
    if (!b) return false;
    ...
    var s = String(b.status || '').trim().toLowerCase();
    return s !== 'disabled' && s !== 'deleted';
  });
}
```

Effective-type fallback analog: `resolveBatchType` (:299-357), `KNOWN_BATCH_TYPES` :299. Keep it as the fallback for NULL `batch_type` (staging on sheets, pre-backfill). Its step 3 (`schedule_snapshot.category`) is dead code (RESEARCH Pitfall 7); do not copy that step. `bucketBatchesByMonthType` (:358+) uses `start_date || created_at`, which conflicts with D-17/D-18; the new path must not fall back to `created_at`.

New code (cycle time, windows) per RESEARCH Code Examples: `dayNumber` via `Date.UTC`, `cycleDays`, `median`, `dashboardWindow(key, asOfToday)`, `inWindow` using ISO string compare. No `new Date()`, no `getFullYear()`, no local getters; `asOf.today` comes from the server aggregate.

`needsType` predicate to mirror UI-SPEC section 3: effective type `other` AND `batch_type_source !== 'manual'`; exclude disabled/deleted like Unlinked.

Exports: add each pure helper to `module.exports = Object.assign(module.exports || {}, { ... filterBatchesByUnlinked: filterBatchesByUnlinked, ... })` (:11870-11889).

Test analogs:
- `tests/frontend/brewpad-dashboard-chart.test.js` (:1-30): stub `document`, `window`, `navigator`, `google`, `fetch`, `localStorage`, `sessionStorage`, then wire `js/lib/auth` primitives as globals, then `require('../../js/brewpad')`. Pure-function tests with fixed `now`/`asOf` (never the wall clock).
- `tests/frontend/brewpad-unlinked-filter.test.js` :1-61: same preamble; `describe` per helper; null/undefined input gives `[]`.

---

### `js/brewpad.js` `loadDashboard` / `renderDashboard` (modify)

**Analog:** itself. The bug and replacement point:

```js
// js/brewpad.js:4012-4035
if (_allBatchesData.length > 0) {
  var thisYear = new Date().getFullYear();
  ...
  var daysDone = Math.floor((Date.now() - new Date(b.start_date)) / 86400000);   // :4023 now minus start (the 173 bug)
  ...
  html += '<div class="bp-stat-grid">';
  html += '<div class="bp-stat-card"><div class="bp-stat-num">' + activeNow + '</div><div class="bp-stat-label">Fermenting now</div></div>';
  ...
  html += '<div class="bp-stat-card"><div class="bp-stat-num">' + (avgDays !== null ? avgDays : '—') + '</div><div class="bp-stat-label">Avg days to complete</div></div>';
```

Keep the tile markup vocabulary (`bp-stat-grid`, `bp-stat-card`, `bp-stat-num`, `bp-stat-label`) and the `TYPE_COLORS`/`TYPE_LABELS`/`TYPE_ORDER` constants (:4041-4043). Wide tile adds only `bp-stat-card--wide`. Dashboard error state: `<p class="bp-empty">` in `#bp-dashboard-inner` (:3958-3960).

Cache bust on writes: `afterBatchWrite` (:2794+) sets `_dashLoadTime = 0` so the next dashboard entry refetches. Any new aggregate state variable (`_dashData`) must be reset there and added to both test seams (below). Degrade to the existing `get_batches` path when the aggregate returns `invalid_action` (sheets mode).

---

### `js/brewpad.js` "Needs a type" chip

**Analog:** Phase 90 Unlinked chip, exact copies at four sites.

Chip definition (:4666): `{ val: 'unlinked', label: 'Unlinked' }` becomes an added entry `{ val: 'needsType', label: 'Needs a type' }` after it.

Label with always-visible count (:4683-4684):

```js
var chipLabel = f.val === 'unlinked' ? f.label + ' (' + filterBatchesByUnlinked(_allBatchesData).length + ')' : f.label;
shellHtml += '<button type="button" class="bp-filter-btn' + active + '" data-status="' + f.val + '">' + chipLabel + badge + '</button>';
```

Live count refresh on persisted shell (:4744-4746):

```js
if (btn.getAttribute('data-status') === 'unlinked') {
  btn.textContent = 'Unlinked (' + filterBatchesByUnlinked(_allBatchesData).length + ')';
}
```

Row filtering branches (:4501-4502 and :4783): `else if (_batchStatusFilter === 'unlinked') { _batchesData = filterBatchesByUnlinked(_allBatchesData); }`. Add a parallel `'needsType'` branch at both. Empty state copy `Every batch has a type.` through the existing `.bp-empty`. Do not add the orange badge (only pending/readyToBottle use :4679-4681).

Test analog: `tests/frontend/brewpad-unlinked-filter.test.js` (chip count including `(0)`, empty state).

---

### `js/brewpad.js` detail pane Type row and handler

**Analog (markup):** info grid in `renderBatchDetail`, :6288-6299; insert immediately after the Product row:

```js
html += '<div class="bp-detail-info">';
html += '<div class="bp-detail-info-row"><span class="bp-detail-info-label">Product</span><span>' + escapeHTML(b.product_name || b.product_sku || '—') + '</span></div>';
html += '<div class="bp-detail-info-row"><span class="bp-detail-info-label">Customer</span><span id="bp-detail-customer">' + ... + '</span></div>';
```

Use `escapeHTML` on every interpolated value; ids like `bp-detail-type`.

**Analog (write call):** `markBatchSource` (:2693-2701). Must send `batch_id` and nested `updates` (top-level fields silently no-op; memory note on `gb:` cache and RESEARCH Pitfall 9):

```js
function markBatchSource(batchId, nextSource) {
  return adminApiPost('update_batch', {
    batch_id: batchId,
    updates: { source: nextSource }
  }).then(function (res) {
    afterBatchWrite(batchId, { refreshOpenDetail: true, listAffecting: true });
    return res;
  });
}
```

**Analog (handler wiring after `detailPane.innerHTML = html`, :6467-6482):** disable control, call, then toast; on failure re-enable and toast.

```js
unmarkInternalBtn.disabled = true;
markBatchSource(b.batch_id, 'manual').then(function () {
  ...
  showToast('Marked as not internal', 'success');
}).catch(function (err) {
  unmarkInternalBtn.disabled = false;
  showToast('Failed: ' + ((err && err.message) || 'could not update'), 'error');
});
```

Differences per UI-SPEC: `change` event on a native `<select class="bp-select">`, save immediately, on failure revert the select value and show `Could not update type. Try again.`; deleted/disabled renders plain text via the same status test as :229.

---

### `js/brewpad.js` test seams

**Analog:** `getStateForTest` / `_setStateForTest` (:11830-11855). Additive pattern:

```js
getStateForTest: function () { return { _batchesLoaded: _batchesLoaded, ..., _dashSummary: _dashSummary }; },
_setStateForTest: function (patch) {
  ...
  if ('_dashSummary' in patch) _dashSummary = patch._dashSummary;
},
```

Add `_dashData` to both. Existing tests must be unaffected (additive keys only).

---

## Shared Patterns

### PG-only columns (never mirrored)
**Source:** `lib/batch-compare.js:19` (`unit_seq` comment), `lib/batch-rules.js:25` `BATCH_COLUMNS`
**Apply to:** migration 0007, create, update, aggregate, both backfills.
New columns stay out of `BATCH_COLUMNS`/`serializeBatch`/`buildBatchList`. Sheet mirror drops unknown keys, so no Apps Script change and the Phase 89 `missing_header` trap does not apply. Golden tests (`__tests__/batch-rules.test.js`, `__tests__/db/batch-pg-read.test.js`), `batches-spec-headers.test.js` and the drift check stay untouched. CLAUDE.md rule 10: do not edit existing tests.

### Business rejection vs infrastructure error
**Source:** `lib/batch-pg-create.js:70-72`, header :8-9
**Apply to:** all new pg-layer code. Business rejections resolve `{ok:false, error, message}`; infrastructure errors propagate and roll back the caller's transaction. Modules receive `client` and never create a pool.

### Constant SQL and `$n` placeholders
**Source:** `lib/batch-pg-read.js:31-82`, `lib/batch-pg-update.js:62-63`
**Apply to:** `getDashboardStats`, backfill queries. Module-level string constants, bound parameters only, no interpolation. Dynamic SET only from a fixed column allowlist (`FIELD_ORDER`).

### Admin-proxy actions (staff-only reads/writes)
**Source:** `routes/pos.js:4343-4369` plus `lib/batch-proxy.js:62-101`
**Apply to:** `get_dashboard_stats`, `update_batch` with `updates:{batch_type}`. `authTiers.requireTiers(['legacy','session'])`, identity from session only, `hardenProxyPayload` coerces `source` (:4290). `trusted` is never set by `batch-proxy`.

### Backfill CLI conventions
**Source:** `scripts/backfill/batches-replay-to-sheet.js:1-24, 42-64, 192-223`
**Apply to:** both new CLIs. Dry run by default, `--apply` to write, `BACKFILL_DATABASE_URL` from env only (never argv), ids/counts/field names only, run in the prod container via `railway ssh` (memory: phase-84, tunnel fails). Owner reviews full dry-run output in-session before `--apply`.

### Write then bust the frontend caches
**Source:** `js/brewpad.js:2693-2701` and `afterBatchWrite` :2794-2816
**Apply to:** the type edit handler. Always `batch_id` + nested `updates`, then `afterBatchWrite(batchId, { refreshOpenDetail: true, listAffecting: true })`.

### Frontend ES5 and build
**Source:** CLAUDE.md
**Apply to:** all `js/brewpad.js` work. ES5 only (`var`, function expressions, no arrow/template literals). Edit `js/brewpad.js` and `css/brewpad.css` only, then `npm run build`. Never edit `*.min.js`/`*.min.css`.

### Test conventions
**Frontend:** preamble stubs (`global.google`, `fetch`, `localStorage`, `sessionStorage`) then `require('../../js/lib/auth')` globals then `require('../../js/brewpad')` (see `brewpad-unlinked-filter.test.js:5-29`).
**Middleware unit:** plain `require('../lib/...')`, fake pool objects (`batches-replay-to-sheet.test.js:29-52`).
**Real PG:** `describeDb` + `pgHarness` + `rollbackEachTest`, run via `npm run test:db`.
**All:** fixed clocks (`NOW`/`asOf`), never the wall clock. Run under Node 24 (`nvm use`); Node 20 tzdata flips Vancouver offset from 2026-11-01.

## No Analog Found

| File / Concern | Role | Data Flow | Reason |
|----------------|------|-----------|--------|
| In-process 60 s memo inside `batch-store.js` | service (cache) | cache | Phase 87 store deliberately has no read cache (`batch-pg-read.js` header :12-13); the nearest cache code is Redis `lib/cache.js`, which RESEARCH rejected. Write a tiny `{at, value}` memo with an injected clock and clear it in `finish()`. |
| Zoho `cf_type` lookup by SKU in `resolveTypeHints` | service helper | request-response (Redis read) | `routes/catalog.js` builds the `zoho:kiosk-products` cache (key `lib/constants.js:23`, TTL 1800 at catalog.js:93) but no lib module reads it by sku/item_id yet. Copy the cache-read call style from `lib/cache.js` consumers; treat a miss as "no hint". |
| Zoho all-items fetch inside a backfill CLI | utility | batch | Existing backfills read xlsx snapshots (`read-xlsx.js`) or PG only; none call Zoho. Use `lib/zoho-api.js` `zohoGet` (see `routes/catalog.js:527` comment: list endpoint carries `cf_type`). |
| Server-side completed-at stamp on status change (D-23) | service | CRUD | Closest precedent is the `fermentation_started_at` stamp at `batch-pg-update.js:320-322` and `batch-pg-tasks.js:165`; no existing "stamp completed_at on status edit" code. |

## Metadata

**Analog search scope:** `zoho-middleware/lib`, `zoho-middleware/migrations`, `zoho-middleware/scripts/backfill`, `zoho-middleware/routes/pos.js`, `zoho-middleware/__tests__` (root, `db/`, `backfill/`), `js/brewpad.js`, `tests/frontend/`
**Files read:** 14 (plus targeted line ranges of `js/brewpad.js`, `routes/pos.js`)
**Pattern extraction date:** 2026-10-23
