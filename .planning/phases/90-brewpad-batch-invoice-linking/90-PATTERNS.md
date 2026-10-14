# Phase 90: BrewPad batch invoice linking - Pattern Map

**Mapped:** 2026-10-14
**Files analyzed:** 27 (11 modified source, 4 new source, 12 new test files; grouped below)
**Analogs found:** 27 / 27 (3 are role-match only)
**Scope:** Workstreams A (invoice linking), C (kiosk canning bundle), D (recipe pickers). Phase 91 grain splitting is out of scope.
**Line numbers drift weekly** (RESEARCH note). Re-grep the symbol names before editing.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `apps-script/adminApi.gs` (`updateBatch` source guard + pure `batchSourceTransitionDecision`) | service (store) | CRUD | `batchDedupDecision` (:2576) + `updateBatch` (:2827) in same file | exact |
| `zoho-middleware/lib/batch-rules.js` (`sourceTransitionDecision`) | utility (pure rules) | transform | `dedupDecision` (:305, exported ~:874) | exact |
| `zoho-middleware/lib/batch-pg-update.js` (guard after `lockBatch`) | service (PG store) | CRUD | same file, `isVersionConflict` check + `fail(...)` (:256-272) | exact |
| `zoho-middleware/routes/pos.js` NEW `GET /api/batch/link-candidates` | route/controller | request-response | `GET /api/batch/search-invoices` (:2938) + `scan-invoices` (:3264) | exact |
| `zoho-middleware/routes/pos.js` bundle + can line in `/api/kiosk/sale` and `/api/kiosk/sale/confirm` | route/controller | request-response (money path) | custom-line branch (:590-611 sale, :1264-1290 confirm) | exact |
| `zoho-middleware/lib/kiosk-bundles.js` (NEW, price/cap/SKU table) | utility/config | transform | `_TAX_RULE_PCT` table (pos.js:47) + `lib/constants.js` | role-match |
| `js/brewpad.js` create sheet (invoice picker, internal checkbox, payload) | component | request-response | create submit (:7585-7625) + `fetchSoSearch` (:2123) | exact |
| `js/brewpad.js` `fetchSoSearch` parameterisation + `linkBatchToInvoice` | component | request-response | `fetchSoSearch` / `handleSoSelect` (:2123 / :2359) | exact |
| `js/brewpad.js` Unlinked chip + `filterBatchesByUnlinked` | component/utility | transform | `filterBatchesByStatus` (:203), `filterBatchesByReadyToBottle` (:~215), `applyBatchFilter` (:4025), chip row (:4137-4165) | exact |
| `js/brewpad.js` detail-view candidate cards | component | request-response | `showLinkedSo` (:2411) + link-to-invoice markup (:5666) | role-match |
| `js/brewpad.js` shared recipe dropdown (new-batch, attach, waitlist x2) | component | request-response | `bindRecipePickerSearch` (:7683) | exact |
| `js/brewpad.js` recipe editor dup check + "Start from" | component | request-response | `bpCloneRecipePayload` (:3059) / `bpCloneRecipe` (:3094) / `openRecipeDetail` (:2686) | exact |
| `js/admin.js` recipe editor dup check + "Start from" | component | request-response | `duplicateRecipe` (~:9200), `#recipe-name` (:8680) | role-match |
| `js/lib/recipe-picker.js` (NEW, pure helpers) | utility | transform | `js/lib/recipe-grouping.js` (UMD-ish `module.exports` tail) | exact |
| `js/kiosk-core.js` bundle lifecycle (+ `KioskCore` exports) | service/store | event-driven (cart) | `kioskSyncKitFees` (:772), `kioskRemoveFromCart` (:2070) | exact |
| `js/kiosk-core.js` items payload builder (bundle fields) | transform | request-response | custom-line branch of items map (:2653-2662) | exact |
| `js/kiosk-core.js` `kioskRenderRecipes` search header | component | event-driven | `kioskRenderRecipes` (:1173) | role-match |
| `js/kiosk.js`, `kiosk.html`, `admin.html`/`admin.js` bundle picker modal | component | event-driven | custom-item modal (`js/kiosk.js` ~:762) | role-match |
| `css/brewpad.css`, `css/kiosk.css` | config (style) | n/a | `.bp-vessel-dropdown`, `.bp-confirm-sheet*`, `.kiosk-discount-applied` | exact |
| `custom-labels.html` (:161 copy) | static page | n/a | in-place edit; stamped by `npm run build` | exact |
| Tests (all under Test Patterns below) | test | n/a | see per-file analogs | exact |

## Pattern Assignments

### Workstream A: store guard (`source` manual <-> internal)

#### `apps-script/adminApi.gs` (service, CRUD)
**Analog:** `batchDedupDecision` (pure, top-level, sliceable by tests) and `updateBatch` in same file.

Pure-function shape to copy (adminApi.gs:2576-2610): top-level `function`, no Apps Script globals, returns `null` (allowed) or `{ ok:false, error, message }`. Add `batchSourceTransitionDecision(currentSource, nextSource)` right beside it with the truth table: allowed iff `next===current` OR (`current in {'', 'manual', 'internal'}` AND `next in {'manual','internal'}`); otherwise `{ ok:false, error:'invalid_source', message }`. Treat blank/missing current as `manual` (RESEARCH Pitfall 2). Locked set includes `kiosk_recipe` (omitted from CONTEXT).

Placement (RESEARCH Pitfall 4): call it at the TOP of `updateBatch`, right after the optimistic-lock block and BEFORE the `locationChanged` / VesselHistory writes:
```javascript
// adminApi.gs:2827-2852 (existing head of updateBatch)
function updateBatch(payload, userEmail) {
  if (!payload.batch_id) { return { ok: false, error: 'missing_id', message: 'batch_id is required' }; }
  var result = findRowById(BATCHES_SHEET_NAME, payload.batch_id);
  if (result.row === -1) { return { ok: false, error: 'not_found', message: 'Batch not found: ' + payload.batch_id }; }
  var headers = result.headers; var sheet = result.sheet; var row = result.row;
  var current = result.data; var updates = payload.updates || {};
  // Optimistic locking ... returns { ok:false, error:'version_conflict', ... }
  // <-- INSERT: if (updates.source !== undefined) { var sd = batchSourceTransitionDecision(current.source, updates.source); if (sd) return sd; }
  // Check for vessel/location changes — record history   (writes begin below this)
```
Then add `'source'` to `allowedFields` (adminApi.gs:2912-2926) so the existing loop (`sheet.getRange(row, colIndex+1).setValue(sanitizeInput(String(updates[field])))`, :2928-2935) persists it. `createBatch` (:2705) is unchanged (`sanitizeInput(payload.source || 'manual')` already accepts `'internal'`).

#### `zoho-middleware/lib/batch-rules.js` (utility, transform)
**Analog:** `dedupDecision` (batch-rules.js:305), a port of the .gs function, exported in the `module.exports` block (:874+, alphabetical-ish list: `dedupDecision: dedupDecision,`). Add `sourceTransitionDecision: sourceTransitionDecision,` the same way. Must have a parity test against the .gs function (Test Patterns).

#### `zoho-middleware/lib/batch-pg-update.js` (service, CRUD)
**Analog:** same file.

FIELD_KINDS allow-list (:66-87) currently says "access_token, created_by, source and friends are deliberately absent" (comment must be updated). Add `source: 'text'` to `FIELD_KINDS`, and do the transition check in `updateBatch` after `lockBatch` and before the first write (module invariant "Everything that can reject is checked before the first write"):
```javascript
// batch-pg-update.js:256-275
async function updateBatch(client, args, opts) {
  args = args || {};
  var batchId = args.batch_id;
  if (!batchId) return fail('missing_id', 'batch_id is required');
  var updates = args.updates || {};
  var now = nowOf(opts);
  var row = await batchRead.lockBatch(client, batchId);
  if (!row) return fail('not_found', 'Batch not found: ' + batchId);
  if (isVersionConflict(args.expectedVersion, row)) {
    return fail('version_conflict', 'Batch was modified by another user. Refresh and try again.');
  }
  // <-- INSERT source check here using batchRules.sourceTransitionDecision(row.source, updates.source)
  // Everything that can reject is checked before the first write.
  var prepared = prepareFieldValues(updates);
  if (!prepared.ok) return prepared;
```
Error shape: `fail(error, message)` returns `{ ok:false, error, message }` (:97-99). `prepareFieldValues` (:208) has no row access, so the guard cannot live there.

---

### `zoho-middleware/routes/pos.js` NEW `GET /api/batch/link-candidates` (route, request-response)

**Analog:** `GET /api/batch/search-invoices` (:2938-2998) for the wrapper, validation, sequential-detail-fetch and 502 handling; `scan-invoices` (:3264+) for `MAX_PAGES`/status-set/`detectKitItems` conventions. Do NOT extend scan-invoices (it is the inverse direction and skips already-linked invoices).

**Auth/wrapper pattern** (pos.js:2938-2943, 3264-3267):
```javascript
router.get('/api/batch/link-candidates', function (req, res) {
  authTiers.requireTiers(['legacy', 'session'])(req, res, function () {
  // BrewPad/session-scoped GET (device rejected) — 46-04 interfaces (T-46-18b).
  var search = (req.query.search || '').trim();
  if (!search || search.length < 2) {
    return res.status(400).json({ error: 'Search term must be at least 2 characters' });
  }
```
Replace validation with: `customer_id` /^\d+$/, `customer_name` <=100, `start_date` /^\d{4}-\d{2}-\d{2}$/, bad input -> `400 { error:'bad_request', message }` (scan-invoices style, :3276-3279).

**Hard-capped sequential detail fetch** (pos.js:2951-2988): `var MAX_DETAIL_FETCH = 10;` (use ~6; never request-controlled), `var chain = Promise.resolve(); matched.forEach(... chain = chain.then(function(){ return zohoGet('/invoices/' + inv.invoice_id).then(...) }))`, mapping line items to `{ item_id, name, quantity, rate, amount }`. The list response never carries line items.

**List call** (scan-invoices pattern, pos.js:~3378): `zohoGet('/invoices', { customer_id, date_start, date_end, sort_column: 'date', per_page: 50 })`; statuses allowed must include overdue/partially_paid (scan-invoices' `CANDIDATE_STATUSES` at :3269 is paid/sent/draft only, exclude `void`).

**Kit flag:** `brewpadIntegration.detectKitItems(lineItems)` (used pos.js:~3418). Rank flagged first, then by date distance (RESEARCH A7).

**Reverse index:** `brewpadIntegration.fetchLiveBatchIndex()` (brewpad-integration.js:723) returns `{ byInvoiceNumber, liveBatchIds }` or `null` on failure; null => `linked_batches: null`, `index_available:false`, never "not linked".

**Error handling** (pos.js:2990-2993): `.catch(function (err) { log.error('[batch/search-invoices] Zoho error: ' + (err.message || err)); res.status(502).json({ error: 'Invoice search failed' }); });`. No customer names in logs (zero-PII eventLog).

**Cache:** `cache.get/set(key, value, ttl)` as imported at pos.js:5 (`var cache = require('../lib/cache')`), key from ids/hash.

Response shape proposal is in RESEARCH "Code Examples".

---

### `zoho-middleware/routes/pos.js` bundle + $0 can line (route, money path)

**Analog:** custom-line branch inside `body.items.map` at TWO sites. Implement in a shared helper (new `lib/kiosk-bundles.js`) and call from both; do not copy-paste a third time.

**Sale site** (pos.js:~570-611) and **confirm site** (pos.js:~1255-1290). Current custom branch, which hard-codes 5%:
```javascript
if (item.custom) {
  var qty = Number(item.quantity) || 1;
  var rate = Number(item.rate);
  subtotal += qty * rate;
  var taxable = item.taxable !== false;
  var desc = String(item.description || '').trim().replace(/[\x00-\x1F\x7F]/g, '').slice(0, 100);
  var li = { custom: true, description: fullDesc, rate: rate, quantity: qty,
             tax_percentage: taxable ? 5 : 0 };
  if (taxable) { li.tax_id = gstTaxId; } else if (process.env.ZOHO_TAX_ZERO_ID) { li.tax_id = process.env.ZOHO_TAX_ZERO_ID; }
  return li;
}
```
New kinds to insert BEFORE this branch in both sites:
- `item.bundle_key` in {`beer-25`,`cider-23`}: ignore client `rate`/`taxable`; rate from server table ($40/$35); `tax_percentage: 12`; `tax_id = process.env.ZOHO_TAX_STANDARD_ID` (fallback: catalog discovery modelled on `resolveGstTaxId`, pos.js:58-69, matching `sales_tax_rule_id === (process.env.ZOHO_TAX_STANDARD_RULE || '109900000000033423')`); fail closed 400 using the same message style as the GST fail-closed (pos.js:~585-590, ~1255-1259). Description sanitise identical to custom lines. Keep `custom: true` so `resolveDiscount` skips it (pos.js:146/155/168) and `computeTax` pools it with 12% group key `"12"`.
- `item.bundle_can`: catalog SKU must be `can-473`/`can-355` (case-insensitive), integer qty 1..100, force `rate: 0`, still `tax_id` from catalog (`catalogItem.tax_id`), and reject if no bundle line is in the same cart (orphan = free-goods exploit).

Existing non-custom line pattern that the can line deviates from (pos.js:~640-655): `var rate = catalogItem.rate; // authoritative price from catalog` — a client `rate:0` is silently ignored today, hence the new kind.

**Tax rounding:** `computeTax` (pos.js:221) groups by numeric rate and rounds per group (entity_level); client mirror is `kioskCalcTotals` (kiosk-core.js:803). Totals check for a beer bundle alone: 40.00 + 4.80 = 44.80. The `client_grand_total` +/-$0.01 pre-charge assertion is the divergence detector; keep it.

---

### `js/brewpad.js` create sheet (component, request-response)

**Analog:** create submit handler (brewpad.js:~7585-7625).
```javascript
submitBtn.disabled = true;
adminApiPost('create_batch', {
  product_name: productName, product_sku: productSku,
  customer_firstname: customerFirstname || 'Walk-In', customer_lastname: customerLastname || '',
  customer_name: customerName || 'Walk-In', customer_email: customerEmail,
  start_date: startDate, vessel_id: vesselId, shelf_id: shelf, bin_id: bin,
  schedule_id: scheduleId, notes: notes,
  recipe_id: (document.getElementById('bp-new-recipe-id') || {}).value || '',
  recipe_snapshot: (document.getElementById('bp-new-recipe-snapshot') || {}).value || ''
})
  .then(function (result) { showToast('Batch ' + (result.batch_id || '') + ' created', 'success'); closeCreateSheet(); _batchesLoaded = false; _allBatchesData = []; ... loadBatches(); })
  .catch(function (err) { showToast('Failed: ' + err.message, 'error'); submitBtn.disabled = false; });
```
Additions: `zoho_so_number` (from hidden `bp-new-so-number`), `customer_id` (hidden `bp-new-customer-id`, already in the form but not sent), `source: 'internal'` when the checkbox is ticked. Neither invoice nor checkbox => `showConfirmSheet('Create without invoice?', 'Create batch', 'bp-confirm-btn--primary', onOk)` (signature `showConfirmSheet(message, okLabel, okCls, onOk)`, :4549; never `window.confirm`). On success with an invoice, fire-and-forget `POST /api/batch/reconcile-invoice-status {zoho_so_number}` (style of `reconcileInvoiceStatusAfterDelete`, ~:2105). In `.catch`, special-case `duplicate_so_number` (inline danger banner, re-enable submit, no retry).

#### `fetchSoSearch` parameterisation (D-02)
**Analog:** `fetchSoSearch` (brewpad.js:2123-2165), hard-wired to `#bp-so-search-results` and `handleSoSelect(this)`. Change signature to `fetchSoSearch(term, opts)` with `opts.resultsId` and `opts.onSelect`, defaults preserving current behaviour byte for byte. Core to keep:
```javascript
fetch(mwUrl() + '/api/batch/search-invoices?search=' + encodeURIComponent(term), { credentials: 'include' })
  .then(function (r) { return r.json(); })
  .then(function (data) { var orders = data.invoices || []; ... items[j].addEventListener('click', function () { handleSoSelect(this); }); })
  .catch(function () { resultsEl.innerHTML = '<div class="bp-so-result-item" style="color:var(--ink-muted);">Search unavailable — check connection</div>'; });
```
Result rows carry `data-so-id`, `data-so-number`, `data-customer-name`, `data-customer-id`, `data-so-date`, `data-product-name` and escape via `escapeHTML`. Add characterization tests BEFORE the refactor (none exist).

#### `linkBatchToInvoice` (D-07/D-10)
**Do NOT reuse `handleSoSelect` for Confirm** (brewpad.js:2359-2405): it writes `zoho_so_number` AND `customer_id`, `customer_name`, `product_name` and calls `callSyncZoho` (single-batch label). Extract a narrow function that copies only this shape:
```javascript
adminApiPost('update_batch', { batch_id: id, updates: { zoho_so_number: soNumber } /*, expectedVersion: batch.last_updated */ })
  .then(function () { afterBatchWrite(id, { refreshOpenDetail: true }); /* then POST reconcile-invoice-status */ showToast('Linked to ' + soNumber, 'success'); })
  .catch(function () { /* inline "Could not link. Try again." */ });
```
`afterBatchWrite(batchId, opts)` is at :2442 (opts `listAffecting`, `refreshOpenDetail`). Keep `handleSoSelect` for the manual search path.

---

### `js/brewpad.js` Unlinked chip (component/utility, transform)

**Analog:** `filterBatchesByStatus` (brewpad.js:203-215) / `filterBatchesByReadyToBottle` — pure, top-level (outside the IIFE), exported for jest. Add `filterBatchesByUnlinked(batches)`:
```javascript
// Predicate: !String(zoho_so_number||'').trim() && String(source||'').toLowerCase() !== 'internal' (exclude status 'disabled')
```
Wire into `applyBatchFilter()` (:4025) beside the `readyToBottle` special case; add `{ val: 'unlinked', label: 'Unlinked' }` to `filterOpts` (:4137-4144) and extend the count badge logic (:4147-4156), which today is `f.val === 'pending' ? pendingCount : (f.val === 'readyToBottle' ? readyToBottleCount : 0)` with the orange badge span; UI-SPEC wants "Unlinked (n)" shown even at 0. The click handler (~:10170) already routes through `applyBatchFilter`; no new state variable (`_batchStatusFilter` string). Source badge: copy `shouldShowKioskBadge` (:575) placement for the "Internal" badge.

---

### `js/brewpad.js` recipe dropdown (component, request-response)

**Analog:** `bindRecipePickerSearch` (brewpad.js:7683-7740). Pattern to generalise and de-cap:
```javascript
fetch(mwUrl() + '/api/recipes?status=active', { credentials: 'include' }).then(r => r.json()) // ES5 function form in file
  .then(function (data) { _recipeCatalog = data.recipes || []; showRecipeOptions(term); })
  .catch(function () { _recipeCatalog = []; showRecipeOptions(term); });
var matches = _recipeCatalog.filter(function (r) {
  if (!term) return true;
  return ((r.name || '') + ' ' + (r.style || '')).toLowerCase().indexOf(term.toLowerCase()) !== -1;
}).slice(0, 15);                       // <-- D-20: remove this cap
// rows: '<div class="bp-vessel-option" data-rid="..." data-rname="...">'
// select handler on mousedown/touchstart: e.preventDefault(); e.stopPropagation(); input.value = rname; ... fetch('/api/recipes/' + rid) for snapshot
```
Keep the `if (_productPickerTab !== 'recipes') return;` guard. Add a `click` listener alongside `focus` (iPad). Same copy-paste pickers to fold in: attach (brewpad.js:5245-5355, input `bp-recipe-attach-input`, dropdown `bp-recipe-attach-dropdown`), waitlist per-row (:~8884) and waitlist add (:~9241), all sharing `_waitlistRecipeCatalog`. Pure sort/filter/name-match helpers go in `js/lib/recipe-picker.js`.

#### `js/lib/recipe-picker.js` (NEW)
**Analog:** `js/lib/recipe-grouping.js` — file tail pattern:
```javascript
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { groupRecipeIngredients: groupRecipeIngredients, SECTION_ORDER: SECTION_ORDER };
}
```
Script tags to add (same-origin, no CSP change): `brewpad.html:20`, `kiosk.html:32` (`<script src="js/lib/recipe-grouping.js"></script>`) and `admin.html:1161` (`<script src="js/lib/recipe-grouping.js" defer></script>`). Test analog: `tests/frontend/recipe-grouping.test.js`. ES5 only (no arrows/let/const/template literals). In kiosk and admin, if `js/lib` helpers are not loaded the kiosk can have its own ES5 implementation (D-20).

### Recipe editor "Start from" (D-21)
**Analog (BrewPad):** `bpCloneRecipePayload(sourceRecipe, sourceIngredients)` (brewpad.js:3059-3087, pure; sets `name:'Copy of ...'`, `status:'draft'`, includes `beer_category`) and `bpCloneRecipe()` (:3094) for the populate/render calls. For a DIFFERENT recipe: `fetch('/api/recipes/' + id)` -> `{recipe, ingredients}` (as `openRecipeDetail` does, :2686-2720) -> `bpCloneRecipePayload` -> same populate calls as `bpCloneRecipe` (`populateRecipeForm`, :2745 region sets `#bp-recipe-name`). Dirty-form confirm via `showConfirmSheet`. **Admin analog:** `duplicateRecipe` (admin.js ~:9200), `#recipe-name` at admin.js:8680, `openRecipeDetail(null)` ~:8610. `kioskSaveAsNewRecipe` (admin.js ~:11726) is NOT the right reuse (RESEARCH D-21 note). Duplicate-name list source: `_recipesState.list` or `status=all` fetch (precedent `ensureRecipeListForSched`, brewpad.js:~9612).

---

### `js/kiosk-core.js` canning bundle (service, cart event-driven)

**Analog:** `kioskSyncKitFees` (kiosk-core.js:772-785) — auto-maintained companion lines keyed in the cart with teardown:
```javascript
function kioskSyncKitFees() {
  if (_kioskMakersFeeWaived) return;
  var cart = _kcEnv.getCart();
  var makersFee = kioskFindMakersFee();
  var totalKits = kioskCountKitsInCart();
  if (totalKits > 0) {
    if (makersFee) cart[makersFee.item_id] = { item: makersFee, qty: totalKits };
  } else {
    if (makersFee) delete cart[makersFee.item_id];
  }
}
```
and SKU lookup `kioskFindMakersFee` (:745: `(_kioskProducts[i].sku || '').toUpperCase() === MAKERS_FEE_SKU`) — copy for `can-473`/`can-355`.

Add `addCanningBundle` / `removeCanningBundle`. Fixed cart keys `'bundle-line'` and `'bundle-can'` (one bundle per cart). Bundle can line must be a **shallow copy** of the catalog product with `rate: 0` and `bundle_can: true` (never mutate catalog; cart holds references). Bundle line: `{ custom:true, bundle_key, description, tax_percentage:12, taxable:true, rate:<price> }`, qty fixed 1.

Lifecycle hooks to extend (generic by key today): `kioskAddToCart` (:2022), `kioskSetQty` (:2052, qty on the bundle line a no-op, can-line qty re-runs cap check), `kioskRemoveFromCart` (:2070; removing either key deletes both), `kioskClearCart` (:2084; sets cart `{}` so both vanish). Do not touch discount code: `kioskCalcTotals` skips `entry.item.custom` (:834, D-08).

**Items payload builder** (kiosk-core.js:~2640-2670): the custom branch forwards `description/note/quantity/rate/taxable`:
```javascript
if (entry.item.custom) {
  return { custom: true, description: entry.item.description || '', note: entry.item.note || '',
           quantity: entry.qty, rate: parseFloat(entry.item.rate) || 0, taxable: entry.item.taxable !== false };
}
return { item_id: entry.item.item_id, name: entry.item.name || '', sku: entry.item.sku || '',
         quantity: entry.qty, rate: parseFloat(entry.item.rate) || 0, product_type: ..., cf_type: ... };
```
Add `bundle_key` pass-through for the bundle line and `bundle_can: true` for the can line (server stays authoritative). The 57-03 phantom guard (:2685-2697) skips `custom`/`gift_cert` and checks real items via `kioskFindProductById`; the can item is a real catalog item so it passes.

**Exports:** add the new functions to the `KioskCore` object near `syncKitFees: kioskSyncKitFees,` (:5739) beside test hooks (`_setCart`, :5825).

**Modal shell:** `js/kiosk.js` custom-item modal (~:762); markup in `kiosk.html` and the admin-embedded kiosk panel (`admin.html`/`admin.js`) — kiosk-core is shared; `tests/frontend/kiosk-core-parity.test.js` asserts both surfaces send identical sale bodies.

**Kiosk recipe search header:** `kioskRenderRecipes` (:1173-1200) renders ALL recipes into `#kiosk-recipe-grid` (no cap); add `.kiosk-recipe-search` above the grid in `kiosk.html:~127`; card click handler already resolves `recipe` from `_kioskRecipes` by `data-recipe-id`, reuse it for the dropdown choice.

---

### `custom-labels.html` (:161)
In-place copy edit: replace "~84 cans (355 mL)" with the 70 x 355 mL / 52 x 473 mL wording. Page is in `stamp:pages`; the single final `npm run build` re-stamps. Only occurrence of "84 cans" outside planning docs.

## Test Patterns

### Frontend jest (jsdom) loading `js/brewpad.js`
**Analog:** `tests/frontend/brewpad-after-batch-write.test.js` / `brewpad-pending.test.js` (identical prelude). Header to copy verbatim (brewpad.js executes its IIFE on load):
```javascript
global.document = global.document || {};
global.window = global.window || {};
global.navigator = global.navigator || {};
global.google = { accounts: { oauth2: { initTokenClient: jest.fn() } } };
global.fetch = jest.fn();
global.localStorage = { _data: {}, getItem: function (k) { return this._data[k] || null; }, setItem: ..., removeItem: ..., clear: ... };
global.sessionStorage = { ...same shape... };
var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;
var bp = require('../../js/brewpad');
```
Pure exported helpers (`bp.shouldShowKioskBadge`, `bp.bpCloneRecipePayload`, `bp.renderRecipeListHtml`, `bp.afterBatchWrite`) are tested directly; IIFE-scoped state/functions are reached via `_xForTest` additions at the bottom `Object.assign(module.exports, {...})` block (brewpad.js:~10944-10990; e.g. `_adminApiPostForTest: adminApiPost`, `_setRecipesListForTest`, `_setVesselsDataForTest`). Add new seams there (e.g. `filterBatchesByUnlinked` top-level export, `_fetchSoSearchForTest`, `_linkBatchToInvoiceForTest`). Mock `fetch` (jest.fn) per test and assert on the `update_batch` payload having ONLY `zoho_so_number`.
New files: `brewpad-create-invoice-link`, `brewpad-so-search` (characterization first), `brewpad-unlinked-filter`, `brewpad-link-review`, `brewpad-recipe-picker-full-list`, `brewpad-recipe-start-from`, `recipe-picker` (model on `recipe-grouping.test.js`), `admin-recipe-start-from` (model on `admin-recipes.test.js`/`admin-recipe-modify.test.js` stub block), `custom-labels-copy` (static fs grep).

### Frontend jest loading `js/kiosk-core.js`
**Analog:** `tests/frontend/kiosk-tax-rounding-entity-level.test.js` (loads core through `kiosk.js`, singleton `window.KioskCore`):
```javascript
function loadCore() {
  jest.resetModules();
  if (global.window) delete global.window.KioskCore;
  document.body.innerHTML = '';
  require('../../js/kiosk.js'); // eslint-disable-line global-require -- per-test isolation
  return global.window.KioskCore;
}
function line(id, name, rate, pct) { return { item: { item_id: id, name: name, rate: rate, tax_percentage: pct }, qty: 1 }; }
// usage: var core = loadCore(); core.init({ getDiscount: ... }); core._setCart({...}); var t = core.calcTotals();
```
Globals stubbed at top: `global.window`, `navigator`, `console`, `alert`, `fetch`, `SHEETS_CONFIG` (MIDDLEWARE_URL, MW_API_KEY, SPREADSHEET_ID, GOOGLE_CLIENT_ID, STAFF_EMAILS, API_BASE, SERVER_TOKEN). New file `kiosk-canning-bundle.test.js` drives `addCanningBundle`/`removeCanningBundle`/`calcTotals` (total 44.80 for beer bundle alone). Parity (client total == server total, constants pinned) also uses `kiosk-core-parity.test.js` style (separate isolated loads for kiosk.js vs admin.js; do not edit that file, add new).

### Apps Script (`.gs`) tests
**Analog:** `tests/frontend/adminapi-phase82-locks.test.js` — load the real file with `new Function`, slice pure top-level functions:
```javascript
var src = fs.readFileSync(ADMIN_API_PATH, 'utf8');
var factory = new Function(src + '\nreturn {batchDedupDecision: (typeof batchDedupDecision !== "undefined" ? batchDedupDecision : undefined)};');
// plus sliceFunctionSource(src, name): locate 'function <name>(' and brace-match
```
New file `adminapi-batch-source-edit.test.js`: (1) truth table for `batchSourceTransitionDecision` (blank editable, locked sources rejected incl. `kiosk_recipe`, no-op same value), (2) raw-text/ordering assertion that the source check precedes the VesselHistory write in `updateBatch` (that suite already asserts raw-text lock ordering for `createBatch`). For a stubbed-sheet `updateBatch` execution, copy the `Utilities`/`makeSheet` stubs and `FakeDate` approach in `tests/frontend/adminapi-batch-golden.test.js` (pins `process.env.TZ = 'America/Vancouver'`; reads synthetic workbook from `zoho-middleware/__tests__/fixtures/batches/`). Existing tests are not edited (CLAUDE.md rule 10).

### Middleware route jest
**Analogs:** `zoho-middleware/__tests__/batch-search-invoices.test.js` (link-candidates) and `pos-custom-line.test.js` (bundle). Prelude to copy: `jest.mock('../lib/helcim' | '../lib/zoho-api' (zohoGet/zohoPost/zohoPut jest.fn) | '../lib/cache' | '../lib/eventLog' | '../lib/logger' | '../lib/mailer' | '../lib/inventory-ledger' | '../lib/brewpad-integration' | 'axios' | 'express')`, a captured `_routeRegistry` for the mocked `express.Router`, then `require('../routes/pos')` and:
```javascript
function findHandler(method, path) { /* loops _routeRegistry[method] */ }
var handler = findHandler('get', '/api/batch/search-invoices');
function makeReq(query, headers) { return { body: {}, query: query || {}, headers: headers || {} }; }
function makeRes() { /* status/json jest.fn capturing res._status, res._json */ }
function flushPromises() { return new Promise(function (resolve) { setImmediate(resolve); }); }
var AUTH_HEADERS = { 'x-api-key': 'test-api-key' };  // process.env.MW_API_KEY = 'test-api-key' in beforeEach
// mockZohoRouting(listInvoices, detailByInvoiceId) routes zohoGet by path: '/invoices?search_text=' vs '/invoices/<id>'
```
For link-candidates the list call is `zohoGet('/invoices', params)` (object param, not a string path), so adapt the routing mock to check `typeof arg === 'string' && arg === '/invoices'` and the params object. `batch-reconcile-status.test.js` leaves `brewpad-integration` un-mocked (real `fetchLiveBatchIndex`), useful if testing `linked_batches`; otherwise stub `fetchLiveBatchIndex` in the brewpad-integration mock (add it; the existing mock factory omits it). `pos-custom-line.test.js` shows sale/confirm structure with `describe` blocks per route and fail-closed GST (`describe('/api/kiosk/sale — fail-closed GST')`, :264) and discount exclusion (`resolveDiscount — D-08`, :859): mirror for bundle: price/tax ignoring client `rate`/`taxable`, can SKU allow-list, orphan can rejected, both `/sale` and `/sale/confirm`. Tax rounding precedent: `pos-tax-rounding-entity-level.test.js` (companion to the kiosk client test above). New files: `batch-link-candidates.test.js`, `pos-canning-bundle.test.js`, `batch-rules-source.test.js` (parity with the .gs function; model on `batch-rules-sku-type.test.js`/`batch-rules.test.js`).

### Real-Postgres jest (`jest.db.config.js`)
**Analog:** `zoho-middleware/__tests__/db/batch-pg-update.test.js` (+ `batch-pg-create.test.js`, helper `__tests__/db/helpers/pg-harness.js`, `batch-seed.js`). Run only via `cd zoho-middleware && npm run test:db` (Docker, Node 24; `testMatch: __tests__/db/**/*.test.js`, `testTimeout 120000`, `maxWorkers 2`, STOP rather than skip if Docker is down). Scaffold to copy:
```javascript
var pgHarness = require('./helpers/pg-harness');
var describeDb = pgHarness.describeDb;
var OPTS = { actor: 'staff@example.com', now: NOW };
describeDb('batch-pg-update: updateBatch', function () {
  var container, pool, upd, harness;
  beforeAll(async function () {
    var started = await pgHarness.startPostgres();
    container = started.container;
    var migrateResult = pgHarness.applyMigrations(started.connectionString);
    if (migrateResult.code !== 0) { throw new Error('applyMigrations failed: ' + migrateResult.stderr); }
    jest.resetModules();
    var db = require('../../lib/db');
    upd = require('../../lib/batch-pg-update');
    pool = db.createPool(started.connectionString);
  }, 120000);
  afterAll(async function () { if (pool) await pool.end(); if (container) await container.stop(); }, 60000);
  harness = pgHarness.rollbackEachTest(function () { return pool; });
  function client() { return harness.client(); }
  // addBatch(o) inserts into batches (batch_id, status, ..., access_token, created_at, last_updated, notes) with $n params
  // call: await upd.updateBatch(client(), { batch_id, updates: { source: 'internal' } }, OPTS)
});
```
New files (do not edit existing): `batch-pg-update-source.test.js` (accept manual<->internal, blank row editable, locked source rejected with nothing written, no-op same value), `batch-pg-create-internal.test.js` (create with `source:'internal'` and with `zoho_so_number` round-trips `get_batch`; `duplicate_so_number` surfaced). Seed rows must include a blank `source`: PG column is `source text not null default 'manual'` (migrations/0005_batches.sql:50), so blank is `''` explicit.

## Shared Patterns

### Auth tier on new BrewPad GET/POST routes
**Source:** `zoho-middleware/routes/pos.js:2938-2943`, `:3002-3004`
**Apply to:** `link-candidates`. `authTiers.requireTiers(['legacy', 'session'])(req, res, function () { ... })` (device tier rejected).

### Error shape / fail closed
**Source:** `batch-pg-update.js:97-99` (`fail`), pos.js 400/502 handlers.
**Apply to:** store guards (`{ ok:false, error, message }`), routes (`400 { error:'bad_request', message }`, Zoho failures `502`), bundle tax-id unresolved => 400 with GST-style message.

### Browser writes: adminApiPost + afterBatchWrite
**Source:** brewpad.js:1767 (`adminApiPost`), :2442 (`afterBatchWrite`), exported seam `_adminApiPostForTest` (:10966).
**Apply to:** Confirm, Mark internal, create, "Mark as not internal". Never `window.confirm`; use `showConfirmSheet`.

### cf_batch_status reconciliation
**Source:** `POST /api/batch/reconcile-invoice-status` (pos.js:3002-3050), recomputes "N batches" label from live set via `brewpadIntegration.reconcileInvoiceBatchStatus` and `fetchLiveBatchIndex`.
**Apply to:** every link write (create-with-invoice, Confirm, manual link); runs after `update_batch` resolves. Do not call `callSyncZoho` for Confirm.

### Server-owned money path
**Source:** pos.js:318-331 comment (client price/tax never trusted), `client_grand_total` assertion in `processSaleWithPrices`.
**Apply to:** bundle line and can line in both `/sale` and `/sale/confirm`; test with a client/server parity table.

### ES5 and build discipline
**Apply to:** all `js/` edits: no arrow functions/let/const/template literals. `js/brewpad.js`, `js/kiosk-core.js`, `js/kiosk.js`, `js/admin.js` are standalone sources; never hand-edit `*.min.js`/`js/main*.js`. One `npm run build` (Node 24) in the final gate plan modelled on `89-08-PLAN.md`, then `scripts/check-artifact-drift.sh`; stage only intended files (never `links.html`, `HANDOFF-*.md`).

### Gate commands (CLAUDE.md rules 1, 2, 7)
`npm test && npm run lint`; `cd zoho-middleware && npm test`; `npm run test:db` (Docker). After changing `zoho-middleware/lib/*.js` or `js/lib/*.js`, run both full suites.

## No Analog Found / Weak Analogs

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `zoho-middleware/lib/kiosk-bundles.js` | utility/config | transform | No server-side price table module exists; closest is `_TAX_RULE_PCT` (pos.js:47) and `lib/constants.js`. Planner should author from RESEARCH "Recommended server contract" and pin client/server parity by test |
| Bundle picker modal markup (`kiosk.html` + admin-embedded panel) | component | event-driven | Only the custom-item modal (`js/kiosk.js` ~:762) is similar; segmented buttons, stepper, cap checkbox are new CSS (UI-SPEC defines `.kiosk-bundle-*`) |
| Candidate cards (`.bp-link-card*`, pills, skeleton) | component | request-response | No existing card with action row in BrewPad detail; reuse `.bp-vessel-dropdown`/`.bp-confirm-sheet*` tokens and UI-SPEC class list. Behavioural base is `showLinkedSo` (:2411) |
| "Not this" persistence | utility | storage | Fresh localStorage key per batch (RESEARCH A6); localStorage test stub is in the brewpad test prelude |
| Zoho `customer_name` list filter probe | n/a | n/a | Wave 0 read-only probe, no code analog (RESEARCH A3) |

## Metadata

**Analog search scope:** `js/brewpad.js`, `js/kiosk-core.js`, `js/lib/`, `apps-script/adminApi.gs`, `zoho-middleware/{routes,lib,__tests__,__tests__/db}`, `tests/frontend/`, `brewpad.html`/`kiosk.html`/`admin.html`.
**Files scanned:** ~35 (targeted reads and greps; large files read by offset).
**Pattern extraction date:** 2026-10-14
