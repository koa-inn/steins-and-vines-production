# Phase 67: Kiosk Tax Quote-Charge Correctness - Pattern Map

**Mapped:** 2026-07-30
**Files analyzed:** 7 (3 modified source files, 4 new/extended test files)
**Analogs found:** 7 / 7 (all files being MODIFIED in place — the analog for each is the surrounding code in the SAME file, plus one cross-file test-harness donor per test)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `js/kiosk-core.js` — `kioskCalcTotals` tax loop (~755-769) | component (client cart math) | transform | same file: `kioskItemTax` (~603-607), 57-03 phantom-guard block in `kioskProceedToPayment` (~2436-2460) | exact (sibling logic, same file) |
| `js/kiosk-core.js` — `kioskItemTax` (~603-607) | component (client cart math) | transform | same file: `kioskCalcTotals` tax loop | exact |
| `js/kiosk-core.js` — `kioskLoadProducts` call sites / freshness hook (`kioskStartCheckout` ~2385, `kioskProceedToPayment` ~2394) | component (data fetch trigger) | request-response | same file: `kioskRetryStalledLoads` staleness-refresh pattern (~908-925), `newSaleBtn` handler (~3297-3305) | exact |
| `js/kiosk-core.js` — `kioskProceedToPayment` sale body (~2582-2589) | component (payload builder) | request-response | same file: `recipeSaleBody` / `standardSaleBody` construction (~2563-2589) | exact |
| `zoho-middleware/routes/pos.js` — `computeTax` (~147-186) | service (tax calc) | transform | same file: `resolveGstTaxId` fail-closed pattern (~406-419, "no GST tax rate configured" 400) | exact |
| `zoho-middleware/routes/pos.js` — pre-charge assertion (new, inside `processSaleWithPrices` ~511-520, before terminal push) | service (guard) | request-response | same file: WR-03 lock-release-on-terminal-failure (~637-646); `grandTotal <= 0` / `grandTotal > 10000` guards (~514-519) | exact |
| `zoho-middleware/__tests__/*.test.js` (new) | test | request-response | `zoho-middleware/__tests__/pos-tax.test.js`, `pos-money-defects.test.js` (WR-03 block), `catalog.test.js` (kiosk tax-rule-enrichment block) | exact |
| `tests/frontend/*.test.js` (new) | test | request-response | `tests/frontend/kiosk-catalog-freshness.test.js` | exact |

## Pattern Assignments

### 1. `js/kiosk-core.js` — remove silent 5% fallback in `kioskCalcTotals` (~line 755-769)

**Analog:** same file, 57-03 phantom-item guard in `kioskProceedToPayment` (lines 2436-2460) — this is the repo's existing "detect a bad cart line, name it, block checkout" pattern and is the correct model for the new missing-tax flag (not `kioskShowError`, which is a full-screen post-checkout error view; not `showToast`, which is a dismissible non-blocking notice).

**Current fallback to remove** (`js/kiosk-core.js:755-769`):
```javascript
    // Per-item tax using catalog tax_percentage (matches server-side calculation)
    var taxTotal = 0;
    ids.forEach(function (id) {
      var entry = cart[id];
      if (!entry || !entry.item) return;
      var lt = (parseFloat(entry.item.rate) || 0) * entry.qty;
      var d = lineDiscount[id] || 0;
      // Recipe cart uses a uniform ratio (recipe lines are mostly tax-exempt anyway).
      if (recipeContext && discountAmount > 0 && subtotal > 0) {
        d = kioskR2(lt * (discountAmount / subtotal));
      }
      var taxable = Math.max(lt - d, 0);
      var pct = parseFloat(entry.item.tax_percentage);
      if (isNaN(pct)) pct = KIOSK_TAX_RATE_DEFAULT * 100;   // <-- REMOVE
      taxTotal += taxable * (pct / 100);
    });
```
`KIOSK_TAX_RATE_DEFAULT` is declared at line 237 (`var KIOSK_TAX_RATE_DEFAULT = 0.05;`) — becomes dead once both call sites (this loop and `kioskItemTax`) stop reading it; confirm no other reader before deleting the constant itself.

**Analog to copy the "flag + block" shape from** (`js/kiosk-core.js:2436-2460`):
```javascript
    if (!_kcEnv.getRecipeContext() && !_kioskImportedSoId &&
        _kioskProductsLoaded && _kioskProducts.length) {
      for (var pgI = 0; pgI < items.length; pgI++) {
        var pgItem = items[pgI];
        if (pgItem.custom || pgItem.gift_cert) continue;
        if (!kioskFindProductById(pgItem.item_id)) {
          kioskShowError('Item Unavailable',
            'Item "' + (pgItem.name || pgItem.item_id) + '" is no longer in the current catalog. ' +
            'Remove it and re-add it from the product grid, then try again.',
            true);
          return;
        }
      }
    }
```
Reuse `kioskShowError(title, msg, canRetry)` (defined at line 2307, full excerpt below) as the blocking surface — it already shows the item by name, is retry-friendly, and returns to `browse` view; this matches "flag the item by name... and block checkout" from CONTEXT.md exactly. Since `kioskCalcTotals` itself has no UI access (it is pure math, called from render paths too), the missing-tax DETECTION should happen inside `kioskCalcTotals` (return a `missingTaxItem` name/id in the totals object, analogous to how `discountAmount`/`tax` are already returned) and the BLOCKING call (`kioskShowError`) should happen at the checkout entry point (`kioskProceedToPayment`, right where the 57-03 phantom guard already runs, ~line 2436) — do not call `kioskShowError` from inside `kioskCalcTotals`, which also runs on every cart render.

**`kioskShowError` (full pattern, `js/kiosk-core.js:2307-2341`):**
```javascript
  function kioskShowError(title, msg, canRetry, extra) {
    kioskShowView('error');

    var titleEl = document.getElementById('kiosk-error-title');
    var msgEl = document.getElementById('kiosk-error-msg');
    var retryBtn = document.getElementById('kiosk-retry-btn');
    var backBtn = document.getElementById('kiosk-back-btn');
    var detailEl = document.getElementById('kiosk-error-detail');

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = msg;
    ...
    if (retryBtn) {
      retryBtn.style.display = canRetry ? '' : 'none';
      retryBtn.onclick = function () {
        kioskShowView('browse');
        kioskStartCheckout();
      };
    }
    if (backBtn) {
      backBtn.onclick = function () { kioskShowView('browse'); };
    }
  }
```

### 2. `js/kiosk-core.js` — `kioskItemTax` (line 603-607)

**Analog:** same fix, same file — reconcile with #1 above (CONTEXT.md: "One consistent behavior across both call sites").

**Current code:**
```javascript
  function kioskItemTax(item, qty) {
    var rate = parseFloat(item.rate) || 0;
    var pct = parseFloat(item.tax_percentage) || 0;   // <-- `|| 0` silently treats NaN as 0%, inconsistent with #1's 5%-guess
    return parseFloat((rate * qty * pct / 100).toFixed(2));
  }
```
This function is used for isolated per-line tax display (not the cart-blocking gate). CONTEXT.md flags this as needing to become consistent with the cart-calc detection, not necessarily identical code — check all call sites of `kioskItemTax` (`grep -n "kioskItemTax(" js/kiosk-core.js js/kiosk.js`) before changing its return contract, since callers may not expect `NaN`/`null`.

### 3. `js/kiosk-core.js` — catalog freshness hook at cart-lifecycle points

**Analog:** same file, existing force-refresh call site (`js/kiosk-core.js:3297-3305`, the "New Sale" button, which CONTEXT.md says already covers one path):
```javascript
    var newSaleBtn = document.getElementById('kiosk-new-sale-btn');
    if (newSaleBtn) {
      newSaleBtn.onclick = function () {
        kioskLoadProducts(true);
        _kcEnv.setCustomer(null);
        kioskClearImportedSo();
        kioskShowView('browse');
      };
    }
```
And the existing staleness self-heal on wake (`js/kiosk-core.js:908-925`, `kioskRetryStalledLoads`, using `KIOSK_CATALOG_MAX_AGE_MS` / `_kioskProductsLoadedAt`) — same TTL-comparison idiom to reuse if a checkout-time staleness check is added instead of/in addition to an unconditional refetch.

**Missed paths to cover** (per CONTEXT.md: "cover the paths `New Sale` misses"): `kioskStartCheckout` (line 2385, cart→customer step transition) and/or `kioskProceedToPayment` (line 2394, right before the sale POST is built) currently do NOT call `kioskLoadProducts(true)`:
```javascript
  function kioskStartCheckout() {
    if (kioskCartIsEmpty()) return;
    if (!_kioskTerminalReady) {
      showToast('POS terminal is not ready. Check terminal status below.', 'error');
      return;
    }
    kioskShowCustomerStep();
  }
```
`kioskLoadProducts(forceRefresh)` itself (line 833-879) already has keep-last-good-on-failure baked in — safe to call with `true` at either hook point without new error handling:
```javascript
  function kioskLoadProducts(forceRefresh) {
    if (_kioskProductsLoading) return;
    if (_kioskProductsLoaded && !forceRefresh) {
      kioskRenderProducts();
      return;
    }
    ...
    var url = mwUrl + '/api/kiosk/products' + (forceRefresh ? '?bust=1' : '');
    fetch(url, _kcMergeAuth({}))
      .then(...)
      .catch(function (err) {
        _kioskProductsLoading = false;
        if (_kioskProductsLoaded && _kioskProducts.length) {
          kioskRenderProducts();
          return;   // keep-last-good — do not wipe grid on a failed refresh
        }
        ...
      });
  }
```

### 4. `js/kiosk-core.js` — client-displayed totals on the sale POST body

**Analog:** same file, `standardSaleBody` construction (`js/kiosk-core.js:2582-2589`), immediately after `var totals = kioskCalcTotals();` (line 2395) — `totals.total` / `totals.tax` are already computed and in scope at this call site:
```javascript
    var standardSaleBody = {
      items: items,
      reference_number: refNumber,
      idempotency_key: refNumber,
      discount: _kcEnv.getDiscount() ? { preset_id: ..., name: ..., type: ..., value: ..., scope: ... } : undefined,
      gift_card: undefined
    };
```
Add the displayed-total field(s) here (exact name at Claude's discretion per CONTEXT.md, e.g. `client_total: totals.total`). `recipeSaleBody` (lines 2563-2580) is a parallel sibling object for the recipe-sale endpoint — CONTEXT.md scopes the assertion to `/api/kiosk/sale` (standard cart) only; recipe-sale is out of scope unless the diagnosis is later found to apply there too.

### 5. `zoho-middleware/routes/pos.js` — `computeTax` remove `!pct && !tax_id → defaultTaxRate` guess (line 147-186)

**Analog:** same file, `resolveGstTaxId` fail-closed 400 (`zoho-middleware/routes/pos.js:406-419`) — the existing "cannot resolve a tax rate → hard-reject naming the cause" idiom to copy:
```javascript
      var needGstTaxId = body.items.some(function (item) {
        return item.custom && item.taxable !== false;
      });
      var gstTaxId = null;
      if (needGstTaxId) {
        gstTaxId = resolveGstTaxId(catalogMap);
        if (!gstTaxId) {
          return res.status(400).json({
            error: 'Cannot tax this custom line: no GST tax rate configured. Mark the line tax-exempt or set KIOSK_GST_TAX_ID.'
          });
        }
      }
```

**Current fallback to remove** (`zoho-middleware/routes/pos.js:147-186`):
```javascript
function computeTax(lineItems, catalogMap) {
  var taxTotal = 0;
  var defaultTaxRate = parseFloat(process.env.KIOSK_TAX_RATE) || 0.05;
  lineItems.forEach(function (li) {
    if (li.gift_cert) { return; }
    if (li.custom) { ... return; }
    var catalogItem = catalogMap[li.item_id];
    ...
    var pct = catalogItem.tax_percentage || 0;
    if (catalogItem.sales_tax_rule_id && _TAX_RULE_PCT[catalogItem.sales_tax_rule_id] !== undefined) {
      pct = _TAX_RULE_PCT[catalogItem.sales_tax_rule_id];
    } else if (!pct && !catalogItem.tax_id) {
      pct = defaultTaxRate * 100;        // <-- REMOVE: silent 5% guess
    }
    taxTotal += lineTotal * ((pct || 0) / 100);
  });
  return Math.round(taxTotal * 100) / 100;
}
```
Note `computeTax` currently has no `catalogMap`/`res` access to reject inline — it is a pure function called from `processSale` (line 498) and `confirm` (line 976). CONTEXT.md requires the fail-closed rejection to name the item/SKU, so the resolution-failure check likely needs to move to (or be duplicated in) the caller where `res` is in scope, OR `computeTax` should return a discriminated result (`{ error, itemName }` vs `{ taxTotal }`) mirroring the CR-02 gift-card discriminated-result pattern already used elsewhere in this file (`gcRealBalanceLookup` → `{ state: 'ok' | 'invalid' | 'unavailable' }`, lines 545-568) rather than throwing/returning a bare number. `_TAX_RULE_PCT` legitimate-0% items (e.g. Zero Rated Ingredients rule `109900000000033411` → 0) must NOT trip the new fail-closed path — only `pct` that is `undefined`/`NaN`/unresolved after all three lookups (catalog `tax_percentage`, `sales_tax_rule_id` map, `tax_id` presence) is an error; `pct === 0` from a real rule is valid and must flow through unchanged.

### 6. `zoho-middleware/routes/pos.js` — pre-charge assertion (new code, inside `processSaleWithPrices`)

**Analog A — where to insert (guard idiom):** same file, `processSaleWithPrices` grandTotal bounds checks (`zoho-middleware/routes/pos.js:511-519`):
```javascript
function processSaleWithPrices(body, idempotencyKey, req, res,
  lineItems, subtotal, taxTotal, grandTotal) {

  if (grandTotal <= 0) {
    return res.status(400).json({ error: 'Sale total must be greater than zero' });
  }
  if (grandTotal > 10000) {
    return res.status(400).json({ error: 'Sale total exceeds maximum' });
  }
  ...
```
The new client-total-vs-`grandTotal` comparison belongs immediately after this block (or in `processSale` right after `grandTotal` is computed at line 499) — BEFORE any gift-card lookup or `helcimLib.terminalPurchase` call, matching "BEFORE any Helcim terminal charge" from CONTEXT.md.

**Analog B — lock release on fail-closed rejection (WR-03 pattern):** the existing terminal-failure lock release (`zoho-middleware/routes/pos.js:637-646`) is the pattern CONTEXT.md means by "idempotency lock released per existing patterns" — note this is NOT how `grandTotal <= 0` / `> 10000` behave today (those return 400 with no explicit `releaseLock` call, relying on TTL expiry); WR-03 is the closer analog because, like the new assertion, it is a "safe to retry immediately" rejection:
```javascript
      .catch(function (termErr) {
        log.error('[pos/kiosk/sale] Terminal push failed: ' + termErr.message);
        // WR-03: release idempotency lock so the client can retry.  The terminal
        // push failed and NO charge was recorded — it's safe to allow a retry under
        // a fresh lock.  Do NOT release the lock when a charge may have succeeded
        // (i.e., polled OK then failed) — that case doesn't reach this catch.
        if (idempotencyKey) {
          cache.releaseLock(idempotencyKey).catch(function () {});
        }
        res.status(502).json({ error: 'Terminal error — please try again' });
      });
```
Copy this `if (idempotencyKey) { cache.releaseLock(idempotencyKey).catch(function () {}); }` shape verbatim for the new 400-class assertion-mismatch rejection.

**Backward compatibility (CONTEXT.md: "absent field → sale proceeds"):** mirror the existing optional-field idiom used for `body.reference_number` (line 593-595) and `body.gift_card` (line 529) — only compare when the field is a finite number, e.g.:
```javascript
  var refNumber = (body.reference_number && typeof body.reference_number === 'string')
    ? body.reference_number.slice(0, 64)
    : ('KIOSK-' + Date.now());
```

### 7. Middleware tests

**Analog A — `pos-tax.test.js`** (handler-extraction harness + catalog fixtures) — use for: "computeTax with a catalog item missing tax data does NOT silently apply 5%" and any `computeTax`/grandTotal regression:
```javascript
jest.mock('express', function () {
  var router = { get: jest.fn(), post: jest.fn(), put: jest.fn() };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});
jest.mock('../lib/cache', function () {
  return { get: jest.fn(), set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) };
});
...
function getHandlers() {
  jest.resetModules();
  cache = require('../lib/cache');
  ...
  require('../routes/pos');
  router = require('express').Router();
  handlers = {};
  router.post.mock.calls.forEach(function (call) { handlers[call[0]] = call[call.length - 1]; });
}
function mockRes() {
  var res = { json: jest.fn(), status: jest.fn(), headersSent: false };
  res.status.mockReturnValue(res);
  return res;
}
```
IMPORTANT: `pos-tax.test.js` has two EXISTING tests that assert the exact fallback behavior this phase removes — `'returns 202 pending for item without tax_id (uses KIOSK_TAX_RATE fallback)'` (line 177) and `'grandTotal uses KIOSK_TAX_RATE fallback when catalogItem has no tax_id AND no tax_percentage'` (line 238), both asserting a computed 5%-fallback total. Per CLAUDE.md rule 10 ("Do NOT modify existing tests unless explicitly asked"), these are asserting the OLD documented behavior that CONTEXT.md explicitly instructs removing — flag this conflict to the planner: these two tests must be updated (their fixtures now describe a data error, so the expected outcome changes from "202 pending, terminal charged $52.50/$105.00" to "400 rejected, terminal NOT charged") as a REQUIRED part of implementing decision "Remove all three silent 5% fallbacks," not an incidental test edit.

**Analog B — `pos-money-defects.test.js` WR-03 block** (fail-closed rejection + lock-release assertion pattern) — use for: "pre-charge assertion — client total ≠ server grandTotal → 400, no charge, lock released":
```javascript
describe('WR-03 — idempotency lock released on terminal failure so retries can re-acquire', function () {
  beforeEach(function () {
    getPosHandlers();
    process.env.KIOSK_CONTACT_ID = 'contact-walkin';
    cache.get.mockImplementation(function (key) {
      if (key === 'test:kiosk-products') return Promise.resolve(CATALOG_EXEMPT);
      return Promise.resolve(null);
    });
    moneyPath.acquireIdempotencyLock.mockResolvedValue({ status: 'acquired' });
    helcimLib.terminalPurchase.mockRejectedValue(new Error('Terminal connection refused'));
  });

  test('WR-03-A: terminal failure → cache.releaseLock called with the idempotency key', function (done) {
    var req = { body: { items: [...], idempotency_key: 'wr03-idem-key-001' } };
    var res = mockRes();
    res.json.mockImplementation(function () {
      try {
        expect(cache.releaseLock).toHaveBeenCalledWith('test:idem:wr03-idem-key-001');
        done();
      } catch (e) { done(e); }
    });
    res.status.mockImplementation(function (code) { expect(code).toBe(502); return res; });
    handlers['/api/kiosk/sale'](req, res);
  });
});
```
Reuse `getPosHandlers()`, `mockRes()`, `captureStatus(res)`, and the full mock block at the top of this file (lines 26-138, includes `../lib/money-path`, `../lib/cache` with `acquireLock`/`releaseLock`, `../lib/constants` with `KIOSK_IDEM_PREFIX: 'test:idem:'`) — this is the most complete existing pos.js test harness in the repo and should be the base for new pre-charge-assertion tests (new `describe('Pre-charge assertion...')` block appended to this file, or a new sibling file using an identical mock block).

**Analog C — `catalog.test.js` "GET /api/kiosk/products — tax rule enrichment"** (compound-tax resolution through the actual kiosk catalog build path) — use for: "compound-tax catalog resolution — item with BC PST + GST resolves tax_percentage === 12":
```javascript
describe('GET /api/kiosk/products — tax rule enrichment', function () {
  var mocks;
  beforeEach(function () {
    mocks = resetAndLoadCatalog();
    setupDefaultMocks(mocks);
  });

  test('sales_tax_rule_id from detail overrides tax_percentage', function () {
    var items = [makeItem({ item_id: 'k2', name: 'Beer Kit', rate: 150, tax_percentage: 0, tax_id: '', tax_name: '' })];
    mocks.zohoApi.fetchAllItems.mockResolvedValue(items);
    mocks.zohoApi.fetchItemDetailsBulk.mockResolvedValue({
      'k2': { tax_percentage: 5, tax_name: 'GST', sales_tax_rule_id: STANDARD_RULE_ID }
    });
    return callHandler('/api/kiosk/products', { query: {} }).then(function (res) {
      expect(res._body.items[0].tax_percentage).toBe(12);
      expect(res._body.items[0].tax_name).toBe('GST + PST');
      expect(res._body.items[0].sales_tax_rule_id).toBe(STANDARD_RULE_ID);
    });
  });
});
```
`GET /api/kiosk/products` (`zoho-middleware/routes/catalog.js:886`) calls `rebuildKioskCatalog()` (line 802-872, the exact function CONTEXT.md's test targets) on a cache miss (line 917) — this describe block already exercises that function's tax resolution and is the correct base to extend with a NEW test asserting the fail-closed path (item with no `tax_percentage`, no `sales_tax_rule_id` match, no `tax_id` → the item is rejected/flagged rather than silently defaulted, once `computeTax`'s guess is removed and any equivalent removed from `rebuildKioskCatalog` if the planner finds one there too — CONTEXT.md's file list only names `pos.js` `computeTax`, but `rebuildKioskCatalog` (catalog.js) feeds it the `tax_percentage` value, so read both together when writing this test).

## Shared Patterns

### Fail-closed rejection (money path)
**Source:** `zoho-middleware/routes/pos.js:406-419` (`resolveGstTaxId` custom-line guard), `zoho-middleware/routes/pos.js:637-646` (WR-03 terminal-failure lock release), Phase 52 fail-closed sweep doctrine (`.planning/phases/52-fail-closed-sweep/`)
**Apply to:** `computeTax` unresolved-tax rejection, pre-charge total-mismatch rejection — both must return `res.status(400).json({ error: '<message naming the item/cause>' })` and release the idempotency lock via `cache.releaseLock(idempotencyKey).catch(function () {})` when one is held, BEFORE any `helcimLib.terminalPurchase` call.

### Client-side "detect bad cart line, name it, block checkout" gate
**Source:** `js/kiosk-core.js:2436-2460` (57-03 phantom-item guard) + `js/kiosk-core.js:2307-2341` (`kioskShowError`)
**Apply to:** the missing-tax-item flag in `kioskCalcTotals`/`kioskProceedToPayment` — detect in the totals calculation, block in the checkout-entry function, surface via `kioskShowError(title, msg, canRetry)` naming the item.

### Keep-last-good on refresh failure
**Source:** `js/kiosk-core.js:833-879` (`kioskLoadProducts`), `js/kiosk-core.js:908-925` (`kioskRetryStalledLoads`)
**Apply to:** any new `kioskLoadProducts(true)` call site added for cart-lifecycle freshness — no new error handling needed, the function already never wipes a good grid on a failed forced refresh.

### Discriminated async result (not bare fail-open/fail-closed booleans)
**Source:** `zoho-middleware/routes/pos.js:537-568` (CR-02 gift-card real-balance lookup: `{ state: 'ok' | 'invalid' | 'unavailable' }`)
**Apply to:** if `computeTax` needs to signal "unresolvable tax" back to its caller, prefer returning `{ error: '<msg>' }` / `{ taxTotal: N }` (discriminated object) over throwing, matching this file's existing idiom for "a sub-computation may legitimately fail, and the caller must branch on why."

## No Analog Found

None — every file in scope is either a targeted in-place edit to `js/kiosk-core.js` / `zoho-middleware/routes/pos.js` (analog = surrounding code in the same file) or a new test file with a directly reusable sibling test file in the same directory.

## Metadata

**Analog search scope:** `js/kiosk-core.js`, `js/kiosk.js`, `zoho-middleware/routes/pos.js`, `zoho-middleware/routes/catalog.js`, `zoho-middleware/lib/money-path.js`, `zoho-middleware/__tests__/{pos-tax,pos-money-defects,catalog,redis-failclosed}.test.js`, `tests/frontend/kiosk-catalog-freshness.test.js`
**Files scanned:** 11 (7 source + 4 test)
**Pattern extraction date:** 2026-07-30
