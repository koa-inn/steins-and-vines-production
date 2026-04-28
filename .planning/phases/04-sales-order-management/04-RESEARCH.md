# Phase 4: Sales Order Management - Research

**Researched:** 2026-04-27
**Domain:** Zoho Books Sales Orders API + Kiosk POS Frontend (Vanilla JS IIFE)
**Confidence:** HIGH (codebase), MEDIUM (Zoho API behavior for auto-close)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Importing an SO loads its line items into the kiosk cart where staff CAN modify them — adjust quantities, remove items, and add new products from the catalog. Not read-only.
- **D-02:** All cart edits are LOCAL until payment time. At payment, the middleware updates the Zoho SO with modified line items first, then charges the new balance via the Helcim terminal.
- **D-03:** If the kiosk cart already has items when staff taps "Import to Cart", show a confirm dialog: "This will replace your current cart. Continue?" Clear cart on confirm.
- **D-04:** After importing, staff can browse the product grid and add NEW items (not on the original SO). The Zoho SO gets all items (original + modified + new) at payment time.
- **D-05:** The existing direct "Pay" button on SO cards remains for quick payment without modification. "Import to Cart" is an alternative path.
- **D-07:** After successful SO payment: show a payment receipt, then return to the empty cart/product grid view. Staff navigates back to the SO list manually.
- **D-08:** If the Zoho SO update succeeds but terminal payment fails or is declined: keep the modified SO in Zoho as-is. Show "Payment failed — retry?" so staff can retry payment on the already-updated SO.
- **D-09:** Horizontal toggle chips above the SO list: `Open`, `Draft`, `Closed`, `Paid`, `All`. Multiple chips active simultaneously.
- **D-10:** Default active filters: Open + Draft. Staff taps other chips to see history.
- **D-11:** Paid/closed SO cards are view-only — no Pay or Import buttons. Instead show a "Reorder" button that creates a NEW SO with the same line items.

### Claude's Discretion

- Fetch strategy for all statuses — batch-fetch-and-filter-client-side vs. per-status on demand (leaning toward batch-fetch-and-filter given "All" chip needs all data)
- Zoho SO auto-close behavior verification and whether explicit status update is needed (D-06)
- Exact chip styling and active/inactive states (match existing kiosk category filter pattern)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SOM-01 | Sales order list shows all statuses (open, draft, closed, paid) with a filter toggle | Middleware GET endpoint must fetch closed+paid in addition to current open+draft; client-side chip filter applies |
| SOM-02 | Staff can import an existing Zoho sales order's line items into the kiosk cart for payment | line_items in SO response must include `item_id` (currently stripped); new `_kioskImportedSoId` state variable; new `PUT /api/kiosk/salesorder-update` endpoint |
| SOM-03 | After payment on an imported SO, the SO is marked closed/paid in Zoho with payment linked | Zoho `POST /customerpayments` with `salesorders_to_apply` already used in existing pay endpoint; Zoho auto-closes SO when balance reaches 0 (MEDIUM confidence — see D-06 note) |

</phase_requirements>

---

## Summary

Phase 4 extends the existing kiosk Collect Payment view with three capabilities: (1) a multi-status filter so staff can see all sales orders including historical closed/paid ones; (2) an "Import to Cart" flow that loads an existing SO's line items into the kiosk cart for modification before payment; and (3) a "Reorder" flow for closed/paid SOs that clones them as new SOs.

The existing codebase is well-prepared for this work. `kioskCollectPayment()` handles the terminal flow, `zohoPut()` in `zoho-api.js` exists for SO updates, and `KIOSK_SO_CACHE_KEY` is already defined. The primary work is: extending the middleware fetch to include closed/paid statuses; preserving `item_id` in the line_items shape (currently stripped); adding a new `PUT /api/kiosk/salesorder-update` middleware endpoint; adding `_kioskImportedSoId` state and the cart import flow in `kiosk.js`; and wiring the chip filter UI described in `04-UI-SPEC.md`.

**Primary recommendation:** Implement as three layers — (1) middleware GET extension (fetch closed+paid, preserve `item_id`), (2) new PUT update endpoint, (3) frontend chip filter + import flow + reorder flow — one plan per layer.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| SO status chip filter | Browser / Client | — | Client-side filter on batch-fetched array; no re-fetch per chip |
| Fetch all-status SOs | API / Backend (middleware) | — | Middleware aggregates Zoho fetches and caches |
| Import SO line items to cart | Browser / Client | API/Backend (PUT update) | Cart state is local until payment; SO update happens at pay-time |
| SO line items update in Zoho | API / Backend (middleware) | — | `PUT /salesorders/{id}` via `zohoPut()` |
| Payment collection (imported SO) | API / Backend (middleware) | Browser (UX) | Reuses existing `salesorder-pay` path with pre-update step |
| Reorder — create new SO | API / Backend (middleware) | Browser (UX) | Reuses existing `salesorder-create` endpoint with copied items |
| SO status after payment | Zoho (auto-close via payment) | API/Backend (explicit PUT if needed) | Zoho auto-closes when balance reaches 0 via `customerpayments` |

---

## Standard Stack

This phase uses no new libraries. All capabilities are implemented with the project's existing stack.

### Core (existing — no changes)
| Component | Location | Purpose |
|-----------|----------|---------|
| `zoho-api.js` `zohoPut()` | `zoho-middleware/lib/zoho-api.js:111` | PUT to Zoho Books `/salesorders/{id}` |
| `zoho-api.js` `zohoGet()` | `zoho-middleware/lib/zoho-api.js` | GET Zoho Books `/salesorders` with status filter |
| `zoho-api.js` `zohoPost()` | `zoho-middleware/lib/zoho-api.js` | POST `customerpayments` + create SO |
| Redis cache (`cache.js`) | `zoho-middleware/lib/cache.js` | `KIOSK_SO_CACHE_KEY = 'kiosk:salesorders'`, 2-min TTL |
| `kiosk.js` IIFE | `js/kiosk.js` | All frontend kiosk logic — `var` ES5 style |
| `escapeHTML()` | `js/lib/utils.js` | Safe HTML rendering in string-concatenated cards |
| `showToast()` | `js/kiosk.js:61` | Success/error notifications |

**Installation:** No new packages required.

---

## Architecture Patterns

### System Architecture Diagram

```
Staff taps chip filter
        |
        v
[_kioskSalesOrders array] --client-side filter--> [Rendered SO cards]
        ^
        | (on view open, cache miss)
        |
[GET /api/kiosk/salesorders]
        |
        +--> zohoGet(open) + zohoGet(draft) + zohoGet(closed) + zohoGet(paid)
        +--> combined + sorted + cached (KIOSK_SO_CACHE_KEY, 2 min)
        +--> response includes item_id in line_items

Staff taps "Import to Cart"
        |
        +--> confirm dialog if cart non-empty
        +--> _kioskCart populated from SO line_items (mapped to catalog items)
        +--> _kioskImportedSoId = soId
        +--> navigate to browse view (SO banner shown in cart pane)
        |
Staff modifies cart (add/remove/adjust qty)
        |
Staff taps checkout
        |
        v
[PUT /api/kiosk/salesorder-update]
        |
        +--> zohoPut('/salesorders/{id}', { line_items: [...] })
        +--> on success → POST /api/kiosk/salesorder-pay (existing flow)
        +--> on SO update failure → return error, do NOT charge terminal
        +--> on terminal failure after SO update → keep SO as-is, show retry

Staff taps "Reorder Items" (closed/paid SO)
        |
        +--> confirm dialog
        +--> POST /api/kiosk/salesorder-create (existing endpoint, copied items)
        +--> success: toast + refresh SO list
```

### Recommended Project Structure (no new directories)

```
js/
└── kiosk.js         # All new frontend code goes here (IIFE pattern)
zoho-middleware/
└── routes/
    └── pos.js       # New PUT endpoint added here (line 1328+, before module.exports)
zoho-middleware/
└── __tests__/
    └── kiosk-salesorders.test.js  # New tests appended here
css/
└── kiosk.css        # New chip + import banner CSS appended
```

### Pattern 1: Batch-Fetch-and-Filter-Client-Side (Claude's Discretion Resolution)

**What:** Fetch all SO statuses in a single middleware call when the collect view opens. Store the full array in `_kioskSalesOrders`. Apply chip filter client-side on the array without re-fetching.

**When to use:** The "All" chip must show all data; per-chip re-fetch would require 4 separate API calls and re-render on every tap. Existing pattern (open+draft batch) already uses this approach.

**Rationale over per-status-on-demand:** Cache is shared — a single `KIOSK_SO_CACHE_KEY` covers all statuses. Per-status demand would require separate cache keys and 4x Zoho API calls on cache miss. Batch is consistent with the current open+draft fetch pattern.

**Implementation:**
```javascript
// Source: extends pos.js lines 972-975 pattern
// Fetch all 4 statuses in parallel
return Promise.all([
  zohoGet('/salesorders', Object.assign({}, fetchParams, { status: 'open' })),
  zohoGet('/salesorders', Object.assign({}, fetchParams, { status: 'draft' })),
  zohoGet('/salesorders', Object.assign({}, fetchParams, { status: 'closed' })),
  zohoGet('/salesorders', Object.assign({}, fetchParams, { status: 'confirmed' }))
  // Note: Zoho uses 'confirmed' not 'paid' — see Assumptions A1
]).then(function (results) {
  var combined = results.reduce(function (acc, r) {
    return acc.concat(r.salesorders || []);
  }, []);
  // ... sort, map, cache
});
```

**Client-side chip filter:**
```javascript
// Source: kiosk.js pattern (client-side filter on _kioskSalesOrders)
function kioskFilterSosByChips() {
  var activeChips = _kioskSoActiveChips; // Set of active status strings
  if (activeChips.indexOf('all') !== -1) return _kioskSalesOrders;
  return _kioskSalesOrders.filter(function (so) {
    return activeChips.indexOf(so.status) !== -1;
  });
}
```

### Pattern 2: Import-to-Cart State Management

**What:** A new state variable `_kioskImportedSoId` tracks which SO has been imported. When non-null, checkout path uses the SO update+pay flow instead of the new-sale flow.

**Critical detail:** The current SO list strips `item_id` from line_items (pos.js line 991-997). For import to work, `item_id` MUST be preserved in the response. This requires modifying the line_items mapping in the GET handler.

**Cart population from SO line items:**
```javascript
// Source: kiosk.js _kioskCart pattern (line 684, 1244)
// SO line items must be mapped to the same shape as _kioskCart entries
// { item: { item_id, name, rate, product_type, ... }, qty: N }
// The 'item' object must match the kiosk product catalog shape for
// kioskRenderCart() and kioskCalcTotals() to work correctly.
// Strategy: look up each SO line_item.item_id in _kioskProducts array
// to get the full product object, then set qty from SO line item.
function kioskImportSoToCart(so) {
  var newCart = {};
  (so.line_items || []).forEach(function (li) {
    var product = kioskFindProductById(li.item_id);
    if (product) {
      newCart[product.item_id] = { item: product, qty: li.quantity };
    }
    // Items not in catalog (e.g. discontinued) are silently skipped
    // or shown as warning toast
  });
  _kioskCart = newCart;
  _kioskImportedSoId = so.salesorder_id;
  _kioskImportedSoNumber = so.salesorder_number;
}
```

### Pattern 3: SO Update Before Payment (New Middleware Endpoint)

**What:** `PUT /api/kiosk/salesorder-update` updates the SO line items in Zoho before charging the terminal. Called from the frontend checkout flow when `_kioskImportedSoId` is set.

**Endpoint body:**
```javascript
// Source: Zoho Books API PUT /salesorders/{id} docs
// zohoPut already exists in zoho-api.js line 111
{
  salesorder_id: 'zoho_so_id',
  items: [
    { item_id: 'ITEM-A', name: 'Wine Kit', quantity: 2, rate: 14.99 }
  ]
}
// Middleware maps to Zoho payload:
// { line_items: [{ item_id, quantity, rate, name }] }
```

**Response:**
```javascript
{ ok: true, salesorder_id, salesorder_number, total, balance }
// or error status 4xx/5xx
```

**Frontend checkout fork:**
```javascript
// In kiosk.js checkout flow — detect imported SO mode
if (_kioskImportedSoId) {
  // Step 1: Update SO line items
  // Step 2: On success → kioskCollectPayment(_kioskImportedSoId)
  // Step 3: On SO update failure → show error, do NOT proceed to terminal
  // Step 4: On terminal failure after update → D-08 (keep SO, show retry)
} else {
  // Existing new-sale flow via /api/kiosk/sale/confirm
}
```

### Pattern 4: Reorder Flow

**What:** Reorder creates a new SO using the existing `POST /api/kiosk/salesorder-create` endpoint with the line items from the closed/paid SO. No new endpoint needed.

**Key detail:** Closed/paid SOs from Zoho include `customer_id` in the response (already mapped in the GET handler). The reorder call passes `customer_id` + `line_items` from the selected SO.

```javascript
function kioskReorderSo(so) {
  if (!confirm('Create a new order with the same items as ' + so.salesorder_number + '?')) return;
  var payload = {
    customer_id: so.customer_id,
    items: (so.line_items || []).map(function (li) {
      return { item_id: li.item_id, name: li.name, quantity: li.quantity, rate: li.rate };
    })
  };
  fetch(mwUrl + '/api/kiosk/salesorder-create', { method: 'POST', ... body: payload })
    .then(function (result) {
      if (result.data.ok) {
        showToast('New order created: ' + result.data.salesorder_number, 'success');
        cache.del(KIOSK_SO_CACHE_KEY); // done server-side; frontend re-fetches
        kioskLoadSalesOrders(); // re-fetch and show Open+Draft default
      }
    });
}
```

### Pattern 5: Zoho SO Auto-Close Behavior (D-06 Resolution)

**Research finding:** Zoho Books documentation states SOs are closed automatically when converted to an invoice or when a shipment is fulfilled. It does NOT state that `POST /customerpayments` with `salesorders_to_apply` auto-closes the SO. [ASSUMED]

**Recommended approach (Claude's Discretion):** The existing `kioskCollectPayment` already records payment via `POST /customerpayments` with `salesorders_to_apply`. If the SO status does not automatically transition to closed/paid after payment, no explicit `PUT /salesorders/{id}/status/void` or similar is needed for this use case — the SO balance will be 0, and the kiosk chip filter will effectively hide it under Open+Draft. The SO list endpoint filters by status from Zoho, not by balance. Therefore, if Zoho does NOT auto-close, "paid" SOs will remain visible under "Open" filter with balance=0 (already handled by the existing paid badge at balance=0). Flag this for verification against the live Zoho org during implementation.

**Safe fallback:** If needed, after `POST /customerpayments` succeeds, call `POST /salesorders/{id}/status/closed` (if that endpoint exists in the org's Zoho Books plan). The `zohoPut()` helper exists; a `zohoPost()` call to the substatus endpoint is also available. This can be added as a no-op-on-failure post-payment step.

### Anti-Patterns to Avoid

- **Stripping `item_id` from line_items in the GET response:** Currently done at pos.js lines 991-997. MUST be fixed — import-to-cart requires `item_id` to look up products in the catalog.
- **Re-fetching from Zoho on every chip tap:** Defeats caching. Chip filter must operate on the in-memory `_kioskSalesOrders` array.
- **Populating cart from SO line_items without catalog lookup:** SO line items only have `{ name, quantity, rate, item_id }`. The kiosk cart expects a full product object `{ item_id, name, rate, product_type, available_stock, ... }`. Always look up from `_kioskProducts` by `item_id`.
- **Charging the terminal before updating the SO:** D-02 requires SO update first. If SO update fails, terminal must NOT be charged.
- **Reverting the SO after a terminal failure:** D-08 explicitly says do NOT revert. Show retry UI.
- **Using `_kioskSoItems` for the import flow:** `_kioskSoItems` is the create-SO form's item list. Import-to-cart uses `_kioskCart` (the main cart). These are separate.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SO update to Zoho | Custom HTTP client | `zohoPut()` in `zoho-api.js` | Already handles auth, retry, org_id param |
| Payment terminal flow | New polling loop | `kioskCollectPayment(soId)` | Existing function handles terminal push, polling, void-on-failure, receipt |
| New SO creation (reorder) | New endpoint | `POST /api/kiosk/salesorder-create` | Already validated and tested |
| Redis caching | Manual cache | `cache.get/set/del` from `zoho-middleware/lib/cache.js` | Already used for `KIOSK_SO_CACHE_KEY` |
| HTML escaping | Custom sanitizer | `escapeHTML()` from `js/lib/utils.js` | Already imported in kiosk.js |
| SO card rendering | Rebuild from scratch | Extend `kioskRenderSoList()` | Add chip filter + action row to existing card HTML builder |

---

## Critical Discovery: `item_id` Missing from SO Line Items

The current `GET /api/kiosk/salesorders` response maps line items as:
```javascript
// pos.js lines 991-997 — CURRENT (incomplete for import)
line_items: (so.line_items || []).map(function (li) {
  return {
    name: li.name || li.description || '',
    quantity: li.quantity || 1,
    rate: li.rate || 0,
    amount: li.amount || 0
    // item_id is NOT preserved here
  };
})
```

For SOM-02 (import to cart), `item_id` is required to look up the full product in `_kioskProducts`. The fix is to add `item_id: li.item_id || ''` to the line_items map. This is a one-line change with a cache invalidation side-effect (the cached shape changes, so `KIOSK_SO_CACHE_KEY` must be busted on deploy or TTL allowed to expire).

For the reorder flow (SOM-01 via D-11), `item_id` is also required to pass valid items to `salesorder-create`.

**Action required in Wave 1:** Fix `item_id` preservation in the GET handler as the very first task, before any other work that depends on imported SO items.

---

## Common Pitfalls

### Pitfall 1: Chip Filter State vs. Fetch Completeness
**What goes wrong:** Staff taps "Closed" chip, no orders appear, even though closed orders exist in Zoho — because the middleware only fetched open+draft.
**Why it happens:** The current fetch is hardcoded to fetch only `open` and `draft` statuses (pos.js lines 973-975).
**How to avoid:** Extend the fetch to include `closed` and `confirmed` (Zoho's term for paid) in the parallel Promise.all. Clear `KIOSK_SO_CACHE_KEY` after deploy.
**Warning signs:** SO list returns empty after tapping Closed chip.

### Pitfall 2: Cart Population Without Catalog Lookup
**What goes wrong:** Imported SO items appear in cart with wrong `product_type`, missing `available_stock`, or incorrect maker's fee handling — because they were built from the SO line item, not the catalog entry.
**Why it happens:** SO line items only carry `{ item_id, name, quantity, rate }`. The kiosk cart's `kioskSyncMakersFee()` and `kioskGetItemType()` read from the product object.
**How to avoid:** After import, look up each `item_id` in `_kioskProducts`. If products haven't loaded yet, wait for them (`kioskLoadProducts()` first). Skip items not found in catalog with a warning toast.
**Warning signs:** Maker's fee not appearing for kit items imported from an SO.

### Pitfall 3: Double SO Update on Retry
**What goes wrong:** Staff retries payment after terminal failure — the SO gets updated a second time before terminal charge, creating duplicate or incorrect line items.
**Why it happens:** The retry path re-enters the SO update step.
**How to avoid:** Track whether the SO has already been updated in this session (e.g., `_kioskImportedSoUpdated = true` flag). On retry, skip the SO update step and call `kioskCollectPayment(_kioskImportedSoId)` directly, as D-08 requires. The SO is already correct in Zoho.
**Warning signs:** SO line items are duplicated or show wrong quantities after a retry.

### Pitfall 4: Cache Key Invalidation After GET Handler Fix
**What goes wrong:** After deploying the `item_id` fix to the GET handler, cached responses (Redis TTL 2 min) still return the old shape without `item_id`.
**Why it happens:** Redis cache stores the old serialized line_items shape.
**How to avoid:** After deploying, either (a) wait 2 minutes for TTL to expire, or (b) add a cache version suffix to `KIOSK_SO_CACHE_KEY` (e.g., append `:v2`).
**Warning signs:** `item_id` is null in imported SO line items immediately after deploy.

### Pitfall 5: Zoho Status Filter Values
**What goes wrong:** Fetching with `status: 'paid'` returns 0 results because Zoho Books uses `confirmed` (not `paid`) for paid/invoiced orders.
**Why it happens:** Zoho Books status vocabulary differs from UI labels. The UI shows "Paid" but the API status may be `confirmed` or the invoiced_status field may carry the paid state separately.
**How to avoid:** During implementation, test against the live Zoho org. The CONTEXT.md mentions `confirmed` as a valid Zoho status. Use `confirmed` in the API fetch, but map it to `paid` in the frontend chip logic. [ASSUMED — verify in live org]
**Warning signs:** Closed/paid chip shows zero orders despite orders existing in Zoho.

### Pitfall 6: `_kioskSoItems` vs `_kioskCart` Confusion
**What goes wrong:** Code accidentally modifies `_kioskSoItems` (create-SO form) instead of `_kioskCart` (main cart) during the import flow, or vice versa.
**Why it happens:** Both arrays hold "items to be ordered" but serve different flows.
**How to avoid:** Import-to-cart flow exclusively uses `_kioskCart` (keyed by `item_id`). The create-SO form flow uses `_kioskSoItems` (array of plain objects). Never cross-assign.
**Warning signs:** Importing an SO clears the create-SO form, or the create-SO form picks up items from a previous import.

---

## Code Examples

### GET /api/kiosk/salesorders — Extended Fetch (middleware)
```javascript
// Source: pos.js lines 972-975 (existing), extended pattern
var fetchParams = { sort_column: 'date', sort_order: 'D' };
return Promise.all([
  zohoGet('/salesorders', Object.assign({}, fetchParams, { status: 'open' })),
  zohoGet('/salesorders', Object.assign({}, fetchParams, { status: 'draft' })),
  zohoGet('/salesorders', Object.assign({}, fetchParams, { status: 'closed' })),
  zohoGet('/salesorders', Object.assign({}, fetchParams, { status: 'confirmed' }))
]).then(function (results) {
  var combined = results.reduce(function (acc, r) {
    return acc.concat(r.salesorders || []);
  }, []);
  combined.sort(function (a, b) {
    return (b.date || '').localeCompare(a.date || '');
  });
  var orders = combined.map(function (so) {
    return {
      salesorder_id: so.salesorder_id || '',
      salesorder_number: so.salesorder_number || '',
      customer_name: so.customer_name || '',
      customer_id: so.customer_id || '',   // needed for reorder
      balance: so.balance || 0,
      total: so.total || 0,
      status: so.status || '',
      date: so.date || '',
      line_items: (so.line_items || []).map(function (li) {
        return {
          item_id: li.item_id || '',       // ADDED — was missing
          name: li.name || li.description || '',
          quantity: li.quantity || 1,
          rate: li.rate || 0,
          amount: li.amount || 0
        };
      })
    };
  });
  cache.set(KIOSK_SO_CACHE_KEY, orders, KIOSK_SO_CACHE_TTL).catch(function () {});
  return orders;
});
```

### PUT /api/kiosk/salesorder-update — New Endpoint (middleware)
```javascript
// Source: zoho-api.js zohoPut() pattern (line 111), salesorder-create pattern (line 1038)
router.put('/api/kiosk/salesorder-update', requireApiKey, function (req, res) {
  var body = req.body || {};
  var soId = body.salesorder_id;
  if (!soId || typeof soId !== 'string') {
    return res.status(400).json({ error: 'Missing salesorder_id' });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return res.status(400).json({ error: 'items required' });
  }

  var payload = {
    line_items: body.items.map(function (item) {
      return {
        item_id: item.item_id,
        quantity: item.quantity,
        rate: item.rate,
        name: item.name || ''
      };
    })
  };

  zohoPut('/salesorders/' + soId, payload)
    .then(function (data) {
      var so = data.salesorder || {};
      cache.del(KIOSK_SO_CACHE_KEY).catch(function () {});
      eventLog.logEvent('kiosk.salesorder_updated', { soId: soId, itemCount: body.items.length });
      res.json({ ok: true, salesorder_id: soId, salesorder_number: so.salesorder_number || '',
                 total: so.total || 0, balance: so.balance || 0 });
    })
    .catch(function (err) {
      log.error('[kiosk/so-update] Zoho error: ' + err.message);
      res.status(502).json({ error: 'Failed to update sales order' });
    });
});
```

### Frontend Chip Filter State (kiosk.js)
```javascript
// Source: kiosk.js pattern (state variables at line 706+, chip button pattern)
// New state variables (add alongside existing _kioskSo* variables)
var _kioskImportedSoId = null;
var _kioskImportedSoNumber = null;
var _kioskImportedSoUpdated = false;  // D-08: track if SO update already done
var _kioskSoActiveChips = ['open', 'draft'];  // D-10: default

function kioskHandleSoChip(chipEl) {
  var status = chipEl.getAttribute('data-status');
  if (status === 'all') {
    _kioskSoActiveChips = ['all'];
  } else {
    var idx = _kioskSoActiveChips.indexOf('all');
    if (idx !== -1) _kioskSoActiveChips.splice(idx, 1);
    var i = _kioskSoActiveChips.indexOf(status);
    if (i !== -1) {
      if (_kioskSoActiveChips.length > 1) {  // never empty
        _kioskSoActiveChips.splice(i, 1);
      }
    } else {
      _kioskSoActiveChips.push(status);
    }
  }
  kioskRenderSoChips();
  kioskRenderSoList();
}
```

### Import to Cart — Frontend (kiosk.js)
```javascript
// Source: kiosk.js _kioskCart pattern (line 684, 1488), confirm() pattern
function kioskImportSoToCart(soId) {
  var so = null;
  for (var i = 0; i < _kioskSalesOrders.length; i++) {
    if (_kioskSalesOrders[i].salesorder_id === soId) { so = _kioskSalesOrders[i]; break; }
  }
  if (!so) { showToast('Order not found', 'error'); return; }

  if (Object.keys(_kioskCart).length > 0) {
    if (!confirm('Replace current cart with items from ' + so.salesorder_number + '? Current cart will be cleared.')) return;
  }

  // Ensure products are loaded before mapping
  if (!_kioskProductsLoaded) {
    showToast('Loading products...', 'info');
    return;
  }

  _kioskCart = {};
  _kioskDiscount = null;
  var skipped = 0;
  (so.line_items || []).forEach(function (li) {
    if (!li.item_id) { skipped++; return; }
    var product = kioskFindProductById(li.item_id);
    if (product) {
      _kioskCart[product.item_id] = { item: product, qty: li.quantity || 1 };
    } else {
      skipped++;
    }
  });

  _kioskImportedSoId = so.salesorder_id;
  _kioskImportedSoNumber = so.salesorder_number;
  _kioskImportedSoUpdated = false;

  if (skipped > 0) {
    showToast(skipped + ' item(s) from order not found in catalog — skipped', 'warning');
  }

  kioskSyncMakersFee();
  kioskRenderCart();
  kioskRenderProducts();
  kioskShowView('browse');
}
```

### Checkout Fork — Imported SO vs New Sale (kiosk.js)
```javascript
// Source: kiosk.js kioskProceedToPayment() pattern (line 1801)
// After terminal payment setup, before fetch:
if (_kioskImportedSoId && !_kioskImportedSoUpdated) {
  // Step 1: Update SO line items first (D-02)
  fetch(mwUrl + '/api/kiosk/salesorder-update', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' },
    body: JSON.stringify({ salesorder_id: _kioskImportedSoId, items: items })
  })
  .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
  .then(function (result) {
    if (result.data && result.data.ok) {
      _kioskImportedSoUpdated = true;
      // Step 2: Collect payment on updated SO
      kioskCollectPayment(_kioskImportedSoId);
    } else {
      // SO update failed — do NOT proceed to terminal (D-02)
      kioskShowSoError('Order update failed', 'Order update failed — payment not taken. Check connection and retry.', true);
    }
  })
  .catch(function () {
    kioskShowSoError('Connection Error', 'Order update failed — payment not taken. Check connection and retry.', true);
  });
} else if (_kioskImportedSoId && _kioskImportedSoUpdated) {
  // Retry after terminal failure — SO already updated (D-08)
  kioskCollectPayment(_kioskImportedSoId);
} else {
  // Existing new-sale flow
  kioskProceedToNewSale(items, totals, mwUrl, ...);
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `GET /salesorders` fetches open+draft only | Phase 4: fetch open+draft+closed+confirmed | Phase 4 | All-status view available |
| SO line items strip `item_id` | Phase 4: preserve `item_id` | Phase 4 | Import-to-cart becomes possible |
| Single-status chip (implicit: Open+Draft) | Phase 4: multi-select chip filter | Phase 4 | Staff can view history |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Zoho Books API accepts `status: 'confirmed'` to filter paid/invoiced SOs (not `status: 'paid'`) | Architecture Patterns — batch fetch | Confirmed SOs not returned; Closed chip shows nothing. Fix: test status values in live Zoho org during Wave 1 |
| A2 | Zoho Books auto-closes/marks an SO as paid when `POST /customerpayments` with `salesorders_to_apply` reduces balance to 0 | Pattern 5 / D-06 | SO remains in open state with 0 balance; kiosk filter doesn't move it to Closed chip. Fix: add explicit `POST /salesorders/{id}/status/closed` call after payment recording if status doesn't transition |
| A3 | `PUT /salesorders/{id}` in Zoho Books accepts `{ line_items: [{item_id, quantity, rate, name}] }` to replace/update line items | Code Examples — PUT endpoint | Zoho rejects body or silently ignores — fix during implementation by testing against live org |
| A4 | The `closed` status returned by Zoho's GET `/salesorders?status=closed` aligns with what the Zoho UI labels "Closed" | Architecture Patterns | Status mismatch; incorrect chip mapping |

---

## Open Questions

1. **Zoho SO status values and auto-close behavior (A1, A2)**
   - What we know: Zoho docs say auto-close happens via invoice conversion; `customerpayments` records payment but status transition is unconfirmed
   - What's unclear: Does `POST /customerpayments` + `salesorders_to_apply` auto-transition SO status?
   - Recommendation: During Wave 1, test against the live Zoho org by applying a payment via the existing `kioskCollectPayment()` flow and checking the SO status in the Zoho UI. Log the status before and after. This determines whether D-06 requires an explicit status update call.

2. **Closed SO line_items from Zoho include `item_id`?**
   - What we know: The GET `/salesorders` list endpoint returns `line_items` including `item_id` in the Zoho response (the current code strips it — that's our doing, not Zoho's)
   - What's unclear: Do closed/historical SOs still have valid `item_id` values pointing to current catalog items, or have some items been deleted from Zoho Inventory?
   - Recommendation: Add graceful skip (already in the import-to-cart pattern above) for items not found in `_kioskProducts`. Show a warning toast with the count of skipped items.

3. **`requireApiKey` middleware on PUT endpoint**
   - What we know: Existing POST endpoints in pos.js use `requireApiKey` for protected operations
   - What's unclear: Whether the PUT endpoint pattern in pos.js follows the same middleware chain as POST
   - Recommendation: Confirm by grepping for `requireApiKey` usage in pos.js and apply the same pattern.

---

## Environment Availability

Step 2.6: Environment availability audit — no new external dependencies in this phase. All capabilities use existing middleware (Railway), Zoho Books API (existing auth), Redis (existing), and Helcim terminal (existing). No new tools or services required.

---

## Security Domain

`security_enforcement: true`, `security_asvs_level: 1`, `security_block_on: high`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (kiosk auth) | Existing Google OAuth + PIN session — no changes |
| V4 Access Control | yes | `requireApiKey` on new PUT endpoint (existing pattern) |
| V5 Input Validation | yes | Validate `salesorder_id` (string, non-empty), `items` array (non-empty, item_id, quantity, rate) — same pattern as salesorder-create |
| V6 Cryptography | no | No crypto in this phase |

### Known Threat Patterns for This Phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unauthorized SO modification via PUT endpoint | Tampering | `requireApiKey` header check (existing pattern in pos.js) |
| XSS via SO customer_name or SO number in rendered card HTML | Tampering | `escapeHTML()` already used in `kioskRenderSoList()` — continue using for all new card HTML |
| Ghost charge: terminal charged before SO update confirmed | Elevation of Privilege | D-02: SO update MUST succeed before terminal call — enforced in checkout fork |
| SO ID manipulation: client sends arbitrary soId to update endpoint | Tampering | Middleware fetches SO from Zoho before updating — validates SO exists and is in a mutable state |

---

## Sources

### Primary (HIGH confidence)
- `js/kiosk.js` (read directly) — `_kioskSalesOrders`, `kioskCollectPayment()`, `kioskRenderSoList()`, cart state `_kioskCart`
- `zoho-middleware/routes/pos.js` (read directly) — `GET /api/kiosk/salesorders`, `POST /api/kiosk/salesorder-create`, `POST /api/kiosk/salesorder-pay` implementations
- `zoho-middleware/lib/zoho-api.js` (read directly) — `zohoPut()` exists and available
- `zoho-middleware/__tests__/kiosk-salesorders.test.js` (read directly) — existing test patterns for new tests to follow
- `.planning/phases/04-sales-order-management/04-CONTEXT.md` (read directly) — locked decisions
- `.planning/phases/04-sales-order-management/04-UI-SPEC.md` (read directly) — chip CSS, card HTML, copy

### Secondary (MEDIUM confidence)
- [Zoho Books API v3 Sales Order docs](https://www.zoho.com/books/api/v3/sales-order/) — PUT /salesorders/{id} field structure (line_items fields confirmed), status endpoint list (open/void confirmed)
- [Zoho Books Close Sales Orders FAQ](https://www.zoho.com/us/books/kb/sales-order/close-sales-orders.html) — auto-close behavior (via invoice conversion, NOT via payment)

### Tertiary (LOW confidence — flag for validation)
- Zoho SO status filter values (`closed`, `confirmed`) — inferred from web search results, not verified against live Zoho org
- Auto-close behavior after `POST /customerpayments` — not confirmed by docs; assumed based on `salesorders_to_apply` semantics

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all components verified by reading source files directly
- Architecture: HIGH for patterns; MEDIUM for Zoho API behavior (A1-A4 need live-org verification)
- Pitfalls: HIGH — discovered by reading existing code closely (item_id stripping is a concrete finding)

**Research date:** 2026-04-27
**Valid until:** 2026-05-27 (stable — Zoho API changes infrequently; kiosk codebase changes tracked in git)
