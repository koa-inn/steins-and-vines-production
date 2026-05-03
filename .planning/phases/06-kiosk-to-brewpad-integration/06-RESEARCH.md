# Phase 6: Kiosk-to-Brewpad Integration - Research

**Researched:** 2026-05-03
**Domain:** Express middleware + Google Apps Script + vanilla JS BrewPad UI
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Trigger Mechanism**
- D-01: Middleware calls Apps Script directly after successful sale confirm (`POST /api/kiosk/sale/confirm`). Uses existing `APPS_SCRIPT_URL` + `APPS_SCRIPT_SERVER_TOKEN`.
- D-02: Only kit sales that include a Maker's Fee line item trigger batch creation. This is the signal that distinguishes ferment-in-store kits from take-home purchases.
- D-03: One batch is created per kit line item. If a customer buys 2 different kits, they get 2 separate batches.
- D-04: If Apps Script call fails, store the pending batch creation in Redis and retry later. Sale still succeeds — batch creation is eventually consistent.

**Pending Batch State**
- D-05: Modify existing `createBatch` in Apps Script to make `schedule_id` and `start_date` optional. When omitted, batch is created with status "pending".
- D-06: Pending batches appear in the main batch list (not a separate queue) with a visible "Pending" badge.
- D-07: No auto-suggest for fermentation schedule. Staff always explicitly picks the schedule when setting up a pending batch.

**Customer Data Source**
- D-08: Pull customer info from the Zoho sales order (canonical source). Middleware has `customer_name` and `customer_id` from the invoice creation step.
- D-09: Store name + customer_id only in the batch. No email — reduces PII in Sheets.

**From-Kiosk Indicator**
- D-10: Add a "source" column to the Batches sheet with values "kiosk" or "manual".
- D-11: BrewPad renders a "Kiosk" badge next to the batch in the list, visible only while the batch is in "pending" status. Once staff assigns a schedule and the batch goes active, the badge disappears.
- D-12: Zoho sales order number is shown only in the batch detail view (not in the list row). Satisfies INTG-03.

### Claude's Discretion
- Retry mechanism details (Redis key structure, retry interval, max attempts)
- How to detect Maker's Fee in the sale line items (by SKU, by name pattern, or by item type)
- Exact placement and styling of the "Kiosk" badge in the batch list UI

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INTG-01 | When a kit is sold on the kiosk, a batch is auto-created in BrewPad with customer name, product, and SO reference | D-01/D-02 confirmed: hook in `sale/confirm` after invoice creation; `notifyAdminPanel` pattern shows how to call Apps Script server-to-server |
| INTG-02 | Auto-created batches appear in the BrewPad batch list with a "from kiosk" indicator | D-10/D-11 confirmed: new `source` column in Batches sheet; `STATUS_LABELS`/`STATUS_COLORS` maps in brewpad.js show exactly where to add "Pending" + "Kiosk" badge rendering |
| INTG-03 | Batch detail view shows the linked sales order number with a reference back to Zoho | D-12 confirmed: `renderBatchDetail` in brewpad.js builds the info grid; adding a `zoho_so_number` field in the detail info section |
</phase_requirements>

---

## Summary

This phase wires the kiosk sale completion event in the Express middleware to a batch auto-creation call in the Google Apps Script backend, then surfaces the auto-created batch in the BrewPad frontend with a "Pending" status and "Kiosk" source indicator.

The trigger point is `POST /api/kiosk/sale/confirm` in `zoho-middleware/routes/pos.js`. After the invoice payment chain resolves (line ~505), the handler already has `lineItems`, `invoiceNumber`, and `body.contact_id` / `body.customer_name`. The batch creation logic needs to inspect `lineItems` for a Maker's Fee item (by the same `findMakersFeeItem` logic already in `checkout-helpers.js`) and for each non-fee kit item, fire an Apps Script `create_batch` call using the existing `APPS_SCRIPT_URL` + `APPS_SCRIPT_SERVER_TOKEN` pattern from `notifyAdminPanel`.

The Apps Script side requires two changes: (1) the `doPost` server-token branch must accept the `create_batch` action (currently only `add_reservation` is allowed), and (2) `createBatch` must accept a pending mode where `schedule_id` and `start_date` are omitted and the initial status is set to `"pending"`. The Batches sheet needs a new `source` column and a `zoho_so_number` column appended.

The BrewPad frontend requires adding `"pending"` to `STATUS_LABELS` / `STATUS_COLORS`, adding a "Pending" filter button, rendering a small "Kiosk" badge beside list rows where `source === 'kiosk'` and `status === 'pending'`, and displaying `zoho_so_number` in the detail view's info grid.

**Primary recommendation:** Implement batch creation as a fire-and-forget side effect in `sale/confirm`, mirroring `notifyAdminPanel`, with a Redis retry queue using a new key prefix `brewpad:pending-batch:`. Scope each change tightly to minimize regression surface.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Detect Maker's Fee in sale items | API / Backend (middleware) | — | All item catalog lookups happen server-side; `findMakersFeeItem` already exists in `checkout-helpers.js` |
| Call Apps Script to create batch | API / Backend (middleware) | — | Server-to-server call using `APPS_SCRIPT_SERVER_TOKEN`; the client must never hold that token |
| Batch persistence (Sheets) | Apps Script backend | — | All Batches-sheet writes go through Apps Script; middleware has no direct Sheets access |
| Retry queue for failed batch creation | API / Backend (Redis) | — | Redis already used for idempotency/retry patterns in this file |
| Status/source display in batch list | Frontend (brewpad.js) | — | All BrewPad rendering is in the IIFE in `js/brewpad.js`; no framework involved |
| Batch detail SO number display | Frontend (brewpad.js) | — | `renderBatchDetail` builds the info grid directly |

---

## Standard Stack

No new packages required. All capabilities use existing dependencies.

### Existing Dependencies Used

| Asset | Location | Purpose in This Phase |
|-------|----------|----------------------|
| `axios` | `zoho-middleware/node_modules` | HTTP POST to Apps Script URL (already used by `notifyAdminPanel`) |
| `zoho-middleware/lib/cache.js` | Cache module | Redis `get`/`set`/`del` for retry queue |
| `zoho-middleware/lib/constants.js` | Constants | Add new `BATCH_RETRY_PREFIX` key |
| `zoho-middleware/lib/checkout-helpers.js` | Helpers | `findMakersFeeItem` — reuse for Maker's Fee detection |
| `zoho-middleware/lib/logger.js` | Logger | Structured logging in new code |
| `zoho-middleware/lib/eventLog.js` | Event log | Log `kiosk.batch_created` / `kiosk.batch_retry_queued` events |
| `apps-script/adminApi.gs` | Apps Script | `createBatch` and `doPost` server-token branch |
| `js/brewpad.js` | Frontend | Batch list + detail rendering, STATUS_LABELS, STATUS_COLORS |

**No `npm install` step required.** [VERIFIED: grep of pos.js and checkout-helpers.js — axios already imported in checkout-helpers.js; cache.js already required by pos.js]

---

## Architecture Patterns

### System Architecture Diagram

```
[Kiosk UI]
     |
     | POST /api/kiosk/sale/confirm
     v
[pos.js — sale/confirm handler]
     |
     |-- create Zoho invoice (existing)
     |-- record payment (existing)
     |-- cache.del(kiosk-products) (existing)
     |-- ledger.decrementStock() (existing)
     |
     +-- NEW: detectKitItems(lineItems)
          |
          |-- no Maker's Fee found? -> skip (not a ferment-in-store sale)
          |
          +-- Maker's Fee found -> for each non-fee kit item:
               |
               | fire-and-forget: callAppsScriptCreateBatch(payload)
               |    |
               |    |-- success: log kiosk.batch_created
               |    |
               |    +-- failure: cache.set(BATCH_RETRY_PREFIX + batchKey, payload, TTL)
               |                  log kiosk.batch_retry_queued
               v
        [Apps Script — doPost]
             |
             | server_token validated
             | action === 'create_batch'
             v
        [createBatch() — pending mode]
             |
             | schedule_id / start_date optional
             | status = 'pending' when omitted
             | source = 'kiosk'
             | zoho_so_number = invoiceNumber
             v
        [Batches Google Sheet]
             |
             | new row with source='kiosk', status='pending'
             v
        [BrewPad UI — next refresh]
             |
             | get_batches returns batch with source='kiosk', status='pending'
             v
        [renderBatchList — "Pending" badge + "Kiosk" indicator]
        [renderBatchDetail — zoho_so_number in info grid]
```

### Recommended File Structure (changes only)

```
zoho-middleware/
  lib/
    constants.js           # add BATCH_RETRY_PREFIX
    brewpad-integration.js # NEW: createBatchFromSale(), retryPendingBatches()
  routes/
    pos.js                 # add hook after payment chain in sale/confirm

apps-script/
  adminApi.gs              # modify doPost server-token branch + createBatch()

js/
  modules/                 # brewpad.js is NOT in modules/ — it's standalone
  brewpad.js               # STATUS_LABELS, STATUS_COLORS, filter bar, list row, detail view
```

Note: `js/brewpad.js` is a standalone file (4135 lines), not concatenated via the module build. Changes to it require `npm run build` only if any module imports are affected — but since brewpad.js is self-contained, a direct edit is safe. [VERIFIED: CLAUDE.md rule 8 says never edit main.js — brewpad.js is not main.js]

### Pattern 1: Fire-and-Forget Apps Script Call (existing pattern)

**What:** Middleware sends POST to Apps Script URL with `server_token` + `action`. Does not block the HTTP response.
**When to use:** Any middleware side effect that must not delay the sale confirmation response.
**Example (from `notifyAdminPanel` in `checkout-helpers.js`):**
```javascript
// Source: zoho-middleware/lib/checkout-helpers.js line 85-118
function notifyAdminPanel(...) {
  var url = process.env.APPS_SCRIPT_URL;
  var token = process.env.APPS_SCRIPT_SERVER_TOKEN;
  if (!url || !token) return; // not configured — skip silently

  var payload = { action: 'add_reservation', server_token: token, ... };

  axios.post(url, JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    timeout: 12000,
    maxRedirects: 5
  }).then(function (resp) {
    // log success
  }).catch(function (err) {
    // log failure — non-fatal
  });
}
```

For batch creation, the `.catch` branch must additionally write to the Redis retry queue instead of just logging.

### Pattern 2: Redis Retry Queue (new pattern, based on existing `collect:pending:` usage)

**What:** On Apps Script call failure, serialize the batch creation payload to Redis with a TTL. A background worker (or on-boot check) retries pending items.
**Redis key structure (Claude's discretion):**
```
brewpad:pending-batch:<timestamp>-<invoiceNumber>
TTL: 86400 (24 hours) — gives staff time to notice and retry
```

**Retry mechanism options:**

| Approach | Complexity | Reliability |
|----------|------------|-------------|
| On-server-startup sweep (check Redis for pending keys at boot) | Low | Handles server restarts; misses failures between restarts |
| Periodic setInterval in server.js (every 5 min) | Medium | Catches failures within ~5 min; must be idempotent |
| Manual retry endpoint (staff-triggered) | Low | Zero background complexity; requires staff action |

**Recommendation (Claude's discretion):** Periodic sweep using `setInterval` at 5-minute intervals. Apps Script `createBatch` is idempotent-safe because it uses a script lock and generates a new `batch_id` each call — no deduplication risk from retrying. Limit to 3 max attempts per item; after 3 failures log an error and leave the record for manual inspection.

The `collect:pending:` prefix in constants.js is an example of the existing retry-record pattern. [VERIFIED: zoho-middleware/lib/constants.js lines 44-46]

### Pattern 3: Apps Script Server-Token Branch Extension

**What:** The `doPost` server-token branch currently handles only `add_reservation`. Adding `create_batch` follows the same structure.
**Example (from `adminApi.gs` lines 191-200):**
```javascript
// Source: apps-script/adminApi.gs line 191
if (payload.server_token) {
  // token validation ...
  if (action === 'add_reservation') {
    return _jsonResponse(addReservation(payload));
  }
  // ADD:
  if (action === 'create_batch') {
    var r = createBatch(payload, 'kiosk-middleware');
    _invalidateBatchCache(r.batch_id || '');
    return _jsonResponse(r);
  }
  return _jsonResponse({ ok: false, error: 'invalid_action', ... });
}
```

Note that `createBatch` is called with a synthetic `userEmail` argument (`'kiosk-middleware'`) since there is no OAuth session in a server-to-server call. This is consistent with how other server writes work. [VERIFIED: adminApi.gs lines 191-200 read directly]

### Pattern 4: createBatch Pending Mode

**What:** Make `schedule_id` and `start_date` optional. When absent, write `status = 'pending'` and skip schedule snapshot / task creation.

Current required fields (line 1643):
```javascript
if (!payload.product_sku || !payload.customer_name || !payload.start_date || !payload.schedule_id) {
  return { ok: false, error: 'missing_fields', ... };
}
```

New required fields for pending mode:
```javascript
// product_sku and customer_name always required
// start_date and schedule_id optional (pending batch if omitted)
var isPending = !payload.schedule_id || !payload.start_date;
```

When `isPending === true`:
- Skip `findRowById(FERM_SCHEDULES_SHEET_NAME, payload.schedule_id)` validation
- Set `status = 'pending'` in the appended row (currently no status field — this is a new column)
- Skip task creation loop (no schedule steps to generate)
- Skip vessel placement recording (no vessel assigned yet)

### Pattern 5: Batches Sheet Column Additions

The Batches sheet uses `sheetToObjects` which reads column headers from row 1 and maps them to object keys. New columns must be appended at the end of the sheet to avoid breaking existing row reads. [VERIFIED: adminApi.gs line 1142-1152 — `sheetToObjects` reads `data[0]` as headers dynamically]

**New columns to append to Batches sheet:**

| Column name | Values | Notes |
|-------------|--------|-------|
| `status` | `pending`, `primary`, `secondary`, `complete`, `packaging`, `active` | Currently no status column exists in `appendRow` — needs to be added |
| `source` | `manual`, `kiosk` | New column for D-10 |
| `zoho_so_number` | Invoice/SO number string or empty | D-12; named `zoho_so_number` to align with field the frontend will read |

**Current `appendRow` call in `createBatch` writes 19 columns (lines 1681-1701).** The new columns are appended as positions 20, 21, 22. `updateBatch` must be verified to handle these gracefully (it uses `findRowById` + dynamic header lookup, so it is safe as long as the sheet header row is updated).

**Critical:** The Batches sheet header row must be manually updated in Google Sheets (add three new column headers at the end: `status`, `source`, `zoho_so_number`) before deploying the Apps Script changes. Otherwise `sheetToObjects` will not map the new columns. [VERIFIED: adminApi.gs sheetToObjects reads headers from row 1]

### Pattern 6: BrewPad Badge and Status Rendering

**What:** Add `pending` to `STATUS_LABELS` and `STATUS_COLORS`, add a "Pending" filter button, and add "Kiosk" badge in list rows.

Current state (line 968-969):
```javascript
var STATUS_LABELS = { primary: 'Primary', secondary: 'Secondary', complete: 'Complete', active: 'Active', packaging: 'Packaging' };
var STATUS_COLORS = { primary: 'info', secondary: 'warning', complete: 'success', active: 'info', packaging: 'warning' };
```

Add:
```javascript
STATUS_LABELS.pending = 'Pending';
STATUS_COLORS.pending = 'warning'; // or a neutral color — Claude's discretion
```

**Filter bar** (line 1004-1009): add `{ val: 'pending', label: 'Pending' }` to `filterOpts`.

**List row Kiosk badge** — inside the list row render loop (lines 1128-1149 for table view, 1158-1188 for card view), after the status badge:
```javascript
if (b.source === 'kiosk' && statusKey === 'pending') {
  resultsHtml += '<span class="bp-kiosk-badge">Kiosk</span>';
}
```

**Detail view SO number** — in `renderBatchDetail` info grid (line 1539), add:
```javascript
if (b.zoho_so_number) {
  html += '<div class="bp-detail-info-row"><span class="bp-detail-info-label">Zoho Ref</span><span>' + escapeHTML(b.zoho_so_number) + '</span></div>';
}
```

### Anti-Patterns to Avoid

- **Blocking the sale response on batch creation:** The batch creation call must fire-and-forget. Do not `await` it or chain it before `res.status(201).json(result)`.
- **Editing `js/main.js` directly:** All JS edits must go in source files. `js/brewpad.js` is standalone (not a module), so it is edited directly and then `npm run build` is run.
- **Hardcoding Maker's Fee SKU as a string literal:** Use `findMakersFeeItem` from `checkout-helpers.js` — it already handles `MAKERS_FEE_ITEM_ID` env var + SKU + name fallback logic. Do not duplicate this detection logic.
- **Storing customer email in the batch:** D-09 prohibits this. Only `customer_name` and `customer_id` go into the batch.
- **Writing to Batches sheet in a new column position that shifts existing columns:** Always append to the end. The sheet uses positional `appendRow` — inserting columns in the middle breaks existing row writes.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Maker's Fee detection | Custom string matcher | `findMakersFeeItem` in `checkout-helpers.js` | Already handles 3 fallback strategies (item_id, SKU, name); tested in checkout.test.js |
| Apps Script HTTP call | Custom fetch wrapper | `axios.post` (already in checkout-helpers) | Timeout + redirect handling already set up |
| Redis write for retry | Custom persistence | `cache.set` from `lib/cache.js` | JSON serialization + TTL already handled |
| Sheet header parsing | Manual column indexing | `sheetToObjects` | Reads headers dynamically — won't break on column reorder |
| Batch ID generation | Custom ID format | `generateNextId(BATCHES_SHEET_NAME, 'SV-B-', 6)` | Already handles locking + sequential generation |

---

## Common Pitfalls

### Pitfall 1: `sale/confirm` Only — Not the Helcim Terminal Path

**What goes wrong:** The batch creation hook is placed in `sale/confirm` (manual confirm path), but there is also a `salesorder-pay` path (Helcim terminal flow with SO-based checkout). If that path also sells kits with Maker's Fee, batches won't auto-create.

**Why it happens:** There are two separate checkout flows on the kiosk — the quick "manual confirm" flow (`sale/confirm`) and the "Sales Order" flow (`salesorder-pay`). The CONTEXT.md decision D-01 specifically names `sale/confirm` as the trigger.

**How to avoid:** The CONTEXT.md is explicit: scope this to `sale/confirm` only. The `salesorder-pay` flow can be addressed in a future phase if needed. Do not add the hook to `salesorder-pay` in this phase.

**Warning signs:** If the kiosk is configured with Helcim terminal enabled and staff are using the SO-based checkout, auto-batch creation will be silently absent for those sales. That is acceptable per the locked decision.

### Pitfall 2: Batches Sheet Column Shift

**What goes wrong:** Adding `status`, `source`, `zoho_so_number` columns in the middle of the sheet — or worse, inserting them at positions that shift `appendRow` values — causes all existing batch data to be misread.

**Why it happens:** `sheetToObjects` reads headers from row 1 and maps by column name (safe for reads), but `appendRow` writes by position (unsafe if positions shift).

**How to avoid:** Always add new columns at the end of the sheet (columns 20, 21, 22). Update `createBatch`'s `appendRow` call to append 3 more values at the end. Existing `updateBatch` calls that use `findRowById` + dynamic header lookup are safe.

**Warning signs:** After deploying, existing batch reads show misaligned data (e.g., `vessel_id` appears in the `notes` field).

### Pitfall 3: Apps Script `create_batch` Not in Server-Token Branch

**What goes wrong:** The `create_batch` action is added to the Staff OAuth switch block but not to the server-token block. Middleware call returns 401 Unauthorized.

**Why it happens:** `doPost` has two separate auth paths: batch-token, server-token, and staff-OAuth. The staff-OAuth switch already handles `create_batch` (line 226). Adding to the wrong branch.

**How to avoid:** Add `create_batch` to the server-token `if` block (lines 191-202), before the staff-OAuth `switch`. Use `'kiosk-middleware'` as the synthetic user email passed to `createBatch`.

**Warning signs:** Middleware logs show `401 unauthorized` or `invalid_action` from Apps Script on every sale.

### Pitfall 4: `schedule_id` Validation Runs Before Pending Check

**What goes wrong:** `createBatch` validates `schedule_id` exists in `FermSchedules` sheet on line 1648 before the pending-mode bypass. If `schedule_id` is empty, this will fail with `not_found`.

**Why it happens:** Current validation is a single guard at the top — no concept of optional fields.

**How to avoid:** Restructure validation: require `product_sku` and `customer_name` always; only validate `schedule_id` when it is present (non-empty). Skip the `findRowById(FERM_SCHEDULES_SHEET_NAME, ...)` call when `!payload.schedule_id`.

### Pitfall 5: `getBatches` Status Filter Excludes "pending"

**What goes wrong:** BrewPad calls `get_batches` with `status: 'all'` (confirmed at line 662). The `active` filter in `getBatches` explicitly maps active → `primary | secondary`. A `status: 'active'` filter would exclude pending batches. This is correct behavior, but if a future caller uses `status: 'active'`, pending batches won't appear.

**How to avoid:** Brewpad already uses `status: 'all'` for its main fetch, so pending batches will be returned. No change needed on the Apps Script filter logic. Just ensure the BrewPad filter bar's "Active" button maps to the `active` value (which the server already interprets as `primary | secondary`), not to `all`.

### Pitfall 6: `sale/confirm` Has No `customer_name` in Body

**What goes wrong:** D-08 says pull customer info from the Zoho sales order — but `sale/confirm` does not always have a named customer. If `body.contact_id` is absent (walk-in sale), the Zoho invoice is created against the generic `KIOSK_CONTACT_ID` and the customer name is unavailable in the handler.

**Why it happens:** `sale/confirm` is the lightweight "manual confirm" path that skips SO creation. There is no Zoho customer lookup step before invoice creation.

**How to handle:** The batch creation payload should include `customer_name: body.customer_name || ''` (passed optionally by the kiosk UI if the customer typed their name) and `customer_id: body.contact_id || ''`. If neither is available, create the batch with `customer_name: 'Walk-in Customer'` as a placeholder — staff can update it when assigning the schedule. This is the most pragmatic approach given D-03 (one batch per kit line item, not per named customer).

**Warning signs:** Batches appearing in BrewPad with blank customer names.

---

## Code Examples

### How `notifyAdminPanel` calls Apps Script (the pattern to mirror)

```javascript
// Source: zoho-middleware/lib/checkout-helpers.js lines 85-118
function notifyAdminPanel(soNumber, customerName, ...) {
  var url = process.env.APPS_SCRIPT_URL;
  var token = process.env.APPS_SCRIPT_SERVER_TOKEN;
  if (!url || !token) return;

  axios.post(url, JSON.stringify({
    action: 'add_reservation',
    server_token: token,
    customer_name: customerName || '',
    ...
  }), {
    headers: { 'Content-Type': 'application/json' },
    timeout: 12000,
    maxRedirects: 5
  }).then(...).catch(function (err) {
    log.warn('[checkout] Admin panel notification failed (non-fatal): ' + err.message);
  });
}
```

### Where to insert the hook in `sale/confirm`

```javascript
// Source: zoho-middleware/routes/pos.js line 505 — inside paymentChain.then()
return paymentChain.then(function () {
  cache.del(KIOSK_PRODUCTS_CACHE_KEY);
  ledger.decrementStock(lineItems, 'kiosk:' + (invoiceNumber || 'unknown')).catch(function () {});
  eventLog.logEvent('kiosk.sale_completed', { ... });

  // NEW: trigger batch creation for any kit items with Maker's Fee
  createBatchesFromSale(lineItems, invoiceNumber, body.customer_name || '', body.contact_id || '', catalogMap);

  var result = { ok: true, ... };
  res.status(201).json(result);
});
```

### `createBatch` pending mode (key diff)

```javascript
// Source: apps-script/adminApi.gs line 1642 — modified
function createBatch(payload, userEmail) {
  var isPending = !payload.schedule_id || !payload.start_date;

  if (!payload.product_sku || !payload.customer_name) {
    return { ok: false, error: 'missing_fields', message: 'product_sku and customer_name are required' };
  }
  if (!isPending && !payload.schedule_id) {
    return { ok: false, error: 'missing_fields', message: 'schedule_id required when not pending' };
  }
  // ... (validate schedule only if !isPending)

  batchesSheet.appendRow([
    batchId,
    isPending ? 'pending' : 'primary',  // NEW: status column (position 2 → stays 'primary' for non-pending)
    sanitizeInput(payload.product_sku),
    // ... existing columns ...
    sanitizeInput(payload.zoho_so_number || ''),  // NEW: position 20
    sanitizeInput(payload.source || 'manual'),    // NEW: position 21
    // note: column order matters — append at end
  ]);
  // Skip task creation when isPending
}
```

### BrewPad status + kiosk badge

```javascript
// Source: js/brewpad.js line 968 — modified
var STATUS_LABELS = {
  primary: 'Primary', secondary: 'Secondary', complete: 'Complete',
  active: 'Active', packaging: 'Packaging',
  pending: 'Pending'  // NEW
};
var STATUS_COLORS = {
  primary: 'info', secondary: 'warning', complete: 'success',
  active: 'info', packaging: 'warning',
  pending: 'neutral'  // NEW — use existing neutral/muted CSS class
};

// In list row render loop (both table and card views):
if (b.source === 'kiosk' && statusKey === 'pending') {
  resultsHtml += '<span class="bp-kiosk-badge">Kiosk</span>';
}

// In detail view info grid (renderBatchDetail):
if (b.zoho_so_number) {
  html += '<div class="bp-detail-info-row">'
       +  '<span class="bp-detail-info-label">Zoho Ref</span>'
       +  '<span>' + escapeHTML(b.zoho_so_number) + '</span>'
       +  '</div>';
}
```

---

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| Manual batch entry after every kiosk sale | Auto-created pending batch with pre-filled data | This phase introduces the auto-create |
| No `status` column in Batches sheet | New `status` column (pending/primary/secondary/etc.) | Currently status is implicit from fermentation schedule |
| `createBatch` requires schedule_id + start_date | Pending mode: those fields become optional | D-05 |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `sale/confirm` body always contains `body.items` with names matching `lineItems` built from catalog | Pitfall 6 / Code Examples | If product name is blank, batch `product_name` will be blank — staff will need to update |
| A2 | Batches sheet currently has 19 columns matching the 19-value `appendRow` call | Pitfall 2 | If sheet has drifted from code, appending new columns at position 20+ may land wrong |
| A3 | The `APPS_SCRIPT_URL` and `APPS_SCRIPT_SERVER_TOKEN` env vars are set on Railway (not just local) | Standard Stack | Batch creation will silently no-op on production if vars are missing — same failure mode as `notifyAdminPanel` |
| A4 | `bp-status-badge--neutral` CSS class exists in BrewPad stylesheet for the "Pending" color | Code Examples | May need to use `bp-status-badge--warning` or add a new class |

---

## Open Questions

1. **What CSS class to use for the "Pending" badge color in BrewPad?**
   - What we know: `bp-status-badge--info`, `--warning`, `--success` exist (verified by STATUS_COLORS map); no `--neutral` seen
   - What's unclear: Whether a neutral/grey variant exists in the CSS
   - Recommendation: Use `--warning` (amber) for Pending — it communicates "needs attention" to staff, consistent with the Secondary fermentation stage color

2. **Should `createBatchFromSale` be a new standalone lib module or inline in pos.js?**
   - What we know: `notifyAdminPanel` lives in `checkout-helpers.js` (not inline in `checkout.js`); the retry logic adds meaningful complexity
   - Recommendation: Extract to `zoho-middleware/lib/brewpad-integration.js` — keeps pos.js clean and makes the retry sweep testable

3. **Does `salesorder-pay` also need a batch creation hook?**
   - What we know: CONTEXT.md D-01 explicitly names only `sale/confirm`; the SO-based payment path is a separate flow
   - Recommendation: Explicitly out of scope for this phase; add a comment in pos.js near `salesorder-pay` noting this as a future todo

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `APPS_SCRIPT_URL` env var | Apps Script batch creation call | [ASSUMED] Set on Railway | — | Silent skip (same as `notifyAdminPanel`) |
| `APPS_SCRIPT_SERVER_TOKEN` env var | Server-token auth in Apps Script | [ASSUMED] Set on Railway | — | Silent skip |
| Redis | Retry queue storage | Confirmed present | — | `cache.set` no-ops gracefully if Redis down |
| Google Sheets Batches tab | Batch persistence | [ASSUMED] Exists with current 19 columns | — | Apps Script returns `sheet_not_found` error |

---

## Security Domain

`security_enforcement: true`, `security_asvs_level: 1`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Batch creation is a server-to-server call; no user auth involved |
| V3 Session Management | No | No session created by this flow |
| V4 Access Control | Yes | `APPS_SCRIPT_SERVER_TOKEN` must be validated in `doPost` — existing pattern already does this |
| V5 Input Validation | Yes | All fields from sale body (`customer_name`, `product_name`, `invoiceNumber`) must be sanitized via `sanitizeInput` before writing to Sheets |
| V6 Cryptography | No | Token is passed as-is; no new crypto needed |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Server token replay / leak | Elevation of Privilege | Token validated by exact string match in Apps Script; token never returned to client; stored as Railway env var |
| Sheet injection (formula injection via customer name) | Tampering | `sanitizeInput` in Apps Script strips leading `=`, `+`, `-`, `@` chars from cell values — existing function |
| PII in batch: customer email | Information Disclosure | D-09 prohibits email storage; only `customer_name` + `customer_id` stored |
| Redis retry queue data exposure | Information Disclosure | Retry queue values contain `customer_name` and `invoice_number`; set TTL to 24h max; no email in payload |
| Retry amplification (infinite retries) | Denial of Service | Cap at 3 attempts per pending item; after 3, log error and delete the Redis key |

---

## Sources

### Primary (HIGH confidence)
- `[VERIFIED: zoho-middleware/routes/pos.js]` — Full read of `sale/confirm` handler (lines 393-526); confirmed insertion point after payment chain
- `[VERIFIED: apps-script/adminApi.gs lines 178-250]` — `doPost` server-token branch; confirmed only `add_reservation` currently handled
- `[VERIFIED: apps-script/adminApi.gs lines 1642-1768]` — Full `createBatch` function; confirmed required fields and `appendRow` positions
- `[VERIFIED: apps-script/adminApi.gs lines 1226-1282]` — `getBatches` and `sheetToObjects` — header-based mapping confirmed safe for new columns
- `[VERIFIED: js/brewpad.js lines 968-969, 1004-1014, 1124-1188, 1504-1582]` — STATUS_LABELS, STATUS_COLORS, filter bar, list render loops, detail view
- `[VERIFIED: zoho-middleware/lib/checkout-helpers.js lines 85-118, 160-171]` — `notifyAdminPanel` pattern + `findMakersFeeItem` — exact pattern to mirror
- `[VERIFIED: zoho-middleware/lib/cache.js]` — Full cache module API; `set(key, value, ttlSeconds)` pattern confirmed
- `[VERIFIED: zoho-middleware/lib/constants.js]` — All existing Redis key prefixes; no `brewpad:` prefix yet
- `[VERIFIED: CLAUDE.md]` — Tech stack rules; brewpad.js is not a build module

### Secondary (MEDIUM confidence)
- `[ASSUMED]` — Apps Script `sanitizeInput` strips formula injection characters — needs confirmation it exists as a shared helper in `adminApi.gs`

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all existing packages verified present
- Architecture: HIGH — all insertion points confirmed by direct code reads
- Pitfalls: HIGH — all pitfalls derived from actual code patterns read
- Apps Script pending-mode design: HIGH — `createBatch` logic read in full

**Research date:** 2026-05-03
**Valid until:** 2026-06-03 (stable codebase; no fast-moving external deps)
