# Architecture Research

**Domain:** Recipe-based fermentation products — integration with existing S&V stack
**Researched:** 2026-05-09
**Confidence:** HIGH (based on direct codebase analysis)

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          GitHub Pages (Static)                            │
│  products.html  admin.html  kiosk.html  brewpad.html  [NEW recipe page]  │
│                                                                           │
│  js/modules/ (01–13)    js/kiosk.js    js/admin.js    js/brewpad.js      │
│  [NEW: 14-recipes.js]   [MODIFIED]     [MODIFIED]                        │
└──────────────────────┬───────────────────────────────────────────────────┘
                       │ HTTP (CORS, Referer guard, API key)
┌──────────────────────▼───────────────────────────────────────────────────┐
│                     Express Middleware (Railway)                           │
│  routes/catalog.js    routes/pos.js     routes/checkout.js               │
│  routes/items.js      [NEW: routes/recipes.js]                           │
│                                                                           │
│  lib/brewpad-integration.js  lib/zoho-api.js  lib/cache.js               │
│  [MODIFIED: brewpad-integration.js — recipe-aware batch creation]        │
└──────┬────────────────┬────────────────────────────────┬─────────────────┘
       │                │                                │
┌──────▼──────┐  ┌──────▼──────────────────┐  ┌────────▼────────────────┐
│ Zoho Books  │  │   Redis Cache (Railway)  │  │  Google Apps Script     │
│ /Inventory  │  │                          │  │  (Google Sheets backend)│
│             │  │  zoho:kiosk-products     │  │                         │
│ Items       │  │  zoho:products           │  │  Batches sheet          │
│ Sales Orders│  │  zoho:ingredients        │  │  FermSchedules sheet    │
│ Invoices    │  │  [NEW: sv:recipes]       │  │  BatchTasks sheet       │
│ Customer    │  │                          │  │  PlatoReadings sheet    │
│ Payments    │  │                          │  │  VesselHistory sheet    │
│             │  │                          │  │  [NEW: Recipes sheet]   │
└─────────────┘  └──────────────────────────┘  └─────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Files |
|-----------|---------------|-------|
| Recipe data store | Recipe definitions: name, style, ingredient list with SKUs/qty, brewing fee, BeerXML source | Google Sheets "Recipes" tab (new) |
| Recipe API | CRUD for recipes, BeerXML parse, recipe→ingredient expansion | `zoho-middleware/routes/recipes.js` (new) |
| Kiosk recipe cart | "Add Recipe" button → bulk-populate kiosk cart with ingredient items + brewing fee | `js/kiosk.js` (modified) |
| Admin recipe manager | Staff CRUD UI: create, import BeerXML, edit, publish/unpublish recipes | `js/admin.js` (modified) |
| Public recipe browser | Recipe cards on products page, "Build Your Own" CTA | `js/modules/14-recipes.js` (new) |
| Brewpad recipe link | `recipe_id` stored on Batch row; batch detail shows recipe name | `apps-script/adminApi.gs` (modified) |
| Inventory deduction | Per-ingredient line items on Zoho invoice — Zoho deducts each separately | Existing pattern via `zohoPost('/invoices', ...)` |

---

## Question-by-Question Integration Analysis

### 1. Where Does Recipe Data Live?

**Recommendation: Google Sheets new "Recipes" tab (not Zoho composite items).**

Zoho Inventory's composite items API is not suitable here. The composite items API manages physical assembly (bundling finished goods) — it is not designed to expand into line items on a sales invoice. The Zoho Sales Order API's `line_items` array accepts only `item_id` (a Zoho inventory item) and does not support composite item IDs as line items in a way that auto-deducts components. Composite item deduction requires a separate "assembly" POST; it does not happen at invoice time via API.

The existing Google Sheets + Apps Script pattern is already proven, staff-accessible, and flexible. Add a "Recipes" tab with the following columns:

```
recipe_id    | String   | Auto-generated (SV-R-NNNNNN)
name         | String   | Display name (e.g., "Cascade IPA 23L")
style        | String   | Beer style / category (maps to KIT_CATEGORIES beer/cider/seltzer)
description  | String   | Public-facing description
status       | String   | "draft" | "active" | "archived"
brewing_fee  | Number   | Staff labour/overhead fee (flat, e.g., 60.00)
batch_size_l | Number   | Batch size in litres (from BeerXML)
abv          | Number   | ABV % (from BeerXML OG/FG)
notes        | String   | Tasting notes / staff notes
ingredients  | JSON     | [{item_id, sku, name, quantity, unit},...] — Zoho item_id refs
beerxml_hash | String   | SHA-1 of source BeerXML (dedup / change detection)
created_at   | DateTime | ISO timestamp
created_by   | String   | Staff email
updated_at   | DateTime | ISO timestamp
```

The `ingredients` column stores a JSON array of Zoho item references. This allows the system to look up live pricing and stock from the existing `zoho:ingredients` cache at cart-population time.

**Confidence: HIGH** — Zoho composite item limitation verified against API docs. Sheets pattern is battle-tested in this codebase.

---

### 2. BeerXML Import Flow

**Flow: Admin upload in browser → middleware parse → Sheets write**

```
Admin uploads .xml file
    ↓
Browser FileReader → reads XML string → POSTs to POST /api/recipes/import-beerxml
    ↓
Middleware (routes/recipes.js):
  1. Parse BeerXML with fast-xml-parser (existing XML handling pattern, no new deps needed)
     OR use the `beerxml` npm package (1.0.6, lightweight, no external deps)
  2. Extract: recipe name, style, batch_size, OG, FG, hop/grain/adjunct ingredients with amounts
  3. Match ingredients against Zoho ingredients catalog (fuzzy name match → staff confirms)
  4. Return parsed recipe JSON to admin for review before saving
    ↓
Admin reviews ingredient mappings (which Zoho SKUs = which BeerXML ingredients)
    ↓
Admin confirms → POST /api/recipes with confirmed payload
    ↓
Middleware writes to Sheets via Apps Script (action: 'create_recipe')
    ↓
Recipe available in Sheets with status='draft'
```

**BeerXML key fields extracted:**

```
RECIPE.NAME       → recipe.name
RECIPE.STYLE.NAME → recipe.style
RECIPE.BATCH_SIZE → recipe.batch_size_l (convert from gallons if needed)
RECIPE.OG / FG   → recipe.abv (calculated)
RECIPE.FERMENTABLES[].FERMENTABLE → ingredient candidates
RECIPE.HOPS[].HOP                 → ingredient candidates
RECIPE.YEASTS[].YEAST             → ingredient candidates
RECIPE.MISCS[].MISC               → ingredient candidates
```

The matching step (BeerXML ingredient name → Zoho `item_id`) is the critical fuzzy step that requires staff confirmation. Middleware should return a `candidates` array (top 3 Zoho matches by name similarity) for each unmatched ingredient.

**Library recommendation:** `fast-xml-parser` (already likely available or trivially addable) or `beerxml` npm package. Do not use `brauhaus-beerxml` — it requires Brauhaus.js as peer dependency. Prefer `fast-xml-parser` to keep the dependency count low; BeerXML 1.0 is simple enough to parse manually with a generic XML parser.

**Confidence: MEDIUM** — BeerXML format is well-documented and stable. The matching step is the unknown complexity. "beerxml" npm package confirmed at [npmjs.com/package/beerxml](https://www.npmjs.com/package/beerxml).

---

### 3. Recipe → Cart → Sale Flow

**Kiosk flow (primary):**

```
Staff selects recipe from kiosk recipe browser
    ↓
GET /api/recipes/:id → returns {recipe_id, name, brewing_fee, ingredients:[{item_id, qty, unit}]}
    ↓
kiosk.js: kioskLoadRecipe(recipe)
  - For each ingredient: look up item_id in _kioskProducts cache
  - If found: add to _kioskCart at specified qty (call kioskAddToCart per item)
  - If not found: show "Out of Stock" / "Not Available" warning
  - Add brewing fee Zoho item (BREWING_FEE_ITEM_ID env var) to cart as service
    ↓
Staff reviews cart (shows all ingredients + brewing fee)
Staff can adjust quantities (existing kiosk UI supports this)
    ↓
Normal kiosk sale flow: POST /api/kiosk/sale → terminal → /api/kiosk/sale/confirm
    ↓
POST /api/kiosk/sale/confirm builds line_items from _kioskCart:
  [{item_id: "zoho_grain_id", name: "Pilsner Malt", qty: 4.2, rate: 3.50},
   {item_id: "zoho_hop_id", name: "Cascade Hops 30g", qty: 2, rate: 2.10},
   {item_id: "zoho_brew_fee_id", name: "Brewing Fee", qty: 1, rate: 60.00},
   ...]
    ↓
Zoho invoice created with all individual ingredient line items
  → Zoho deducts each ingredient's stock on invoice submit (standard Zoho behavior)
    ↓
brewpadIntegration.createBatchesFromSale:
  - PROBLEM: detectKitItems() looks for MAKERS_FEE_ITEM_ID to trigger batch creation
  - Recipe sale has BREWING_FEE_ITEM_ID instead → need recipe-aware detection
  - Solution: extend detectKitItems() to also recognize BREWING_FEE_ITEM_ID
  - Batch payload needs recipe_id added
```

**The cart routing decision:** Recipe ingredients go into `INGREDIENT_CART_KEY` (sv-cart-ingredients) because their `_item_type` would be `'ingredient'`. The brewing fee is a service item. This means recipe sales route through the ingredient cart on the public site — but the kiosk has its own cart state (`_kioskCart` object, not localStorage). The kiosk cart is unaffected by the public site's dual-cart split.

**Confidence: HIGH** — kiosk cart is a simple JS object; loading N items from a recipe is a straightforward loop over `kioskAddToCart()`.

---

### 4. Zoho Inventory Deduction

**Recommendation: Per-ingredient line items on Zoho invoice (NOT composite items)**

This is already how the system works. When a Zoho invoice is submitted (`zohoPost('/invoices/' + id + '/submit', {})`), Zoho Inventory automatically deducts stock for each line item that references an inventory item by `item_id`. This is the existing behavior for wine kits.

For recipe sales, the line items are simply the individual ingredients — each with their own Zoho `item_id`. Zoho deducts them individually at invoice submit. No composite item management needed.

**Why not composite items:**
- Composite items require a separate "bundle" assembly step before sale
- The Zoho Inventory API does not support composite items as direct sales order/invoice line items via the REST API in a way that auto-deducts components
- Creating a composite item per recipe would require staff to pre-bundle stock before each sale — operationally worse

**The brewing fee:** Add a new Zoho Inventory "service" item called "Brewing Fee" (non-inventory, type=service). Reference its `item_id` as `BREWING_FEE_ITEM_ID` env var. This mirrors the existing `MAKERS_FEE_ITEM_ID` pattern exactly. The kiosk auto-adds it when a recipe is loaded (parallel to how `kioskSyncKitFees()` adds Maker's Fee for wine kits).

**Confidence: HIGH** — per-ingredient deduction is how the existing online checkout handles ingredients. The kiosk sale confirm path (`/api/kiosk/sale/confirm`) already does this for any item_id in the cart.

---

### 5. BrewPad Recipe Integration

**New Sheets tab: "Recipes" only. The "Batches" tab gets a new `recipe_id` column.**

The Batches sheet currently has 24 columns (rows visible in `createBatch()` in `adminApi.gs`). Add `recipe_id` as column 25:

```javascript
// In createBatch() — new column appended:
batchesSheet.appendRow([
  ...existing 24 columns...,
  sanitizeInput(payload.recipe_id || '')  // col 25: recipe_id
]);
```

**Middleware changes in `brewpad-integration.js`:**

```javascript
// Extend batchPayload in createBatchesFromSale():
var batchPayload = {
  product_sku:   item.sku || item.item_id || '',
  product_name:  item.name || '',
  customer_name: customerName || 'Walk-in Customer',
  // ... existing fields ...
  recipe_id:     item.recipe_id || ''  // NEW: passed from kiosk if recipe sale
};
```

The kiosk `confirm` handler would tag the recipe ID on each ingredient line item before calling `createBatchesFromSale`, or (better) pass it as a separate parameter.

**BrewPad UI:** The batch detail view in `brewpad.js` fetches `get_batch` from Apps Script, which returns the batch row. If `recipe_id` is present, `brewpad.js` can show a "Recipe" section with a link to the recipe details.

**Batch creation trigger for recipe sales:** Currently `detectKitItems()` requires `MAKERS_FEE_ITEM_ID` to be present (wine kit trigger). Recipe sales use `BREWING_FEE_ITEM_ID` instead. Two options:

1. **Extend detectKitItems():** Check for either fee item ID. One batch created per recipe sale (not per ingredient).
2. **Separate trigger path:** Recipe sales call a new `createBatchFromRecipeSale()` that sends recipe-specific payload including `recipe_id` and all ingredients as a flat list.

Option 2 is cleaner — recipe batches are fundamentally different (one batch per recipe, not one per kit line item). The recipe batch payload would include `recipe_id` and a flattened `ingredients` JSON string for storage on the batch row.

**Confidence: HIGH** — the Sheets + Apps Script pattern is well-understood. Column addition is low-risk.

---

### 6. Recipe Browsing on Public Site

**Recommendation: New product type "recipe" rendered by a new module `14-recipes.js`.**

Recipes are NOT Zoho products — they are not in the kits catalog. They live in the Recipes Sheets tab, fetched via Apps Script `get_recipes` (new action). The public site fetches them the same way featured products are fetched: `GET apps-script-url?action=get_recipes`.

**Rendering:** The existing `buildBeerCard()` function in `07-catalog-kits.js` is the closest analog — recipe cards would use the `.label-beer` card style with style-based tint class from `getTintClass()`. A recipe card shows:
- Name, style, ABV, batch size
- Ingredient count (e.g., "12 ingredients")
- Brewing fee
- "Reserve This Recipe" button (triggers kiosk consultation CTA, not direct online cart add — kiosk-first per PROJECT.md)

**Products page integration:** Add a "Recipes" tab alongside "Ferment in Store", "Ingredients", "Services" in `10-tabs.js`. The tab fetches from Apps Script (not middleware) since recipe data is Sheets-native. The "Reserve" button on a recipe card shows a modal: "Visit us in store to brew this recipe — call XXX or book a time."

**"Build Your Own" option:** A static card at the end of the recipes list pointing to the consultation booking flow. No new UI needed — reuse existing bookings link.

**Confidence: MEDIUM** — rendering is straightforward but the Apps Script fetch for public recipes introduces a new data source on the public site (currently all product data comes from middleware). This is a deliberate architectural split: recipes are staff-managed in Sheets, not Zoho catalog items.

---

### 7. Kiosk Recipe Sale — Cart Handling

**The kiosk cart (`_kioskCart`) handles N ingredients naturally because it is a plain JS object keyed by `item_id`.**

Loading a recipe:

```javascript
function kioskLoadRecipe(recipe) {
  // 1. Validate all ingredients are in catalog
  var missing = [];
  recipe.ingredients.forEach(function(ing) {
    if (!_kioskProducts.find(function(p) { return p.item_id === ing.item_id; })) {
      missing.push(ing.name);
    }
  });
  if (missing.length) {
    alert('Missing from catalog: ' + missing.join(', '));
    return;
  }

  // 2. Confirm with staff (cart replacement or append)
  if (Object.keys(_kioskCart).length > 0) {
    if (!confirm('Replace current cart with recipe items?')) return;
    _kioskCart = {};
  }

  // 3. Add each ingredient at recipe quantity
  recipe.ingredients.forEach(function(ing) {
    var product = kioskFindProductById(ing.item_id);
    if (product) {
      _kioskCart[product.item_id] = { item: product, qty: ing.quantity };
    }
  });

  // 4. Add brewing fee (mirrors kioskSyncKitFees for wine)
  var brewFee = kioskFindProductById(BREWING_FEE_ITEM_ID);
  if (brewFee) {
    _kioskCart[brewFee.item_id] = { item: brewFee, qty: 1 };
  }

  // 5. Tag cart with recipe_id for batch creation
  _kioskActiveRecipeId = recipe.recipe_id;

  kioskRenderCart();
  kioskRenderProducts();
}
```

**Fee structure for beer:** The current wine fee structure ($45 Maker's Fee + $5 Materials Fee) is recognized via `MAKERS_FEE_ITEM_ID` and `MATERIALS_FEE_ITEM_ID` env vars. Beer recipes will use `BREWING_FEE_ITEM_ID` (a new env var pointing to a new Zoho service item). The amount is TBD but the pattern is identical: one Zoho service item, auto-added when a recipe is loaded, auto-removed when cart is cleared.

**Stock validation:** The existing `kioskCheckStockOverflow()` function checks against `stock_on_hand`. For recipe ingredients, quantities may be fractional (kg). The kiosk already handles weight items via `kioskIsWeightItem()` and prompt-for-quantity. Recipe loading bypasses the prompt — it sets quantities directly from the recipe definition.

**Confidence: HIGH** — the kiosk cart pattern accommodates this with minimal changes.

---

## New vs Modified Components

### New Components

| Component | Type | Purpose |
|-----------|------|---------|
| `zoho-middleware/routes/recipes.js` | New file | REST API: GET/POST/PUT/DELETE recipes, BeerXML import endpoint |
| `js/modules/14-recipes.js` | New file | Public recipe browser: fetch, render, tab integration |
| `apps-script/adminApi.gs` → `get_recipes`, `create_recipe`, `update_recipe` actions | New actions in existing file | Recipe CRUD via Apps Script |
| Google Sheets "Recipes" tab | New Sheets tab | Recipe data store |
| Redis key `sv:recipes` | New cache key | Recipe catalog cache (5 min TTL) |
| Zoho "Brewing Fee" service item | New Zoho item | Fee for beer recipe service (parallel to Maker's Fee) |
| `BREWING_FEE_ITEM_ID` env var | New env var | Points to Zoho brewing fee service item |

### Modified Components

| Component | Change | Risk |
|-----------|--------|------|
| `zoho-middleware/lib/brewpad-integration.js` | Extend `detectKitItems()` to handle recipe sales; add `recipe_id` to batch payload | LOW — additive only |
| `zoho-middleware/lib/constants.js` | Add `CACHE_KEYS.RECIPES` | LOW |
| `js/kiosk.js` | Add recipe browser tab, `kioskLoadRecipe()`, `_kioskActiveRecipeId` | MEDIUM — existing cart logic must be preserved |
| `js/admin.js` | Add recipe management tab: list, create, import BeerXML, edit | MEDIUM — admin IIFE is large, follow existing tab pattern |
| `apps-script/adminApi.gs` | Add `recipe_id` column to Batches sheet, add recipe CRUD actions | LOW-MEDIUM — column append is safe; schema change needs coordination |
| `js/modules/10-tabs.js` | Add "Recipes" tab to public product page tab set | LOW |
| `js/lib/constants.js` | Add `ITEM_TYPES.RECIPE` if needed | LOW |

---

## Data Flow Diagrams

### BeerXML Import Flow

```
Admin UI (admin.html)
  ↓ FileReader reads .xml
POST /api/recipes/import-beerxml  {xml_content: "..."}
  ↓
routes/recipes.js: parseeBeerXML(xml)
  → Extract ingredients list with names/quantities
  → Match against zoho:ingredients cache (fuzzy name match)
  → Return: {parsed_recipe, unmatched_ingredients, candidate_matches}
  ↓
Admin reviews: confirm ingredient→item_id mappings
POST /api/recipes  {name, style, brewing_fee, ingredients:[{item_id,qty,unit}]}
  → Validate all item_ids exist in zoho:ingredients cache
  → Write to Apps Script: action='create_recipe'
  → Return {ok, recipe_id}
  ↓
Recipe visible in admin recipe list (status=draft)
Admin publishes: PUT /api/recipes/:id  {status: "active"}
```

### Kiosk Recipe Sale Flow

```
Staff taps recipe in kiosk recipe browser
  ↓
GET /api/recipes/:id (cached 5min in sv:recipes)
  ↓
kioskLoadRecipe(recipe):
  - Validate ingredients in _kioskProducts
  - Populate _kioskCart with ingredient qtys
  - Add BREWING_FEE item
  - Set _kioskActiveRecipeId
  ↓
Normal kiosk checkout flow (unchanged):
  POST /api/kiosk/sale → terminal charge → POST /api/kiosk/sale/confirm
  ↓
/api/kiosk/sale/confirm receives {items:[...], recipe_id:"SV-R-000001"}
  - Builds line_items from each ingredient item_id (standard)
  - Adds brewing fee as line item
  - Creates Zoho invoice (Zoho deducts each ingredient on submit)
  - Calls brewpadIntegration.createBatchFromRecipeSale(lineItems, recipe_id, ...)
  ↓
Apps Script: create_batch with recipe_id
  - Batch row gets recipe_id in col 25
  - One batch per recipe sale
```

### Recipe → Batch → BrewPad Flow

```
Zoho Invoice Created (all ingredients + brewing fee)
  ↓
createBatchFromRecipeSale():
  payload = {
    product_sku: recipe_id,
    product_name: recipe.name,
    recipe_id: "SV-R-000001",
    customer_name: "...",
    source: "kiosk-recipe",
    zoho_so_number: invoiceNumber
  }
  → POST to Apps Script (action: create_batch)
  ↓
Apps Script createBatch():
  - Writes batch row with recipe_id in col 25
  - Auto-generates SV-B-NNNNNN batch ID
  - Returns {ok, batch_id}
  ↓
BrewPad batch detail shows recipe name + link to recipe definition
```

---

## Architectural Patterns to Follow

### Pattern 1: Recipe as Ingredient Collection (Not Composite Item)

**What:** A recipe is a named collection of `{item_id, quantity, unit}` tuples stored in Google Sheets, not in Zoho Inventory.
**When to use:** Always for this system. Zoho composite items solve a different problem (physical assembly inventory).
**Trade-offs:** Requires fuzzy matching on BeerXML import; ingredient item_ids must stay stable (Zoho item deletion would break recipes). Upside: zero Zoho API complexity, flexible editing, staff-accessible.

### Pattern 2: Fee Item via Env Var (Mirror Existing Pattern)

**What:** Create one Zoho "service" item for the brewing fee. Store its `item_id` in `BREWING_FEE_ITEM_ID`. The kiosk auto-adds it when a recipe is loaded, exactly as `kioskSyncKitFees()` does for Maker's Fee.
**When to use:** Whenever recipe sales need a fee line item.
**Trade-offs:** Fee amount is controlled by the Zoho item price (editable in Zoho UI). If fee varies by recipe complexity, this needs a different approach (rate override in recipe definition, passed to kiosk UI).

### Pattern 3: Apps Script as Recipe Data Store

**What:** Google Sheets "Recipes" tab with Apps Script CRUD, accessed by middleware via `APPS_SCRIPT_URL` (same existing endpoint). Recipe data is cached in Redis `sv:recipes` with a 5-min TTL.
**When to use:** For all recipe read/write operations. Mirrors the batch data pattern.
**Trade-offs:** Apps Script quota limits (20,000 exec/day). At recipe volumes (dozens, not thousands), this is not a concern.

### Pattern 4: BeerXML Parse Server-Side, Confirm Client-Side

**What:** Upload raw XML to middleware, return parsed + candidate-matched data to admin UI, then admin confirms before saving. Never auto-save without staff confirmation.
**When to use:** BeerXML import only.
**Trade-offs:** Two-step UX, but avoids silently creating recipes with wrong ingredient mappings.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Zoho Composite Items for Recipe Inventory

**What people might do:** Create a Zoho composite item per recipe, then sell the composite item on the kiosk invoice.
**Why it's wrong:** The Zoho Inventory REST API does not support composite items as invoice line items. Composite items require a separate "assembly" workflow (bundle N units before sale). This is for manufacturing, not recipe-to-order.
**Do this instead:** Sell each ingredient as a separate line item on the Zoho invoice. Zoho deducts each ingredient's stock at invoice submit.

### Anti-Pattern 2: Recipe Data in Zoho Custom Fields

**What people might do:** Store ingredient lists in Zoho item custom fields (e.g., a JSON string in a custom field on a "Recipe" item).
**Why it's wrong:** Zoho custom fields are for UI display, not structured data. Querying/updating them is slow and fragile. The Zoho API is already heavily rate-limited.
**Do this instead:** Google Sheets Recipes tab is the canonical store. Zoho only knows about individual ingredients (which are already there).

### Anti-Pattern 3: One Recipe = One New Zoho Item

**What people might do:** Create a new Zoho Inventory item called "Cascade IPA Recipe" and sell that.
**Why it's wrong:** Recipes are not products — they have no SKU, no stock, no price anchor. Creating fake Zoho items pollutes the catalog and breaks stock tracking.
**Do this instead:** Recipes live in Sheets. Kiosk expands them to ingredient line items at cart load time.

### Anti-Pattern 4: Auto-Triggering Batch via Maker's Fee Detection for Recipe Sales

**What people might do:** Add BREWING_FEE_ITEM_ID to the existing `detectKitItems()` check alongside MAKERS_FEE_ITEM_ID.
**Why it's wrong:** Wine kit batches (one batch per kit line item) and recipe batches (one batch for the whole recipe) have different cardinality. Merging them in `detectKitItems()` would create multiple batches for a recipe sale (one per ingredient).
**Do this instead:** Add a separate `detectRecipeSale()` function. Recipe sales call `createBatchFromRecipeSale()` directly, not `createBatchesFromSale()`.

---

## Integration Points

### External Services

| Service | Integration Pattern | Recipe-Specific Notes |
|---------|---------------------|----------------------|
| Google Apps Script | POST `action=create_recipe/update_recipe/get_recipes` | New actions; same APPS_SCRIPT_URL, same server_token auth |
| Zoho Inventory | Per-ingredient `item_id` line items on invoice | No new Zoho APIs needed; brewing fee = new Zoho service item |
| Zoho Books | `POST /invoices` with N ingredient line items | Works today for ingredient checkout; same pattern |
| Helcim Terminal | Unchanged | Recipe total = sum(ingredients) + brewing fee |
| Redis | New key `sv:recipes` (list) | Same cache pattern as `sv:kiosk-products` |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Admin UI ↔ Middleware | `POST /api/recipes`, `PUT /api/recipes/:id`, `DELETE /api/recipes/:id`, `POST /api/recipes/import-beerxml` | New route file; follows existing patterns |
| Middleware ↔ Apps Script | `action=create_recipe`, `get_recipes`, `update_recipe` | Same APPS_SCRIPT_URL; add recipe actions to `doPost`/`doGet` |
| Kiosk ↔ Middleware | `GET /api/recipes` (list), `GET /api/recipes/:id` (detail) | New but follows existing `/api/kiosk/products` pattern |
| Public site ↔ Apps Script | `GET ?action=get_recipes` (active only, public endpoint, no auth) | Parallel to existing `get_featured`; add to public endpoints in `doGet` |
| Middleware ↔ brewpad-integration | Pass `recipe_id` through sale confirm → batch creation | Additive change to `processSaleWithPrices` body |

---

## Build Order (Dependency Sequence)

The following order respects architectural dependencies — each phase produces a working system state:

1. **Recipe data model + Sheets schema** — Recipes tab in Google Sheets, create_recipe/get_recipes actions in Apps Script. No code changes yet, just schema.

2. **Brewing fee Zoho item + env var** — Create "Brewing Fee" service item in Zoho, set `BREWING_FEE_ITEM_ID`. Prerequisite for kiosk and batch creation.

3. **Middleware recipe CRUD** — `routes/recipes.js` with GET/POST/PUT endpoints and Redis caching. Includes BeerXML parse endpoint (server-side only, no UI yet). Adds `CACHE_KEYS.RECIPES` to constants.

4. **Admin recipe management UI** — New "Recipes" tab in admin.js: list recipes, create/edit form, BeerXML import modal. Depends on routes from step 3.

5. **Kiosk recipe sale** — `kioskLoadRecipe()`, recipe browser tab in kiosk UI, `_kioskActiveRecipeId`, brewing fee sync. Modify sale confirm path to pass `recipe_id`.

6. **Batch creation for recipe sales** — Extend `brewpad-integration.js` with `createBatchFromRecipeSale()`. Add `recipe_id` column to Batches sheet. BrewPad batch detail shows recipe name.

7. **Public recipe browser** — `14-recipes.js` module, new "Recipes" tab on products page, recipe card rendering. Guard: only show when `recipe.status === 'active'`.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| < 50 active recipes | Google Sheets is adequate. Cache full list in Redis. |
| > 200 recipes | Add pagination to `get_recipes`. Consider a dedicated Redis sorted set for recipe browsing. |
| Recipe import automation | BeerXML batch import (ZIP of multiple files) could be added without architecture change. |

---

## Sources

- Direct codebase analysis: `zoho-middleware/routes/pos.js`, `lib/brewpad-integration.js`, `js/modules/11-cart.js`, `js/kiosk.js`, `js/lib/constants.js`, `apps-script/adminApi.gs`
- [Zoho Inventory Composite Items API](https://www.zoho.com/inventory/api/v1/compositeitems/) — confirmed composite items are not line-itemizable in Sales Orders/Invoices via REST API
- [Zoho Inventory Sales Orders API](https://www.zoho.com/inventory/api/v1/salesorders/) — line_items accepts `item_id` for standard inventory items only
- [beerxml npm package](https://www.npmjs.com/package/beerxml) — lightweight BeerXML 1.0 parser for Node.js
- [BeerXML Standard](https://beerxml.com/) — BeerXML 1.0 schema reference

---

*Architecture research for: Steins & Vines recipe-based product system integration*
*Researched: 2026-05-09*
