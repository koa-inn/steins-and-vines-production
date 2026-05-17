# Phase 14: Kiosk Recipe Sales, Inventory, and Batch Creation - Research

**Researched:** 2026-05-17
**Domain:** Kiosk POS extension — recipe sale flow, Redis mutex, Zoho invoice, batch auto-creation
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Dedicated "Recipes" tab on the kiosk alongside the existing Products and Sales Orders tabs. Recipe cards show name, style, ABV, and locked price. One tap selects and populates the cart with all ingredient line items plus applicable fees.
- **D-02:** After selecting a recipe, staff is prompted to choose "Ferment in Store" or "Take Out" before proceeding to payment. Ferment in-store adds brewing fee + materials fee and auto-creates a batch. Take-out adds no fees by default, optional milling fee, and creates no batch.
- **D-03:** Milling fee for take-out uses the existing Zoho service item (already in Railway env vars). Staff toggles "Mill grain?" before confirming the take-out sale.
- **D-04:** Simple mutex — one recipe sale at a time. Redis lock (~30 sec TTL) on the recipe sale endpoint. If lock fails: "Another recipe sale in progress — try again in a moment."
- **D-05:** Availability check runs before payment using `GET /api/recipes/:id/availability`. If any ingredient is out of stock, block the sale.
- **D-06:** One Zoho invoice line item per ingredient plus one for brewing fee (in-store) or milling fee (take-out, if selected).
- **D-07:** Invoice line items use `item_id` from the recipe's ingredient records. Fees use `MAKERS_FEE_ITEM_ID` / `MATERIALS_FEE_ITEM_ID` env vars (in-store) or the milling fee service item (take-out).
- **D-08:** `locked_price` is the total customer-facing display price on the kiosk, NOT the sum of ingredient costs. Invoice itemizes at ingredient Zoho `rate` values + fee.
- **D-09:** Fire-and-forget batch creation after payment — same async pattern as `brewpad-integration.js`. Staff sees "Sale Complete" immediately.
- **D-10:** `detectRecipeSale()` is a separate function from `detectKitItems()`. Never conflate the two code paths.
- **D-11:** Customer info on the batch comes from existing kiosk customer linkage. No additional staff input.
- **D-12:** If batch creation fails after payment, it fails silently. Staff can create batch manually. No void, no retry (beyond existing retry sweep).
- **D-13:** `BEER_SALES_ENABLED` check happens server-side at the recipe sale confirm endpoint. Returns 403 when false. Kiosk Recipes tab may be visible for testing.

### Claude's Discretion

- **Recipe card design:** Consistent with existing kiosk product cards. Show: name, style, ABV, locked_price, availability status dot.
- **In-store/take-out prompt UI:** Two large buttons, a modal, or inline selection. Fast and clear — staff makes this choice dozens of times a day.
- **Endpoint structure:** Claude decides whether recipe sales use existing `/api/kiosk/sale` with a `type: 'recipe'` flag, or a new dedicated `/api/kiosk/recipe-sale` endpoint.
- **Mutex implementation:** Claude decides Redis key pattern and lock/unlock approach.
- **Error handling:** Claude decides how to handle edge cases. Should follow existing void-on-Zoho-failure pattern.

### Deferred Ideas (OUT OF SCOPE)

- BeerXML import (Phase 15)
- Public recipe browsing (v2.1 PUB-01, PUB-02)
- Ad-hoc recipe builder (v2.1 ADH-01)
- Batch completion auto-adjusts inventory (v2.1 BWF-01)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| KSK-01 | Kiosk has a recipe browser tab where staff can browse and select active recipes | Admin.js tab injection pattern + `GET /api/recipes?status=active` from Phase 13 |
| KSK-02 | Selecting a recipe auto-populates the kiosk cart with all ingredient line items plus the brewing fee | `callAppsScriptPost('get_recipe', {recipe_id})` returns ingredients with item_ids; cart filled from those |
| KSK-03 | Recipe sale processes through existing Helcim terminal flow and creates a Zoho invoice with per-ingredient line items | `helcimLib.terminalPurchase` → poll → `/invoices` POST pattern mirrors `pos.js` confirm flow |
| KSK-04 | Kiosk recipe sale endpoint rejects requests when `BEER_SALES_ENABLED` is false | `process.env.BEER_SALES_ENABLED` already in validateEnv.js optional list; guard at endpoint top |
| BAT-01 | Recipe sale on kiosk auto-creates exactly one batch in BrewPad linked to the recipe and customer | `detectRecipeSale()` sends one Apps Script `create_batch` call with `recipe_id`, `recipe_snapshot`, `zoho_so_number` |
| BAT-02 | Batch creation uses a separate code path from kit batch detection (not `detectKitItems`) | New `detectRecipeSale()` function; `createBatchesFromSale` only called for kit sales |
| BAT-03 | Auto-created recipe batch stores recipe_id, recipe_snapshot, and Zoho SO number | Apps Script `handleCreateBatch` already writes `recipe_id` / `recipe_snapshot` columns by header lookup (Phase 12) |
| INV-01 | Recipe sale deducts each ingredient individually from Zoho Inventory via invoice line items | Zoho auto-deducts inventory when invoice is submitted; per-ingredient line items trigger per-SKU deduction |
| INV-02 | Pre-sale ingredient reservation via Redis prevents race conditions | `cache.acquireLock('recipe-sale', 30)` before payment push; `cache.releaseLock` on completion or failure |
| INV-03 | Failed or cancelled payment releases reserved ingredient quantities | `releaseLock` in `.catch()` and terminal-declined path before returning error |
</phase_requirements>

---

## Summary

Phase 14 extends the existing kiosk POS with recipe selling capability. The kiosk (`js/admin.js`) gains a "Recipes" sub-tab within the kiosk view, and the middleware gains a new `/api/kiosk/recipe-sale` endpoint pair (initiate + confirm). The flow mirrors the existing product sale flow in `routes/pos.js` but branches at two points: (1) availability check against the ingredient catalog before payment, and (2) post-payment batch creation via a separate `detectRecipeSale()` function in `brewpad-integration.js`.

The core data chain is well established: recipe ingredients with `item_id` values exist in Apps Script (Phase 12), the availability endpoint exists in `routes/recipes.js` (Phase 13), the `create_batch` Apps Script action already writes `recipe_id` and `recipe_snapshot` columns (Phase 12), and the Redis `acquireLock`/`releaseLock` API already exists in `cache.js`. No new infrastructure is needed — this phase is wiring.

The main design decisions for Claude are: (a) a dedicated `/api/kiosk/recipe-sale` endpoint (not overloading the existing sale endpoint), (b) two large tap buttons for the in-store/take-out prompt placed inline after recipe card tap (no modal, avoids nested scroll issues on iPad), and (c) the Redis mutex key `recipe-sale` using the existing `cache.acquireLock(key, ttlSeconds)` API.

**Primary recommendation:** New `/api/kiosk/recipe-sale` + `/api/kiosk/recipe-sale/confirm` endpoints that follow the exact same two-step pattern (initiate → terminal push → confirm → invoice) as the existing kiosk sale, with the availability check and mutex guard inserted before the terminal push.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Recipe browser UI (tab, cards, selection) | Admin frontend (admin.js) | — | Display logic only; data fetched from middleware |
| In-store/take-out prompt | Admin frontend (admin.js) | — | UX choice; result sent as `sale_type` in request body |
| Availability check before payment | API/Middleware | — | Must be server-side; client availability state can be stale |
| Redis mutex acquisition | API/Middleware | — | Server-side only; client cannot hold distributed locks |
| Helcim terminal payment | API/Middleware + Helcim terminal | — | Terminal is physical; middleware is the integration point |
| Zoho invoice creation (per-ingredient) | API/Middleware → Zoho Books | — | Zoho is authoritative for financial records |
| Inventory deduction | Zoho Inventory (auto) | — | Triggered by Zoho invoice submit; no separate API call needed |
| Batch auto-creation | API/Middleware → Apps Script | — | Fire-and-forget after payment; same pattern as kit batches |
| Feature gate enforcement | API/Middleware | — | Must be server-side (D-13); client-side hiding is UX only |

---

## Standard Stack

### Core (all already in project — no new packages required)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | existing | Route handler for new endpoints | Already in use |
| axios | existing | Apps Script proxy calls | Already in `routes/recipes.js` |
| redis (node-redis) | existing | Mutex via `cache.acquireLock` | Already in `cache.js` |
| helcimLib | existing | Terminal push + poll | Already in `routes/pos.js` |
| zoho-api | existing | Invoice POST | Already in `routes/pos.js` |
| cache | existing | Redis get/set/lock | Already in `lib/cache.js` |
| brewpad-integration | existing | Batch creation + retry queue | Already in `lib/brewpad-integration.js` |

[VERIFIED: codebase grep] No new npm packages needed for Phase 14.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| eventLog | existing | `logEvent('kiosk.recipe_sale_completed', ...)` | After successful sale confirm |
| log (logger) | existing | Structured logging | Throughout route handlers |
| C (constants) | existing | `C.CACHE_KEYS.RECIPES`, lock key naming | Everywhere cache keys are used |

**Installation:** None required. All dependencies are already installed.

---

## Architecture Patterns

### System Architecture Diagram

```
Staff tap "Recipes" tab
        |
        v
[admin.js] GET /api/recipes?status=active
        |
        v
[recipes.js] → Redis cache hit OR Apps Script get_recipes
        |
        v
[admin.js] Render recipe cards (name, style, ABV, locked_price, avail dot)
        |
        v
Staff taps recipe card
        |
        v
[admin.js] Inline prompt: [Ferment in Store] [Take Out]
        |
        +-- Ferment in Store --+-- Take Out
        |                     |
        |                     +-- Toggle "Mill grain?" 
        |
        v
[admin.js] GET /api/recipes/:id/availability  (pre-check)
        |
        +-- any_out → block with message
        |
        v
[admin.js] POST /api/kiosk/recipe-sale  (terminal push)
        |
        v
[pos-recipe.js] acquireLock('recipe-sale', 30)
        |
        +-- lock fail → 503 "Another sale in progress"
        |
        v
helcimLib.terminalPurchase(total, refNumber)
        |-- 202 pending
        v
[admin.js] poll GET /api/kiosk/sale/status?ref=...  (existing endpoint, reused)
        |
        +-- declined/cancelled → releaseLock → 402
        |
        v
[admin.js] POST /api/kiosk/recipe-sale/confirm  (invoice + batch)
        |
        v
[pos-recipe.js] re-check BEER_SALES_ENABLED
        |
        v
GET /api/recipes/:id (for ingredient snapshot, from cache or Apps Script)
        |
        v
POST Zoho /invoices (per-ingredient line items + fee line)
        |
        +-- Zoho fail → voidTransaction → releaseLock → 502
        |
        v
POST Zoho /invoices/:id/submit  (triggers inventory deduction)
        |
        v
POST Zoho /customerpayments  (mark invoice paid)
        |
        v
cache.del(KIOSK_PRODUCTS_CACHE_KEY)  (bust kiosk product stock)
cache.del(C.CACHE_KEYS.INGREDIENTS)  (bust ingredient stock cache)
releaseLock('recipe-sale')
        |
        v
detectRecipeSale() → callAppsScriptCreateBatch(...)  [fire-and-forget]
        |
        v
[admin.js] Show receipt view → Done
```

### Recommended File Structure

```
zoho-middleware/
  routes/
    pos.js                     (existing — unchanged)
    recipes.js                 (existing — unchanged)
    pos-recipe.js              (NEW — recipe sale initiate + confirm)
  lib/
    brewpad-integration.js     (MODIFIED — add detectRecipeSale, createRecipeBatch)
    constants.js               (MODIFIED — add RECIPE_SALE_LOCK key, RECIPE_SALE cache key)
  __tests__/
    pos-recipe.test.js         (NEW — unit tests for new endpoints)
    brewpad-recipe.test.js     (NEW — unit tests for detectRecipeSale)

js/admin.js                    (MODIFIED — add kiosk recipes sub-tab, card render, prompt)
admin.html                     (MODIFIED — add recipe browser HTML inside kiosk-view-browse)
```

### Pattern 1: New Dedicated Recipe Sale Route

**What:** Separate `routes/pos-recipe.js` (not modifying `pos.js`) keeps recipe sale concerns isolated. Mounted in `server.js` alongside existing routes.

**When to use:** When adding a new sale type that shares terminal infrastructure but has distinct validation and post-sale logic.

**Example — endpoint skeleton:**
```javascript
// Source: [VERIFIED: routes/pos.js pattern]
'use strict';
var express = require('express');
var helcimLib = require('../lib/helcim');
var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var eventLog = require('../lib/eventLog');
var C = require('../lib/constants');
var brewpadIntegration = require('../lib/brewpad-integration');

var router = express.Router();

router.post('/api/kiosk/recipe-sale', function (req, res) {
  // 1. Check BEER_SALES_ENABLED
  if ((process.env.BEER_SALES_ENABLED || 'false').toLowerCase() !== 'true') {
    return res.status(403).json({ error: 'Recipe sales are not enabled' });
  }
  // 2. Check terminal
  if (!helcimLib.isTerminalEnabled()) {
    return res.status(503).json({ error: 'POS terminal not configured' });
  }
  // 3. Acquire mutex
  cache.acquireLock(C.LOCK_KEYS.RECIPE_SALE, 30).then(function (acquired) {
    if (!acquired) {
      return res.status(503).json({ error: 'Another recipe sale in progress — try again in a moment.' });
    }
    // 4. Push to terminal (amount comes from server-computed total)
    var refNumber = 'RECIPE-' + Date.now();
    helcimLib.terminalPurchase(body.total, refNumber)
      .then(function () {
        res.status(202).json({ pending: true, reference: refNumber });
      })
      .catch(function (err) {
        cache.releaseLock(C.LOCK_KEYS.RECIPE_SALE);
        res.status(502).json({ error: 'Terminal error — please try again' });
      });
  });
});
```

### Pattern 2: detectRecipeSale() in brewpad-integration.js

**What:** New function alongside `detectKitItems()`. Receives recipe metadata from confirm endpoint, fires one `callAppsScriptCreateBatch` call with `recipe_id` and `recipe_snapshot`. Does NOT inspect line items for fee detection — recipe type is passed explicitly.

**When to use:** After `/api/kiosk/recipe-sale/confirm` succeeds, only when `sale_type === 'in-store'`.

**Example:**
```javascript
// Source: [VERIFIED: brewpad-integration.js createBatchesFromSale pattern]
function detectRecipeSale(recipeId, recipeSnapshot, invoiceNumber, customerName, contactId) {
  if (!recipeId) return;
  var nameParts = splitCustomerName(customerName);
  var batchPayload = {
    product_sku: recipeId,
    product_name: recipeSnapshot.name || recipeId,
    customer_name: customerName || 'Walk-in Customer',
    customer_firstname: nameParts.first || 'Walk-in',
    customer_lastname: nameParts.last || 'Customer',
    customer_id: contactId || '',
    source: 'kiosk_recipe',
    zoho_so_number: invoiceNumber || '',
    recipe_id: recipeId,
    recipe_snapshot: JSON.stringify(recipeSnapshot)
  };
  callAppsScriptCreateBatch(batchPayload).catch(function () {});
}
```

### Pattern 3: Kiosk Recipes Sub-Tab in admin.js

**What:** The kiosk view's browse area gains a mode toggle. The existing product grid becomes one mode; the recipe browser becomes a second mode. Toggle buttons sit above the product/recipe pane. State tracked by `_kioskMode` variable (`'products'` | `'recipes'`).

**When to use:** When the kiosk browse view needs to display a different data source without changing the cart or checkout flow.

**Pattern (IIFE extension, consistent with kiosk/recipes IIFE style):**
```javascript
// Source: [VERIFIED: admin.js lines 8693-9579 kiosk IIFE pattern]
var _kioskMode = 'products'; // 'products' | 'recipes'
var _kioskRecipes = [];
var _kioskSelectedRecipe = null;
var _kioskSaleType = null;   // 'in-store' | 'take-out'
var _kioskMillGrain = false;

function kioskSetMode(mode) {
  _kioskMode = mode;
  var prodGrid = document.getElementById('kiosk-product-grid');
  var recipeGrid = document.getElementById('kiosk-recipe-grid');
  if (prodGrid) prodGrid.style.display = mode === 'products' ? '' : 'none';
  if (recipeGrid) recipeGrid.style.display = mode === 'recipes' ? '' : 'none';
}
```

### Pattern 4: In-Store / Take-Out Inline Prompt

**What:** After recipe card tap, the recipe grid is replaced by a two-button choice + sale type summary. "Back to Recipes" returns to grid without any state change to cart.

**Recommended over modal:** The kiosk is used on an iPad. Modals with nested scroll areas cause iOS soft-keyboard issues (same reason `kiosk-view--customer-scroll` exists). An inline pane within the browse area avoids this.

**HTML pattern:**
```html
<!-- Inside kiosk-product-pane, toggled by JS -->
<div id="kiosk-recipe-prompt" style="display:none;">
  <button id="kiosk-recipe-back" class="btn-secondary">&#8592; Back</button>
  <div class="kiosk-recipe-selected-name" id="kiosk-recipe-selected-name"></div>
  <div class="kiosk-sale-type-btns">
    <button class="kiosk-sale-type-btn" id="kiosk-btn-in-store">Ferment in Store</button>
    <button class="kiosk-sale-type-btn" id="kiosk-btn-take-out">Take Out</button>
  </div>
  <div id="kiosk-milling-toggle" style="display:none;">
    <label>
      <input type="checkbox" id="kiosk-mill-grain"> Mill grain?
    </label>
  </div>
  <button class="btn kiosk-add-recipe-btn" id="kiosk-add-recipe-to-cart" style="display:none;">
    Add to Cart
  </button>
</div>
```

### Anti-Patterns to Avoid

- **Mutating the existing `/api/kiosk/sale` or `/api/kiosk/sale/confirm`:** Adding a `type: 'recipe'` flag creates branching logic inside an already complex handler. A separate route file is cleaner and independently testable.
- **Calling `createBatchesFromSale()` with recipe line items:** The kit detection relies on `MAKERS_FEE_ITEM_ID` presence. A recipe sale that includes a makers fee line item WOULD trigger kit batch creation, creating a duplicate batch. Use `detectRecipeSale()` exclusively.
- **Client-computed invoice totals:** The confirm endpoint must recompute totals from server-held recipe data (same as `pos.js` catalog price anchoring). Never trust client-supplied rates.
- **Releasing the lock only on success:** The mutex MUST be released in all failure paths (terminal declined, Zoho error, void path) to avoid a 30-second blackout after every failed attempt.
- **Blocking the response to wait for batch creation:** Fire-and-forget is mandatory; Apps Script cold-start can take 5-15 seconds.
- **Letting the kiosk recipe tab fetch `item_ids` from the client:** Ingredient `item_ids` must come from Apps Script via the server (API-02 from Phase 13). The client sends only `recipe_id`; the server resolves ingredients.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Distributed mutual exclusion | Custom in-memory flag | `cache.acquireLock('recipe-sale', 30)` | Already implemented in `cache.js`; handles Redis unavailability with fallback |
| Helcim terminal integration | Any terminal code | `helcimLib.terminalPurchase()` + `helcimLib.pollTerminalResult()` | Terminal flow is tested and handles timeouts |
| Invoice void on failure | Custom Zoho PUT | `helcimLib.voidTransaction(txnId)` | Already implemented; includes `mailer.sendVoidFailureAlert` |
| Batch retry queue | Custom retry loop | `queueForRetry()` in `brewpad-integration.js` | Already implemented; keys on `BATCH_RETRY_PREFIX` |
| Zoho invoice creation | Direct Zoho API | `zohoPost('/invoices', payload)` in `zoho-api.js` | Auth, retry, error handling all handled |

**Key insight:** This phase is 95% wiring existing infrastructure — the terminal, the cache, the batch creation, the invoice flow. The only truly new logic is (a) the server-side recipe price computation, (b) `detectRecipeSale()`, and (c) the kiosk UI sub-tab.

---

## Common Pitfalls

### Pitfall 1: Lock Released Before All Error Paths

**What goes wrong:** Lock is acquired before terminal push but only released in the success path. If the terminal times out or Zoho fails, the lock stays held for the full 30 seconds. All subsequent recipe sale attempts during that window get rejected with "Another sale in progress."

**Why it happens:** Promise chains with multiple `.catch()` branches — easy to miss a release point.

**How to avoid:** Release the lock as the FIRST thing in every `.catch()`, before logging or returning the error response. Pattern:
```javascript
.catch(function (err) {
  cache.releaseLock(C.LOCK_KEYS.RECIPE_SALE).catch(function () {});
  log.error('[recipe-sale/confirm] ...' + err.message);
  res.status(502).json({ error: '...' });
});
```
**Warning signs:** Any catch block that returns an error response without a preceding `releaseLock` call.

### Pitfall 2: Kit Batch Detection Triggers on Recipe Sale

**What goes wrong:** Recipe in-store sale includes `MAKERS_FEE_ITEM_ID` as a line item. The existing `createBatchesFromSale()` call detects the Maker's Fee, runs `detectKitItems()`, finds all non-fee items (the ingredients), and creates one batch PER INGREDIENT. A 10-ingredient recipe creates 10 batches.

**Why it happens:** The confirm handler for the new recipe sale endpoint calls `brewpadIntegration.createBatchesFromSale()` out of habit or copy-paste from `pos.js`.

**How to avoid:** The recipe sale confirm endpoint must NEVER call `createBatchesFromSale()`. It calls the new `detectRecipeSale()` directly. These are separate code paths per D-10.

**Warning signs:** Test for it explicitly — a test that sends a recipe sale with makers fee should result in exactly 1 Apps Script batch call, not N.

### Pitfall 3: Server Recomputes Wrong Total for Terminal

**What goes wrong:** The terminal is pushed a total computed from the `locked_price` (the customer-facing display price), but the invoice is created from ingredient Zoho rates + fee, which may not sum to `locked_price`. The customer is charged one amount, the invoice records another, causing reconciliation problems.

**Why it happens:** D-08 creates two different "totals": the display total (locked_price) and the invoice total (sum of ingredient rates + fee). These are intentionally different.

**How to avoid:** The terminal amount MUST match the amount actually charged and recorded in the invoice. Resolution options:
1. Charge `locked_price` and record a single-line invoice for that amount (defeats per-ingredient deduction).
2. Charge the sum of ingredient Zoho rates + fee, and display that as the "recipe price" (overrides locked_price display).
3. The invoice line items price each ingredient at the rate needed to reach `locked_price` (requires rate adjustment math).

**[ASSUMED]** The intended behavior based on D-08 is that the customer pays `locked_price`, and the invoice line items at their natural Zoho rates may or may not sum to that. The planner must confirm with the user: **"Should the terminal charge the `locked_price`, or the sum of actual ingredient rates + fee?"** This is a pricing design decision with accounting implications.

**Warning signs:** If `locked_price` in the recipe record differs from the sum of ingredient Zoho rates + applicable fee, these amounts will diverge.

### Pitfall 4: Ingredient Cache Busting Scope

**What goes wrong:** After a recipe sale, `KIOSK_PRODUCTS_CACHE_KEY` is busted (products stock refreshes) but `C.CACHE_KEYS.INGREDIENTS` is not. The next availability check for another recipe of the same ingredients still shows the pre-sale stock level, allowing a sale that should be blocked.

**Why it happens:** `pos.js` only busts the kiosk products cache; ingredients cache is separate.

**How to avoid:** The recipe sale confirm handler must bust BOTH `KIOSK_PRODUCTS_CACHE_KEY` and `C.CACHE_KEYS.INGREDIENTS` after successful invoice submit.

**Warning signs:** If a second recipe sale immediately after the first passes the availability check when it should be blocked.

### Pitfall 5: Availability Check Uses Stale Cache

**What goes wrong:** `GET /api/recipes/:id/availability` returns `summary: 'unknown'` when the ingredients catalog cache is cold (existing behavior per Phase 13 design). The client UI treats `unknown` as "might be ok" and allows checkout. Payment succeeds but Zoho invoice fails because an ingredient has zero stock.

**Why it happens:** The availability endpoint intentionally does not block on a Zoho refresh when cache is cold (Phase 13 decision to avoid blocking).

**How to avoid:** The client MUST block checkout when availability summary is `'unknown'` with message "Stock data unavailable — refresh and try again." The `summary: 'cannot_brew'` and `summary: 'unknown'` both block checkout. Only `'all_ok'` or `'some_low'` (with staff acknowledgment) should proceed.

**Warning signs:** Client code that only checks `summary === 'cannot_brew'` — must also block on `'unknown'`.

### Pitfall 6: Milling Fee Item ID Not Configured

**What goes wrong:** Take-out sale with milling fee fails at invoice creation because `MILLING_FEE_ITEM_ID` env var is not set in Railway. The endpoint throws trying to include a null item_id in Zoho.

**Why it happens:** The milling fee is a new env var that doesn't exist yet. `MAKERS_FEE_ITEM_ID` and `MATERIALS_FEE_ITEM_ID` are already registered; the milling fee is not.

**How to avoid:** 
1. Add `MILLING_FEE_ITEM_ID` to `validateEnv.js` optional list.
2. At the confirm endpoint, if `sale_type === 'take-out'` and `mill_grain === true` and `!process.env.MILLING_FEE_ITEM_ID`, return 400 "Milling fee not configured. Contact admin."
3. The Zoho service item ID must be found and added to Railway before take-out milling is usable.

**Warning signs:** Any invoice creation that includes a line item without a valid `item_id`.

---

## Code Examples

### Existing `cache.acquireLock` Signature

```javascript
// Source: [VERIFIED: zoho-middleware/lib/cache.js lines 106-115]
// Acquires Redis SETNX lock. Returns Promise<boolean>.
// Falls back to true (allow) if Redis is unavailable.
cache.acquireLock('recipe-sale', 30)  // key (without 'lock:' prefix), TTL in seconds
  .then(function (acquired) {
    if (!acquired) {
      return res.status(503).json({ error: 'Another recipe sale in progress — try again in a moment.' });
    }
    // proceed
  });

cache.releaseLock('recipe-sale');  // call this on all exit paths
```

### Existing `callAppsScriptCreateBatch` Payload Shape

```javascript
// Source: [VERIFIED: zoho-middleware/lib/brewpad-integration.js lines 160-170]
// The 'create_batch' Apps Script action accepts these fields.
// recipe_id and recipe_snapshot are written to the Batches sheet by column header lookup (Phase 12).
var batchPayload = {
  product_sku: recipeId,
  product_name: recipeName,
  customer_name: 'Full Name',
  customer_firstname: 'First',
  customer_lastname: 'Last',
  customer_id: 'zoho_contact_id',
  source: 'kiosk_recipe',
  zoho_so_number: invoiceNumber,
  recipe_id: recipeId,
  recipe_snapshot: JSON.stringify(snapshotObject)
};
```

### Existing Recipe Detail Response Shape (from Phase 13)

```javascript
// Source: [VERIFIED: zoho-middleware/routes/recipes.js lines 107-129]
// GET /api/recipes/:id returns:
{
  recipe: {
    recipe_id: 'RCP-001',
    name: 'Cascade Pale Ale',
    style: 'American Pale Ale',
    abv: 5.2,
    locked_price: 195.00,
    service_fee: 45.00,
    materials_fee: 5.00,
    status: 'active'
  },
  ingredients: [
    {
      ingredient_id: 'ING-001',
      recipe_id: 'RCP-001',
      item_id: '109900000000041234',  // Zoho item ID
      item_name: 'Pale Malt 2-Row',
      quantity: 5.5,
      unit: 'kg'
    }
  ]
}
```

### Existing Zoho Invoice POST Shape (from pos.js)

```javascript
// Source: [VERIFIED: zoho-middleware/routes/pos.js lines 450-458]
var invoicePayload = {
  date: today,
  reference_number: refNumber,
  payment_terms: 0,
  payment_terms_label: 'Due on Receipt',
  line_items: lineItems,  // each has item_id, name, quantity, rate, tax_id
  notes: 'Kiosk recipe sale (in-store). Recipe: ' + recipeId + '. Ref: ' + refNumber,
  custom_fields: [],
  customer_id: contactId || process.env.KIOSK_CONTACT_ID || ''
};
```

### Kiosk IIFE Tab Extension Pattern

```javascript
// Source: [VERIFIED: admin.js lines 9549-9573 — _kioskOrigInitTabNav pattern]
// New code hooks into tab navigation using the same monkey-patch pattern.
var _kioskOrigInitTabNav2 = initTabNavigation;
initTabNavigation = function () {
  _kioskOrigInitTabNav2();
  // ... add listeners
};
// NOTE: The recipes IIFE already hooks initTabNavigation (lines 8036-8046).
// The kiosk IIFE hooks it again (lines 9549-9573).
// A third hook for recipe-mode within kiosk must also chain correctly.
// Best practice: check if already initialized before re-hooking.
```

---

## Open Questions

1. **Terminal charge amount vs locked_price discrepancy (Pitfall 3)**
   - What we know: `locked_price` is the customer-facing display price; invoice line items use Zoho ingredient rates + fee which may not sum to `locked_price`.
   - What's unclear: Which amount should the Helcim terminal charge? If `locked_price` differs from the sum of ingredient rates + fee, the invoice and terminal amounts diverge.
   - Recommendation: Planner must confirm with user before implementation. Most likely intent: charge the sum of ingredient Zoho rates + applicable fee (making `locked_price` an approximate "starting from" price for browsing), OR adjust ingredient rates so they sum to `locked_price`. This must be decided before implementing the confirm endpoint.

2. **Milling fee Zoho item ID**
   - What we know: `MAKERS_FEE_ITEM_ID` and `MATERIALS_FEE_ITEM_ID` are in Railway. The milling fee is "the existing Zoho service item" (D-03) but no `MILLING_FEE_ITEM_ID` env var exists yet.
   - What's unclear: Has the Zoho milling fee service item been created? What is its item_id?
   - Recommendation: Add a Wave 0 task to identify and register `MILLING_FEE_ITEM_ID` in Railway. Take-out milling sales are blocked gracefully until configured.

3. **Availability summary 'some_low' handling at checkout**
   - What we know: The availability endpoint returns `'all_ok'`, `'some_low'`, `'cannot_brew'`, or `'unknown'`.
   - What's unclear: Should `'some_low'` block checkout (conservative) or show a warning and allow staff to proceed (practical)?
   - Recommendation: Show a yellow banner "Some ingredients are low stock — this may be the last batch" with a "Proceed anyway" confirmation tap. Blocks on `'cannot_brew'` and `'unknown'` only.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Redis | Mutex lock, cache | Yes (Railway) | node-redis v4 | Lock falls back to true (allows sale) per existing `acquireLock` fallback |
| Helcim terminal | Payment | Yes (Railway `HELCIM_DEVICE_CODE`) | existing | Endpoint returns 503 if not configured |
| BEER_SALES_ENABLED | Feature gate | Yes (validateEnv.js optional) | Railway env | Defaults to false (sales blocked) |
| MAKERS_FEE_ITEM_ID | In-store fee line | Yes (Railway) | existing | 400 if missing and in-store sale attempted |
| MATERIALS_FEE_ITEM_ID | In-store fee line | Yes (Railway) | existing | 400 if missing |
| MILLING_FEE_ITEM_ID | Take-out milling fee | No (not yet in Railway) | — | 400 with clear message if mill_grain=true |
| APPS_SCRIPT_URL | Recipe detail fetch, batch creation | Yes (Railway) | existing | 502 if missing |
| APPS_SCRIPT_SERVER_TOKEN | Recipe detail fetch, batch creation | Yes (Railway) | existing | 502 if missing |

**Missing dependencies with no fallback:**
- `MILLING_FEE_ITEM_ID` — Take-out with milling is blocked until configured. Planner should include a task to find this item ID in Zoho and add it to Railway.

**Missing dependencies with fallback:**
- Redis unavailable → mutex falls back to `true` (lock is granted); single-kiosk reality means this is acceptable.

---

## Security Domain

### Applicable ASVS Categories (Level 1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | New endpoints behind existing `requireApiKey` middleware in server.js |
| V3 Session Management | No | Stateless API; no sessions |
| V4 Access Control | Yes | `BEER_SALES_ENABLED` server-side gate; `requireApiKey` already applied to all `/api/kiosk/*` routes |
| V5 Input Validation | Yes | `recipe_id` must be validated as string; `sale_type` must be enum; `mill_grain` must be boolean; `total` must be numeric and within bounds |
| V6 Cryptography | No | No new crypto; Helcim void uses existing `voidTransaction` |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Client-supplied rate values for invoice | Tampering | Never trust client rates; re-fetch recipe from cache/Apps Script server-side (same as catalog price anchoring in pos.js) |
| Client-supplied recipe_id pointing to inactive/draft recipe | Tampering | Server re-fetches recipe and checks `status === 'active'` before building invoice |
| Lock bypass via concurrent confirm requests | Denial of Service | Mutex on confirm endpoint too (same lock key); or confirm is stateless and idempotent on invoice number |
| Payment success + batch creation carrying PII | Information Disclosure | `recipe_snapshot` must not include customer PII; customer info passed separately |
| Milling fee toggle manipulated client-side | Tampering | Server reads `mill_grain` from body but validates that `MILLING_FEE_ITEM_ID` is configured; does not trust client-computed total |
| Void failure after Zoho invoice error | Repudiation | Follow existing pattern: `mailer.sendVoidFailureAlert()` + Redis persistence of void-failure record |

**Security notes specific to this phase:**
- The recipe sale confirm endpoint must re-validate `recipe_id` against the live recipe cache — a client cannot force billing for an ingredient list that differs from the server-side recipe definition.
- `recipe_snapshot` stored in Batches sheet should contain ingredient names and quantities only — no customer email, no payment token.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Milling fee "existing Zoho service item" from D-03 has not yet been assigned an env var and its Zoho item_id is unknown | Environment Availability | Take-out milling feature cannot be implemented until the item_id is found; feature may need to be scoped to "in-store only" for Wave 1 |
| A2 | The intent of D-08 (locked_price as display price, invoice at ingredient rates) means the terminal is charged the SUM of ingredient Zoho rates + fee, not the locked_price itself | Pitfall 3, Open Questions | If locked_price IS the terminal charge amount, the invoice line items would need rate adjustments to match — significant accounting complexity |
| A3 | The Redis lock is placed on the `/api/kiosk/recipe-sale` (initiate) endpoint rather than the confirm endpoint | Architecture Patterns | If placed on confirm only, two sales could reach terminal payment simultaneously; placing on initiate is safer |

---

## Sources

### Primary (HIGH confidence)

- [VERIFIED: codebase] `zoho-middleware/routes/pos.js` — complete kiosk sale flow, void pattern, invoice POST shape, catalog price anchoring
- [VERIFIED: codebase] `zoho-middleware/lib/brewpad-integration.js` — `detectKitItems`, `callAppsScriptCreateBatch`, `queueForRetry`, `retryPendingBatches` patterns
- [VERIFIED: codebase] `zoho-middleware/routes/recipes.js` — recipe endpoints, availability endpoint, cache bust logic
- [VERIFIED: codebase] `zoho-middleware/lib/cache.js` — `acquireLock(key, ttlSeconds)` and `releaseLock(key)` API
- [VERIFIED: codebase] `zoho-middleware/lib/constants.js` — `CACHE_KEYS.RECIPES`, `CACHE_KEYS.INGREDIENTS`, `CACHE_KEYS.KIOSK_PRODUCTS`
- [VERIFIED: codebase] `zoho-middleware/lib/validateEnv.js` — `BEER_SALES_ENABLED` registered as optional; `MAKERS_FEE_ITEM_ID`, `MATERIALS_FEE_ITEM_ID` registered
- [VERIFIED: codebase] `apps-script/adminApi.gs` — `create_batch` action writes `recipe_id` and `recipe_snapshot` by header lookup; fields exist in Batches sheet (Phase 12)
- [VERIFIED: codebase] `js/admin.js` — kiosk IIFE structure (lines 8693-9579), `_kioskCart`, `_kioskProducts`, tab hook pattern
- [VERIFIED: codebase] `admin.html` — kiosk browse layout HTML (lines 589-638), existing view structure
- [VERIFIED: codebase] `.planning/phases/13-middleware-api-admin-recipe-management/13-02-SUMMARY.md` — confirmed recipe API shape, availability endpoint behavior
- [VERIFIED: codebase] `.planning/config.json` — `nyquist_validation: false`, `security_enforcement: true`, `security_asvs_level: 1`

### Secondary (MEDIUM confidence)

- [CITED: 14-CONTEXT.md decisions D-01 through D-13] — All locked decisions confirmed by reading CONTEXT.md verbatim

### Tertiary (LOW confidence)

- None — all claims in this research are verified against codebase or cited from CONTEXT.md

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified present in codebase
- Architecture: HIGH — patterns verified in existing pos.js, brewpad-integration.js, and admin.js
- Pitfalls: HIGH — Pitfall 1-4 verified from code; Pitfall 5-6 inferred from Phase 13 decisions and env var audit
- Open questions: MEDIUM — based on design ambiguity in D-08 and missing env var for milling fee

**Research date:** 2026-05-17
**Valid until:** 2026-06-17 (stable stack; only stale if Phase 13 implementation diverges from SUMMARY.md)
