# Phase 69: BrewPad Batch-View UX — Pattern Map

**Mapped:** 2026-08-12
**Files analyzed:** 3 (js/brewpad.js, js/brewpad.min.js [build artifact], apps-script/adminApi.gs) + frontend test file(s)
**Analogs found:** 4 / 4 (all analogs are within the same files — this is a modify-in-place phase, not new-file scaffolding)

---

## ⚠️ CRITICAL: CONTEXT.md's stated server root cause is WRONG — verify before planning the `.gs` change

CONTEXT.md (`## Decisions` → Freshness fix → Server) says to add `'gds'` to `_invalidateBatchCache`'s
key list because that's the cache key behind `get_dashboard_summary`, which supposedly holds
`readyToBottle`. **This is incorrect and, if implemented as written, fixes nothing:**

| Claim in CONTEXT.md | What the code actually does |
|---|---|
| Client fetches `get_dashboard_summary` (cache key `gds`, 60s TTL, function `getDashboardSummary()`) | Client (`brewpad.js` `eagerLoad()` line 2756 and `loadDashboard()` lines 2821/2830) calls **`get_batch_dashboard_summary`** — cache key **`'gbds'`**, 300s TTL, function **`getBatchDashboardSummary()`** (`adminApi.gs:196-199`) |
| `readyToBottle` lives under `gds` | `readyToBottle` is computed inside `getBatchDashboardSummary()` (`adminApi.gs:1852-1883`), i.e. it's under **`gbds`**, not `gds` |
| `_invalidateBatchCache` doesn't bust the key BrewPad's dashboard reads from | `_invalidateBatchCache` (`adminApi.gs:3268-3276`) already busts `['gbl','gtu','gbds','gbi','gfs']` — **`'gbds'` is already in the list**, and `bulk_update_batch_tasks` already calls `_invalidateBatchCache(payload.batch_id)` (`adminApi.gs:373-377`) |

`get_dashboard_summary` / `gds` / `getDashboardSummary()` is a **separate, unrelated endpoint** used
only by `js/admin.js` (confirmed via repo-wide grep — brewpad.js never references `get_dashboard_summary`
in source). CONTEXT.md's owner/orchestrator recon conflated the two "dashboard summary" endpoints.

**Practical implication for planning:** the server-side cache for the actual data BrewPad reads is
**already invalidated correctly** on every `bulk_update_batch_tasks` write. The bug is **100% client-side**
— the client just never re-fetches `_dashSummary` after the write (it calls `renderDashboard()`, which
renders the in-memory object from before the write, not `loadDashboard()`, which would re-fetch — and
by the time it fetches, the server cache is already fresh). Adding `'gds'` to `_invalidateBatchCache`
is harmless but pointless; it does not touch `'gbds'` and does not change behavior for this bug.

**Recommendation for the plan:** either (a) drop the `apps-script/adminApi.gs` change entirely (no
owner redeploy needed — re-verify with the owner before assuming this human-action step is required),
or (b) if the team still wants defensive `gds` invalidation for parity/future-proofing, do it but do
NOT present it as "the fix" — the client refetch alone is necessary and sufficient. Flag this explicitly
in the plan so the human-action-gate note (mirroring phase 64-03) isn't added for something that doesn't
fix the reported bug.

---

## File Classification

| File | Role | Data Flow | Nature of change | Analog (same file, different function) |
|---|---|---|---|---|
| `js/brewpad.js` — dashboard task-checkbox handler (~8144-8200) | event handler (DOM `change` delegate) | request-response (fire POST, then must refetch) | modify: swap `renderDashboard()`-from-cache for a forced refetch | `js/brewpad.js:6670-6672` (Schedule&Activate success handler — the established "bust + explicit `loadDashboard()`" pattern) |
| `js/brewpad.js` — tasks-tab task-checkbox handler (~8313-8369) | event handler (DOM `change` delegate) | request-response | modify: same refetch requirement (this is the file CONTEXT.md mislabeled "batch-detail ~8315" — see flag below) | same as above |
| `js/brewpad.js` — batch-detail-pane task-checkbox handler (~8413-8450) | event handler (DOM `change` delegate) | request-response | **currently doesn't call `afterBatchWrite` at all** — needs to be added, not just adjusted (see flag below) | `js/brewpad.js:8174` / `8343` (sibling checkbox handlers' `afterBatchWrite` call) |
| `js/brewpad.js` — batch-view filter bar `filterOpts` (~3440-3446) + filter-apply (`filterBatchesByStatus`, line 188) | utility / transform (pure filter fn) + component (filter bar render) | CRUD-adjacent (client-side list filter) | add: new filter option + new predicate | `filterBatchesByStatus` itself (line 188-199) — exact same shape/signature to extend or sibling |
| `apps-script/adminApi.gs` — `_invalidateBatchCache` (3268-3276) | utility (cache invalidation) | event-driven (write → cache bust) | add `'gds'` key **(see critical flag above — verify necessity first)** | itself; other write handlers calling it (lines 348-434) are the analog for "how a new key would be consumed" |
| `js/brewpad.min.js` | build artifact | n/a | regenerate via `npm run build` — never hand-edit | n/a |
| new frontend test(s) | test | request-response / pure-fn | add | `tests/frontend/brewpad-after-batch-write.test.js` (state-accessor pattern) + `tests/frontend/brewpad-activation.test.js` / `brewpad-pull-from-zoho.test.js` (structural source-text pattern) + `tests/frontend/brewpad-pure.test.js` (pure-fn pattern for the new filter predicate) |

---

## Pattern Assignments

### 1. The dashboard load path — `loadDashboard()` is the function to reuse for the refetch

**File:** `js/brewpad.js`

`_dashSummary` / `_dashLoadTime` are declared at lines 826-827. There are exactly two places that
populate `_dashSummary` from the network:

**`eagerLoad()`** (lines 2744-2807) — used once on initial tab load, via `Promise.all` with 4 other
calls, sets `_dashSummary` + `_dashLoadTime` at lines 2764-2767 only if the `get_batch_dashboard_summary`
call succeeded (`r0`).

**`loadDashboard()`** (lines 2817-2838) — **this is the function to call for a forced refetch.** It is
already used for exactly this purpose elsewhere (see Pattern 2 below):

```javascript
// js/brewpad.js:2817-2838
function loadDashboard() {
  _dashLoadTime = Date.now();
  // Fetch summary + upcoming tasks together for the workload chart
  Promise.all([
    adminApiGet('get_batch_dashboard_summary'),
    adminApiGet('get_tasks_upcoming', { limit: 100 })
  ]).then(function (results) {
    _dashSummary = results[0].data || null;
    _upcomingTasks = (results[1].data && results[1].data.tasks) || _upcomingTasks;
    if (results[1].data) { _upcomingLoaded = true; _upcomingLoadTime = Date.now(); }
    renderDashboard();
  }).catch(function (err) {
    // Degrade gracefully: try summary-only
    adminApiGet('get_batch_dashboard_summary').then(function (r) {
      _dashSummary = r.data || null;
      renderDashboard();
    }).catch(function (e) {
      var inner = document.getElementById('bp-dashboard-inner');
      if (inner) inner.innerHTML = '<p class="bp-empty">Failed to load dashboard: ' + escapeHTML(e.message) + '</p>';
    });
  });
}
```

Note it already fails soft (keep-last-good is NOT literally implemented here — on total failure it
replaces the dashboard with an error message rather than preserving the last-good `_dashSummary`).
If CONTEXT.md's "a refetch failure must not wedge the UI (keep-last-good)" requirement must hold
strictly, the fix should NOT let a failed `loadDashboard()` call blow away the optimistically-animated
row; simplest correct approach: call `loadDashboard()` fire-and-forget after the optimistic animation,
and don't gate the animation on its result.

`renderDashboard()` itself (line 2863) is a pure render of `_dashSummary` — it does **not** fetch.
This is the function currently (mis)used by the checkbox handler after a write; it must be replaced
by (or supplemented with) a `loadDashboard()` call to get fresh data.

**Existing switchTab TTL-gate model** (line 2059-2061) — shows how freshness is normally checked
elsewhere in the file, useful if the fix wants a threshold rather than an unconditional refetch:
```javascript
// js/brewpad.js:2059-2061
var now = Date.now();
if (tab === 'dashboard') {
  if (now - _dashLoadTime > CACHE_TTL_LONG) loadDashboard();
```
For this fix, CONTEXT.md is explicit: force it (`_dashLoadTime = 0` then call the load path), don't
just check the TTL, since the write itself is what invalidated the data.

---

### 2. `afterBatchWrite` + the established "dashboard-affecting write" pattern already in the codebase

**File:** `js/brewpad.js`, `afterBatchWrite` definition at lines 1982-2017:

```javascript
// js/brewpad.js:1982-2017
function afterBatchWrite(batchId, opts) {
  opts = opts || {};

  // (A) Remove the per-batch sessionStorage detail snapshot ...
  try { sessionStorage.removeItem('sv-bp-batch-' + batchId); } catch (e) {}
  if (_preloadBatchId === batchId) {
    _preloadBatchId = null;
    _preloadPromise = null;
  }

  // (B) Reset list / dashboard state so the next tab entry fetches fresh data.
  //     Pass opts.listAffecting === false for writes that only affect readings/tasks
  //     (those don't change list cards or dashboard stats).
  if (opts.listAffecting !== false) {
    _batchesLoaded = false;
    _allBatchesData = [];
    _eagerLoadTime = 0;
    _dashLoadTime = 0;
  }

  // (C) If this batch's detail pane is currently open, re-fetch from the server
  //     and re-render immediately ...
  if (opts.refreshOpenDetail && _selectedBatchId === batchId) {
    adminApiGet('get_batch', { batch_id: batchId })
      .then(function (r) { ... })
      .catch(function () {});
  }
}
```

Crucially, `afterBatchWrite`'s `listAffecting: true` branch **only resets `_dashLoadTime = 0`** — it
never itself calls `loadDashboard()`. Every existing "dashboard-affecting" call site that wants an
*immediate* re-render follows up `afterBatchWrite(..., { listAffecting: true, ... })` with an explicit
`loadDashboard()` call. This is the exact reusable pattern for the freshness fix — it already exists
twice in the codebase:

```javascript
// js/brewpad.js:6669-6672 (Schedule & Activate success — "worst offender" per its own comment)
// Bust snapshot + list/dash + re-render open detail (#14 — worst offender)
afterBatchWrite(b.batch_id, { listAffecting: true, refreshOpenDetail: true });
loadDashboard();
```
```javascript
// js/brewpad.js:6680-6683 (same handler's partial-failure branch)
afterBatchWrite(b.batch_id, { listAffecting: true });
loadDashboard();
```

**This `afterBatchWrite({listAffecting:true}) + loadDashboard()` pairing is the direct analog for
the fix** — the plan should apply the exact same pairing to the three checkbox handlers instead of
introducing a new opts flag. (CONTEXT.md leaves the exact flag/call to implementer discretion —
this existing pairing is the natural, already-proven choice; reusing `listAffecting: true` avoids
inventing a new `dashAffecting` opt for no added value, since `listAffecting: true`'s reset already
includes `_dashLoadTime = 0`, and `loadDashboard()` is what turns that reset into an actual fetch+render.)

All 12 `afterBatchWrite(...)` call sites in the file (for reference/consistency check):
`js/brewpad.js:4227, 4475, 4756, 4862, 6135, 6670, 6682, 7617, 7987, 8174, 8343, 8474, 8512`.

---

### 3. The THREE task-checkbox handlers — correcting CONTEXT.md's location claims

CONTEXT.md refers to "the dashboard Ready-to-Bottle handler ~8144 and the batch-detail task handler
~8315." **Line ~8315 is NOT the batch-detail handler — it's the Tasks-tab handler.** There is a
third, distinct handler for the actual batch-detail pane at ~8413-8450 that CONTEXT.md doesn't
mention at all, and it currently has a **materially different (weaker) cache-bust** than the other two.
All three must be checked/fixed since all three can complete a packaging task and thus affect
`readyToBottle`.

**(a) Dashboard handler** — `js/brewpad.js:8144-8200`, attached to `#bp-dashboard-inner` `change` event:
```javascript
// js/brewpad.js:8172-8188 (success callback, abridged)
if (task && task.batch_id) afterBatchWrite(task.batch_id, { listAffecting: false });  // ← currently false
...
if (checked && row && !isVesselChange) {
  row.style.transition = 'opacity 0.3s, max-height 0.3s';
  row.style.opacity = '0';
  row.style.maxHeight = '0';
  row.style.overflow = 'hidden';
  setTimeout(function () { renderDashboard(); }, 400);   // ← renders STALE _dashSummary, no refetch
}
```

**(b) Tasks-tab handler** — `js/brewpad.js:8312-8369`, attached to `#bp-tasks-inner` `change` event.
Same shape, same `listAffecting: false`, same optimistic row-removal animation, but re-renders
`renderTasks()` instead of `renderDashboard()` after the animation (line 8356). `renderTasks()` doesn't
read `_dashSummary` directly, but this handler still needs the `afterBatchWrite`/`loadDashboard()` fix
because completing a task here also changes `readyToBottle`, and the user may then switch to the
dashboard tab expecting it to already be current — `switchTab`'s TTL-gate (Pattern 1, line 2061) won't
refetch if `_dashLoadTime` wasn't reset to 0 (which is what `listAffecting: true` does).

**(c) Batch-detail-pane handler** — `js/brewpad.js:8413-8450`, attached to `#bp-batch-detail-pane`
`change` event, gated additionally on `cb.closest('#bp-detail-tasks')` (line 8419). **This one does
NOT call `afterBatchWrite` at all** — it inlines only the sessionStorage removal:
```javascript
// js/brewpad.js:8429-8442 (success callback, in full)
adminApiPost('bulk_update_batch_tasks', { tasks: [{ task_id: taskId, updates: { completed: checked } }] })
  .then(function () {
    for (var i = 0; i < _upcomingTasks.length; i++) {
      if (_upcomingTasks[i].task_id === taskId) {
        _upcomingTasks[i].completed = checked ? 'TRUE' : 'FALSE';
        break;
      }
    }
    if (row) {
      row.setAttribute('data-save-state', 'saved');
      setTimeout(function () { if (row) row.removeAttribute('data-save-state'); }, 1500);
    }
    if (_selectedBatchId) { try { sessionStorage.removeItem('sv-bp-batch-' + _selectedBatchId); } catch (e) {} }
  })
```
No `_dashLoadTime` reset, no `afterBatchWrite` call, no dashboard refetch trigger of any kind. This
handler needs the fix added, not adjusted — treat it as the third required call site alongside (a)
and (b), and flag to the planner that CONTEXT.md's line number for "batch-detail" (~8315) actually
points at handler (b), not (c). Recommend the plan explicitly enumerate all three handler locations
(8144, 8313, 8413) rather than "two handlers."

**Shared error-handling pattern across all three handlers** (identical shape in each):
```javascript
.catch(function () {
  cb.checked = !checked;
  if (row) row.classList.toggle('bp-task-row--done', !checked);
  if (row) row.setAttribute('data-save-state', 'error');
  showToast('Save failed — try again', 'error');
});
```
The refetch-after-success addition should not touch this `.catch` — it's the correct rollback pattern
already and should be preserved as-is per CONTEXT.md ("a refetch failure must not wedge the UI").

---

### 4. Batch-view filter bar + filter-apply — model for the new "Ready to Bottle" filter

**File:** `js/brewpad.js`

Filter option list + render (inside `renderBatchList()`'s one-time shell build), `js/brewpad.js:3440-3456`:
```javascript
// js/brewpad.js:3440-3456
var filterOpts = [
  { val: 'pending', label: 'Pending' },
  { val: 'active', label: 'Active' },
  { val: 'primary', label: 'Primary' },
  { val: 'secondary', label: 'Secondary' },
  { val: 'complete', label: 'Complete' }
];
var pendingCount = _allBatchesData.filter(function (b) {
  return String(b.status || '').toLowerCase() === 'pending';
}).length;
filterOpts.forEach(function (f) {
  var active = _batchStatusFilter === f.val ? ' bp-filter-btn--active' : '';
  var badge = (f.val === 'pending' && pendingCount > 0)
    ? ' <span style="display:inline-block;min-width:16px;padding:0 5px;border-radius:8px;background:#e67e22;color:#fff;font-size:0.72rem;font-weight:700;line-height:16px;text-align:center;">' + pendingCount + '</span>'
    : '';
  shellHtml += '<button type="button" class="bp-filter-btn' + active + '" data-status="' + f.val + '">' + f.label + badge + '</button>';
});
```
This is **exactly the count-chip pattern CONTEXT.md wants** ("Ready to Bottle (N)") — the `pending`
badge above is the direct analog: add a `readyToBottleCount` computed the same way (from
`(_dashSummary && _dashSummary.readyToBottle || []).length`, NOT re-derived from `_allBatchesData`,
per CONTEXT.md's explicit "reuse the server-computed set" decision) and a matching badge span for a
new `{ val: 'readyToBottle', label: 'Ready to Bottle' }` entry in `filterOpts`.

**Filter-button click handler** (delegated), `js/brewpad.js:8249-8255`:
```javascript
var filterBtn = e.target.closest('.bp-filter-btn');
if (filterBtn) {
  _batchStatusFilter = filterBtn.getAttribute('data-status');
  _batchesData = filterBatchesByStatus(_allBatchesData, _batchStatusFilter);
  renderBatchList();
  return;
}
```
This is the integration point — `filterBatchesByStatus` is the single predicate function driving the
filter. CONTEXT.md's decision is to filter `_allBatchesData` to `{ batch_id ∈ readyToBottle }`
using `_dashSummary.readyToBottle`, not a re-derived client-side rule. The cleanest way to fit this
into the existing pattern without breaking `filterBatchesByStatus`'s pure-status contract (it's
directly unit-tested — see Pattern 5) is a **new sibling pure function** rather than overloading
`filterBatchesByStatus`, e.g.:
```javascript
function filterBatchesByReadyToBottle(batches, readyToBottleList) {
  var ids = {};
  (readyToBottleList || []).forEach(function (r) { ids[String(r.batch_id)] = true; });
  return (batches || []).filter(function (b) { return ids[String(b.batch_id)]; });
}
```
called from the click handler as a special case of `_batchStatusFilter === 'readyToBottle'`, e.g.:
```javascript
if (_batchStatusFilter === 'readyToBottle') {
  _batchesData = filterBatchesByReadyToBottle(_allBatchesData, (_dashSummary && _dashSummary.readyToBottle) || []);
} else {
  _batchesData = filterBatchesByStatus(_allBatchesData, _batchStatusFilter);
}
```
CONTEXT.md also requires: "If `_dashSummary` is not loaded when the filter is selected, load/refetch
it first (reuse the same dashboard load path)" — i.e. `loadDashboard()` (Pattern 1) again, guarded on
`!_dashSummary`.

**Source-of-truth definition already exists and does not need reimplementing** —
`adminApi.gs:1847-1883` (Pattern 6 below) is the single predicate; the plan should NOT port the
`hasIncPkg`/`allNonPkgDone`/`dueReached` logic into `brewpad.js`.

---

### 5. Existing pure-function test pattern for `filterBatchesByStatus` — model for the new filter predicate's test

**File:** `tests/frontend/brewpad-pure.test.js`

```javascript
// tests/frontend/brewpad-pure.test.js:22, 106-128 (structure)
var filterBatchesByStatus = bp.filterBatchesByStatus;
...
describe('filterBatchesByStatus', function () {
  ...
  test('no filter returns all (copy)', function () {
    var result = filterBatchesByStatus(batches, null);
    ...
  });
  test('"all" returns all', function () {
    expect(filterBatchesByStatus(batches, 'all')).toHaveLength(5);
  });
  test('"active" returns primary + secondary', function () {
    var result = filterBatchesByStatus(batches, 'active');
    ...
  });
});
```
The new `filterBatchesByReadyToBottle` (or equivalent) function must be added to the two
`module.exports` blocks the same way `filterBatchesByStatus` is (see `js/brewpad.js:8934` and the
final export block ~8929-8973), then tested with the exact same `describe`/`test` shape: seed a
`batches` array and a `readyToBottle` array with overlapping/non-overlapping `batch_id`s, assert
the filtered set contains exactly the intersection, plus edge cases (empty `readyToBottle`, batch in
`readyToBottle` but absent from `_allBatchesData`, duplicate ids).

---

### 6. `apps-script/adminApi.gs` — `_invalidateBatchCache` and the write-handler call convention

**File:** `apps-script/adminApi.gs`

```javascript
// apps-script/adminApi.gs:3264-3276
/**
 * Invalidate all batch-related caches after a write operation.
 * @param {string} batchId - The batch ID that was modified
 */
function _invalidateBatchCache(batchId) {
  var cache = CacheService.getScriptCache();
  var keys = ['gbl', 'gtu', 'gbds', 'gbi', 'gfs'];
  if (batchId) {
    keys.push('gb:' + batchId);
    keys.push('gbp:' + batchId);
  }
  cache.removeAll(keys);
}
```
`'gbds'` — the key actually consumed by BrewPad's dashboard — **is already present.** If the team
still wants `'gds'` added defensively (see critical flag at top), it's a one-line addition to the
`keys` array; no structural change needed, and per CONTEXT.md's own note this needs an owner Apps
Script redeploy (no CI for `.gs`, mirror phase 64-03's human-action-gate framing) IF it's kept in
scope.

**Write-handler call convention** (how every mutation wires into invalidation), `adminApi.gs:345-382`:
```javascript
// apps-script/adminApi.gs:373-377 — the exact call site for the task-completion write
case 'bulk_update_batch_tasks': {
  var r = bulkUpdateBatchTasks(payload, authResult.email);
  _invalidateBatchCache(payload.batch_id);
  return _jsonResponse(r);
}
```
Confirms `payload.batch_id` is the id passed through — consistent with the client always sending a
single `task.batch_id` per checkbox toggle (both dashboard/tasks/detail handlers post one task at a
time: `{ tasks: [{ task_id: taskId, updates: { completed: checked } }] }`), so `_invalidateBatchCache`
already receives the correct id on every task-completion write today.

**`get_batch_dashboard_summary` read case** (the read the client actually issues):
```javascript
// apps-script/adminApi.gs:196-199
case 'get_batch_dashboard_summary':
  return { ok: true, data: _cachedGet('gbds', 300, function() {
    return getBatchDashboardSummary();
  })};
```
**`readyToBottle` computation** — `getBatchDashboardSummary()`, `adminApi.gs:1847-1883` (predicate
definition CONTEXT.md references and the filter must reuse, not reimplement):
```javascript
// apps-script/adminApi.gs:1852-1883 (readyToBottle assembly, abridged)
var readyToBottle = [];
Object.keys(pkgByBatch).forEach(function (bid) {
  var st = pkgByBatch[bid];
  var meta = batchMeta[bid];
  if (!meta || !st.hasIncPkg) return;
  var due = st.pkgDue;
  var dueReached = !!due && due <= today;
  if (st.allNonPkgDone || dueReached) {
    readyToBottle.push({
      batch_id: meta.batch_id, product_name: meta.product_name, customer_name: meta.customer_name,
      vessel_id: meta.vessel_id, shelf_id: meta.shelf_id, status: meta.status,
      bottling_due: due || '', overdue: !!due && due < today, has_email: !!meta.customer_email
    });
  }
});
```
Confirms the shape available to the filter: `batch_id`, `product_name`, `customer_name`, `vessel_id`,
`shelf_id`, `status`, `bottling_due`, `overdue`, `has_email` — no per-task/packaging-due fields are
exposed beyond this, consistent with CONTEXT.md's warning not to re-derive the predicate from
`_allBatchesData` (which lacks these fields entirely).

---

## Shared Patterns

### "Dashboard-affecting write" refetch
**Source:** `js/brewpad.js:6669-6672` and `6680-6683`
**Apply to:** all three task-checkbox handlers (8144, 8313, 8413)
```javascript
afterBatchWrite(batchId, { listAffecting: true /*, refreshOpenDetail: true if a detail pane may be open */ });
loadDashboard();
```

### Optimistic row-removal animation (preserve, don't replace)
**Source:** `js/brewpad.js:8182-8188` and `8351-8357`
**Apply to:** dashboard + tasks-tab handlers — keep the `opacity`/`maxHeight` transition + `setTimeout`
callback; just change what the callback does at the end (call `loadDashboard()`-driven state instead
of stale `renderDashboard()`/`renderTasks()`), and make sure the refetch doesn't get raced/reverted by
the animation's own re-render.

### Rollback-on-error pattern
**Source:** identical in all three handlers, e.g. `js/brewpad.js:8193-8198`
**Apply to:** unchanged — do not touch this catch block in any of the three handlers.

### Pure-filter-function + dual module.exports registration
**Source:** `filterBatchesByStatus` at `js/brewpad.js:188-199`, exported at `js/brewpad.js:8934` (outer
export block) — note there are TWO `module.exports = Object.assign(...)` blocks in this file (one
inside the IIFE for state-dependent exports ~8877-8925, one outside for pure helpers ~8929-8973);
`filterBatchesByStatus` is a plain top-level function (declared outside the IIFE, line 188) so it goes
in the **outer** block. A new pure `filterBatchesByReadyToBottle` should follow the same placement
(top-level function, outer export block) since it needs no closure state.
**Apply to:** the new Ready-to-Bottle filter predicate.

### Structural/source-text regression test (for handler-internal logic that can't be exercised via DOM)
**Source:** `tests/frontend/brewpad-activation.test.js:171-229`, `tests/frontend/brewpad-pull-from-zoho.test.js:396-431`
```javascript
var src = require('fs').readFileSync(require('path').join(__dirname, '../../js/brewpad.js'), 'utf8');
// locate a function/handler by string, slice a window after it, assert on call order/presence
var handlerIdx = src.indexOf("...");
var window = src.slice(handlerIdx, handlerIdx + N);
expect(window.indexOf('loadDashboard()')).not.toBe(-1);
```
**Apply to:** regression tests proving each of the three checkbox handlers' success callback calls
`loadDashboard()` (not just `renderDashboard()`/`renderTasks()`) after `afterBatchWrite`. This is the
established way to pin behavior of code inside the un-exported IIFE-scoped event handlers — there is
no DOM-dispatch test precedent for these handlers in the existing suite (checked: no `.test.js` in
`tests/frontend/` dispatches synthetic `change` events against BrewPad's task checkboxes).

### State-accessor test pattern (for anything needing `_dashSummary`/`_dashLoadTime` assertions)
**Source:** `tests/frontend/brewpad-after-batch-write.test.js` (whole file) + `js/brewpad.js:8906-8923`
(`getStateForTest` / `_setStateForTest`)
**Apply to:** if the plan wants a more precise (non-structural) test of the refetch fix, `getStateForTest`
currently does NOT expose `_dashSummary` — it will need to be extended (mirror the existing pattern,
add `_dashSummary: _dashSummary` to the returned object and a matching `if ('_dashSummary' in patch)`
line in `_setStateForTest`) to allow tests to seed a stale summary and assert it changes after a
simulated write + `loadDashboard()` call. `loadDashboard` itself is also not currently exported;
exporting it (or exercising it indirectly via `eagerLoad`/handler calls) would be needed for a
non-structural test of the refetch.

---

## No Analog Found

None — this phase modifies three existing handlers, one existing filter bar, and one existing cache
function; every touched piece of logic has direct precedent elsewhere in the same file.

---

## Metadata

**Analog search scope:** `js/brewpad.js` (8973 lines), `apps-script/adminApi.gs` (4071 lines),
`tests/frontend/brewpad-*.test.js` (20 files)
**Key line ranges read:** `js/brewpad.js` 1-40(module exports tail), 180-220, 826-827, 1982-2070,
2740-2880, 3190-3480, 6640-6690, 8120-8530, 8860-8973; `apps-script/adminApi.gs` 1-40, 165-220,
340-435, 1750-1890, 3250-3295
**Files scanned:** grep across full repo for `get_dashboard_summary` cross-reference (confirmed
`js/admin.js` as the sole other consumer); `tests/frontend/` directory listing + grep for DOM
dispatch precedent
**Pattern extraction date:** 2026-08-12
