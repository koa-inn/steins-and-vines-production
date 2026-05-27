# Architecture Research

**Domain:** Recipe-based fermentation products — integration with existing S&V stack
**Researched:** 2026-05-09 (v3.0 catalog subpages section added 2026-05-27)
**Confidence:** HIGH (based on direct codebase analysis)

---

## v3.0 Catalog Subpages: Integration Architecture

**Scope:** 5 new ingredient category subpages (Grains, Yeast, Additives, Packaging, Equipment)

### Established Patterns (from code audit)

#### Module Classification

The codebase has two distinct module categories:

**Concat modules** (01–13, in `js/modules/`): concatenated by `concat:js` into `main.js`, loaded on every page that uses `main.min.js`. These provide all shared globals: `formatCurrency`, `escapeHTML`, `renderReserveControl`, `renderWeightControl`, `setReservationQty`, `getReservedQty`, cart functions, Fuse initialization helpers, `trackEvent`, etc.

**Standalone modules** (`14-labels.js`, `15-hops.js`): NOT in `concat:js`. Loaded per-page as a separate `<script>` after `main.min.js`. They depend on main.js globals but add page-specific state and rendering on top of them.

The `15-hops.js` module is the direct precedent for the new subpages: it makes its own `/api/ingredients` call, applies its own category filter, manages its own `localStorage` cache (key `sv-hops-mw`), and initializes its own Fuse instance over the filtered subset.

#### Page Initialization

`13-init.js` dispatches on `document.body.getAttribute('data-page')` inside `DOMContentLoaded`. Pages are gated by data-page value: `products`, `ingredients`, `ferment-in-store`, `ingredients-supplies` all share the same branch (`loadProducts()` + tabs). The `hops` page gets its own minimal branch (`initCartDrawer()` only; the actual catalog init runs inside `15-hops.js`).

#### Data Source

All ingredient-category pages use the same backend endpoint: `GET /api/ingredients` via the Railway middleware. The response is a flat array of all non-kit, non-service, non-zero-price inventory items. Each item has:
- `name`, `sku`, `price_per_unit`, `stock`, `unit`, `description`, `tax_percentage`
- `category` — mapped from Zoho `category_name`
- Custom fields flattened by `flattenCF`: labels lowercased + spaces to underscores. `type` (from `cf_type`), `subcategory` (from CF "Subcategory"), and any hop-specific fields (`citrus`, `tropical`, etc.) land here.

The snapshot fallback (`/content/zoho-snapshot.json`) mirrors the same shape via `shapeIngredient()`. Subcategory lives as a flattened custom field — it is NOT a top-level Zoho field, so it must come from the detail enrichment pass.

The **Zoho subcategory tagging requirement** means items must have a "Subcategory" custom field populated in Zoho before any category-based filtering works. This is a data prerequisite, not a code prerequisite, and must be completed before the JS filtering logic can be validated end-to-end.

#### CSS Organization

Each standalone page has its own CSS file (`hops.css` → `hops.min.css`, `labels.css` → `labels.min.css`) added to the `minify:css` build step. `styles.css` is global: cart drawer, product card base, catalog controls, filter rows, etc. Page-specific files contain hero decoration, unique color themes, and structural overrides only.

The `body[data-page="X"]` selector pattern scopes styles without wrapper classes.

#### Cart Integration

Subpages use the cart drawer (not the sidebar). `initCartDrawer()` is called from `13-init.js`. Cart drawer HTML is hardcoded in the HTML file. The drawer wires to `sv-cart-ingredients` via `getReservation()` / `saveReservation()`.

#### Build System

- `minify:css`: explicit list — each new CSS file needs a line added
- `concat:js`: explicit list — standalone modules are NOT added here
- `minify:js`: explicit list — each new standalone `.js` file needs a terser call added
- `stamp:pages`: explicit list of HTML files for cache-busting — each new page needs to be added

#### Vendor Scripts

`hops.html` loads `sentry.min.js` (synchronous), then `sentry-init.js`, then `fuse.min.js` (defer), then `sheets-config.js` (defer), then `main.min.js` (defer), then `15-hops.min.js` (defer). The defer order ensures Fuse is available when the module initializes.

---

### Module Strategy: Single Shared Standalone Module

**Use one new standalone module** `js/modules/16-catalog-subpage.js` for all 5 subpages, rather than 5 separate files.

Rationale: The 5 subpages are structurally identical — same data source, same cart integration, same filter/search pattern, different category filter value and hero accent. A single module initialized by `data-page` attribute avoids maintaining 5 near-duplicate files. `15-hops.js` is NOT shared because hops has unique behavior: radar charts, flavor axes, SVG comparison, alpha acid display, foil bag visual effect. None of that complexity exists in the new subpages.

The module config object is defined inline in each HTML file before `16-catalog-subpage.min.js` loads:

```javascript
var SUBPAGE_CONFIG = {
  category: 'Grain',        // matches subcategory value from Zoho CF
  pageId: 'grains',         // matches data-page, localStorage key suffix
  catalogEl: 'subpage-catalog',
  searchEl: 'subpage-search',
  sortEl: 'subpage-sort'
};
```

This is ES5-compatible (plain object literal assigned to a global `var`) and follows the existing pattern of `SHEETS_CONFIG` in `sheets-config.js`.

### Data Flow

```
Page load
  → main.min.js runs (provides globals: formatCurrency, renderWeightControl, etc.)
  → fuse.min.js available
  → 16-catalog-subpage.min.js runs
      → reads SUBPAGE_CONFIG.category
      → calls loadSubpageItems(config)
          → tries localStorage cache 'sv-subpage-{pageId}-mw' (TTL 30 min)
          → fetches /api/ingredients
          → filters by subcategory === config.category
          → stores in _subpageItems
          → initializes Fuse over _subpageItems
          → calls renderSubpageItems()
          → wires search/sort/filter events
```

The full `/api/ingredients` response is fetched even though only one category is needed. This is correct because:

1. The middleware caches the full ingredient list in Redis; per-category endpoints would require new middleware routes and cache keys.
2. The hops module already does exactly this — fetches the full `/api/ingredients`, filters locally.
3. The subpage module uses its own localStorage key (`sv-subpage-{pageId}-mw`) to avoid evicting the main ingredients cache.

Cross-page search reuses the cached full response from any warm subpage localStorage entry, or issues a fresh fetch if all are stale.

### Sub-Nav Bar

The sub-nav is **static HTML** in each page, not dynamically rendered. Dynamic rendering would require knowing which subpages exist before any data loads, creating a flash of missing nav. Static HTML nav is cache-busted by the build stamp.

Sub-nav structure (same block in all 6 ingredient pages, including `ingredients-supplies.html`):

```html
<nav class="ingredient-subnav" aria-label="Ingredient categories">
  <a href="/products/ingredients-supplies" data-subnav="all">All</a>
  <a href="/products/ingredients/grains" data-subnav="grains">Grains</a>
  <a href="/products/ingredients/yeast" data-subnav="yeast">Yeast</a>
  <a href="/products/ingredients/additives" data-subnav="additives">Additives</a>
  <a href="/products/ingredients/packaging" data-subnav="packaging">Packaging</a>
  <a href="/products/ingredients/equipment" data-subnav="equipment">Equipment</a>
</nav>
```

Active state is set in CSS via `body[data-page="grains"] [data-subnav="grains"]` — no JS required. The sub-nav block is duplicated in each file (no SSI/templating on a static site). A note in `CLAUDE.md` should document which files contain the sub-nav block to ensure all are updated together.

Hops (`hops.html`) does NOT get the ingredient sub-nav — hops is a distinct product catalog, not an ingredient category page.

### Search Overlay

The cross-category search overlay operates over the full ingredient dataset. When the user types in the cross-category search input, the overlay reads from the freshest available localStorage cache entry and filters across all categories simultaneously. If no cache is warm, it fetches `/api/ingredients` once. Results are grouped by category (Grain, Yeast, etc.) in the overlay.

This avoids a separate fetch: by the time a user interacts with cross-category search, the subpage's own data fetch has completed and the cache is warm. The overlay logic lives inside `16-catalog-subpage.js` and activates when `document.getElementById('cross-category-search')` is present in the DOM.

### CSS Strategy

**One shared CSS file**: `css/catalog-subpage.css` → `css/catalog-subpage.min.css`.

This file contains:
- Sub-nav bar styles (`.ingredient-subnav`)
- Subpage hero styles (`.subpage-hero` with per-category accent via `body[data-page="grains"]`, etc.)
- Catalog grid, filter, sort styles shared across all 5 pages
- Search overlay panel (`.ingredient-search-overlay`)

There is no per-page CSS file. The 5 pages differ only in hero accent color/image, covered by `data-page`-scoped rules in the shared file. Hops has its own CSS only because of the elaborate foil bag SVG filter effect — nothing like that exists here.

`styles.css` is not modified. `.ingredient-subnav` and `.subpage-hero` do not belong in the global styles because they are not used outside the ingredient subpages.

### File Layout

New files:
```
js/modules/16-catalog-subpage.js       (source)
js/modules/16-catalog-subpage.min.js   (build artifact)
css/catalog-subpage.css                (source)
css/catalog-subpage.min.css            (build artifact)
products/ingredients/grains.html
products/ingredients/yeast.html
products/ingredients/additives.html
products/ingredients/packaging.html
products/ingredients/equipment.html
```

Note: HTML files live in `products/ingredients/` (two levels deep), so asset paths use `../../` prefix (e.g. `../../css/styles.min.css`, `../../js/main.min.js`).

Modified files:
```
package.json                        — add minify:css entry, minify:js entry, stamp:pages entry
products/ingredients-supplies.html  — add sub-nav HTML block
js/modules/13-init.js               — add new page types to DOMContentLoaded dispatch
```

`13-init.js` adds a new dispatch branch:
```javascript
if (page === 'grains' || page === 'yeast' || page === 'additives' ||
    page === 'packaging' || page === 'equipment') {
  initCartDrawer();
  // 16-catalog-subpage.js self-initializes via SUBPAGE_CONFIG
}
```

### Build Order for Catalog Subpages

Dependencies must be completed in this sequence:

1. **Zoho subcategory tagging** (data/ops step) — populate "Subcategory" custom field in Zoho Inventory for each item in Grain/Yeast/Additive/Packaging/Equipment categories. Run `npm run snapshot` after tagging to refresh `content/zoho-snapshot.json`. This gates all JS filtering validation.

2. **`css/catalog-subpage.css`** — write shared CSS. No code dependencies.

3. **`js/modules/16-catalog-subpage.js`** — write JS module. Depends on: cart globals from main.js, Fuse from vendor, `SUBPAGE_CONFIG` from inline script. Does not require subpage HTML to exist yet.

4. **`package.json` build script updates** — add `catalog-subpage` to `minify:css`, add terser call for `16-catalog-subpage.js` to `minify:js`, add new HTML files to `stamp:pages`.

5. **`products/ingredients/grains.html`** (and the other 4) — write HTML shells with `SUBPAGE_CONFIG`, sub-nav, hero, catalog container, cart drawer HTML. Requires CSS class names and JS config shape from steps 2–3.

6. **`products/ingredients-supplies.html`** — add sub-nav block. Can be done any time after sub-nav HTML is finalized.

7. **`npm run build`** — generates all minified artifacts and stamps cache versions.

8. **Write tests** — unit tests for pure functions in `16-catalog-subpage.js` (filter, sort, grouping). Follow existing pattern in `tests/frontend/`.

### Component Boundaries

| Component | Responsibility | Depends On |
|-----------|---------------|------------|
| `16-catalog-subpage.js` | Data fetch, category filter, Fuse search, render grid/list, wire events, search overlay | `main.min.js` globals, `fuse.min.js`, `SUBPAGE_CONFIG` |
| `css/catalog-subpage.css` | Sub-nav layout, hero accent, catalog grid, search overlay panel | None |
| `products/ingredients/X.html` | Page shell, SUBPAGE_CONFIG inline var, static sub-nav HTML | `styles.min.css`, `catalog-subpage.min.css`, `main.min.js`, `16-catalog-subpage.min.js` |
| `13-init.js` (modified) | DOMContentLoaded dispatch for new page types, `initCartDrawer()` | Existing cart module |
| `/api/ingredients` (unchanged) | Returns full ingredient array | Zoho Inventory with subcategory CF populated |

### Key Integration Points with Existing Code

**`renderWeightControl` / `renderReserveControl`**: Called inside `16-catalog-subpage.js` when rendering product cards. Weight items (grain) use `renderWeightControl`; unit items (yeast packets, etc.) use `renderReserveControl`. The `_item_type: 'ingredient'` field must be set on each product object so `getCartKey()` routes to `sv-cart-ingredients`.

**`initCartDrawer()`**: Called by `13-init.js` for the new page types, exactly as it is for hops. Cart drawer HTML is duplicated in each HTML file.

**`reservation-changed` event**: `13-init.js` already listens globally and calls `refreshAllReserveControls()`, `updateReservationBar()`, `renderCartDrawer()`. The subpage module benefits from this automatically — no additional wiring needed.

**Fuse.js**: Already in `js/vendor/fuse.min.js`. Each HTML file loads it with `defer` before `16-catalog-subpage.min.js`. The module guards initialization with `typeof Fuse !== 'undefined'` (same pattern as `08-catalog-ingredients.js` line 120 and `15-hops.js` line 319).

**localStorage cache isolation**: Use key prefix `sv-subpage-{pageId}-mw` (e.g. `sv-subpage-grains-mw`). Avoids collision with `sv-ingredients-mw` (main ingredients tab) and `sv-hops-mw` (hops page).

**Snapshot fallback**: `loadFromSnapshot()` fetches `/content/zoho-snapshot.json` and reads `snap.ingredients`, then applies the category filter. Path must be root-relative `/content/zoho-snapshot.json` (not `../../content/`) to work from `products/ingredients/` when served via GitHub Pages.

### Anti-Patterns to Avoid

**Do not add 5 separate standalone JS modules.** One parameterized module is the correct abstraction. Five files create maintenance debt immediately.

**Do not put sub-nav in `13-init.js` as a dynamic render.** Static HTML is correct for a static site with no server-side templating.

**Do not add `catalog-subpage.js` to `concat:js`.** It is only needed on 5 specific pages; adding it to the main bundle wastes payload on every other page.

**Do not create new middleware endpoints per category.** The existing `/api/ingredients` endpoint is cached in Redis and covers all items. Client-side filtering is adequate for this data volume.

**Do not attempt to share localStorage cache across subpages via a shared full-dataset key.** Per-page isolated caches are simpler and match the hops precedent.

---

## Standard Architecture (v1/v2 — Recipe-Based Products)

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

**Confidence: MEDIUM** — BeerXML format is well-documented and stable. The matching step is the unknown complexity.

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

**The brewing fee:** Add a new Zoho Inventory "service" item called "Brewing Fee" (non-inventory, type=service). Reference its `item_id` as `BREWING_FEE_ITEM_ID` env var. This mirrors the existing `MAKERS_FEE_ITEM_ID` pattern exactly.

**Confidence: HIGH** — per-ingredient deduction is how the existing online checkout handles ingredients.

---

### 5. BrewPad Recipe Integration

**New Sheets tab: "Recipes" only. The "Batches" tab gets a new `recipe_id` column.**

The Batches sheet currently has 24 columns. Add `recipe_id` as column 25:

```javascript
// In createBatch() — new column appended:
batchesSheet.appendRow([
  ...existing 24 columns...,
  sanitizeInput(payload.recipe_id || '')  // col 25: recipe_id
]);
```

**Batch creation trigger for recipe sales:** Currently `detectKitItems()` requires `MAKERS_FEE_ITEM_ID` to be present (wine kit trigger). Recipe sales use `BREWING_FEE_ITEM_ID` instead. The correct approach is a separate `detectRecipeSale()` function — recipe batches (one batch per recipe) and wine kit batches (one batch per kit line item) have different cardinality. Merging them in `detectKitItems()` would create multiple batches for a recipe sale.

**Confidence: HIGH** — the Sheets + Apps Script pattern is well-understood.

---

### 6. Recipe Browsing on Public Site

**Recommendation: New product type "recipe" rendered by a new module `14-recipes.js`.**

Recipes are NOT Zoho products. They live in the Recipes Sheets tab, fetched via Apps Script `get_recipes` (new action). Recipe cards use the `.label-beer` card style with style-based tint class from `getTintClass()`. A recipe card shows: Name, style, ABV, batch size, ingredient count, brewing fee, "Reserve This Recipe" button (triggers kiosk consultation CTA, not direct online cart add — kiosk-first per PROJECT.md).

**Products page integration:** Add a "Recipes" tab alongside "Ferment in Store", "Ingredients", "Services" in `10-tabs.js`. The "Reserve" button shows a modal: "Visit us in store to brew this recipe — call XXX or book a time."

**Confidence: MEDIUM** — rendering is straightforward but Apps Script fetch for public recipes introduces a new data source on the public site.

---

## New vs Modified Components (v2.0 Recipes)

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

### Modified Components (v2.0)

| Component | Change | Risk |
|-----------|--------|------|
| `zoho-middleware/lib/brewpad-integration.js` | Extend `detectKitItems()` to handle recipe sales; add `recipe_id` to batch payload | LOW — additive only |
| `zoho-middleware/lib/constants.js` | Add `CACHE_KEYS.RECIPES` | LOW |
| `js/kiosk.js` | Add recipe browser tab, `kioskLoadRecipe()`, `_kioskActiveRecipeId` | MEDIUM — existing cart logic must be preserved |
| `js/admin.js` | Add recipe management tab: list, create, import BeerXML, edit | MEDIUM — admin IIFE is large, follow existing tab pattern |
| `apps-script/adminApi.gs` | Add `recipe_id` column to Batches sheet, add recipe CRUD actions | LOW-MEDIUM — column append is safe; schema change needs coordination |
| `js/modules/10-tabs.js` | Add "Recipes" tab to public product page tab set | LOW |

### New Components (v3.0 Catalog Subpages)

| Component | Type | Purpose |
|-----------|------|---------|
| `js/modules/16-catalog-subpage.js` | New file | Shared standalone module for all 5 subpages |
| `js/modules/16-catalog-subpage.min.js` | Build artifact | Minified via terser |
| `css/catalog-subpage.css` | New file | Sub-nav, hero accent, catalog grid, search overlay |
| `css/catalog-subpage.min.css` | Build artifact | Minified via cleancss |
| `products/ingredients/grains.html` | New file | Grains category subpage |
| `products/ingredients/yeast.html` | New file | Yeast category subpage |
| `products/ingredients/additives.html` | New file | Additives category subpage |
| `products/ingredients/packaging.html` | New file | Packaging category subpage |
| `products/ingredients/equipment.html` | New file | Equipment category subpage |

### Modified Components (v3.0)

| Component | Change | Risk |
|-----------|--------|------|
| `js/modules/13-init.js` | Add `grains`/`yeast`/`additives`/`packaging`/`equipment` page dispatch | LOW — additive branch |
| `products/ingredients-supplies.html` | Add ingredient sub-nav block | LOW — HTML addition only |
| `package.json` | Add CSS minify, JS minify, stamp:pages entries for new files | LOW |

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

### Catalog Subpage Data Flow

```
products/ingredients/grains.html loads
  ↓
SUBPAGE_CONFIG = { category: 'Grain', pageId: 'grains', ... } (inline script)
  ↓
main.min.js + 16-catalog-subpage.min.js execute (deferred)
  ↓
loadSubpageItems(SUBPAGE_CONFIG):
  → Check localStorage 'sv-subpage-grains-mw' (30 min TTL)
  → If stale/missing: GET /api/ingredients
  → Filter: items where item.subcategory === 'Grain'
  → Initialize Fuse over filtered set
  → renderSubpageItems()
  → Wire search/sort/filter events
  ↓
User types in cross-category search:
  → Check all 'sv-subpage-*-mw' localStorage entries for warm cache
  → If none warm: GET /api/ingredients once
  → Fuse search across full dataset
  → Render overlay grouped by category
```

---

## Architectural Patterns to Follow

### Pattern 1: Standalone Module with Inline Config

**What:** One JS file handles all 5 subpages by reading a `SUBPAGE_CONFIG` object defined inline in each HTML file before the module script loads.
**When:** Multiple structurally identical pages that differ only in category filter value and hero accent.
**Precedent:** `SHEETS_CONFIG` in `sheets-config.js` (global config object read by modules).

### Pattern 2: Recipe as Ingredient Collection (Not Composite Item)

**What:** A recipe is a named collection of `{item_id, quantity, unit}` tuples stored in Google Sheets.
**When:** Always for this system.
**Trade-offs:** Requires fuzzy matching on BeerXML import; ingredient item_ids must stay stable.

### Pattern 3: Fee Item via Env Var (Mirror Existing Pattern)

**What:** Create one Zoho "service" item for the brewing fee. Store its `item_id` in `BREWING_FEE_ITEM_ID`. The kiosk auto-adds it when a recipe is loaded, exactly as `kioskSyncKitFees()` does for Maker's Fee.

### Pattern 4: Static Sub-Nav HTML (No Dynamic Render)

**What:** Sub-nav block duplicated as static HTML in each ingredient page. Active state set via CSS `body[data-page]` scoping. No JS required.
**When:** Any static multi-page nav on a GitHub Pages site with no SSI.
**Trade-offs:** Requires updating all files when nav items change. Document which files in CLAUDE.md.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Zoho Composite Items for Recipe Inventory

**What people might do:** Create a Zoho composite item per recipe, then sell the composite item on the kiosk invoice.
**Why it's wrong:** The Zoho Inventory REST API does not support composite items as invoice line items. Composite items require a separate "assembly" workflow.
**Do this instead:** Sell each ingredient as a separate line item on the Zoho invoice.

### Anti-Pattern 2: 5 Separate Standalone Modules for Subpages

**What people might do:** Create `16-grains.js`, `17-yeast.js`, `18-additives.js`, etc.
**Why it's wrong:** The pages are structurally identical. Five files mean five copies of every bug fix and enhancement.
**Do this instead:** One parameterized `16-catalog-subpage.js` with `SUBPAGE_CONFIG`.

### Anti-Pattern 3: Dynamic Sub-Nav Rendering

**What people might do:** Generate the sub-nav in JS after data loads.
**Why it's wrong:** Creates flash of missing nav; HTML is no longer self-describing.
**Do this instead:** Static HTML in each file; CSS `body[data-page]` scoping for active state.

### Anti-Pattern 4: Per-Category Middleware Endpoints

**What people might do:** Add `/api/ingredients/grains`, `/api/ingredients/yeast`, etc.
**Why it's wrong:** New cache keys, new Redis memory, new Railway surface, new tests with no benefit for this data volume.
**Do this instead:** Client-side filter on the existing `/api/ingredients` response.

### Anti-Pattern 5: Auto-Triggering Recipe Batch via Maker's Fee Detection

**What people might do:** Add `BREWING_FEE_ITEM_ID` to `detectKitItems()` alongside `MAKERS_FEE_ITEM_ID`.
**Why it's wrong:** Wine kit batches (one per kit item) and recipe batches (one per recipe) have different cardinality. This would create multiple batches for a recipe sale.
**Do this instead:** Separate `detectRecipeSale()` function; recipe sales call `createBatchFromRecipeSale()`.

---

## Integration Points with External Services

| Service | Integration Pattern | Subpage-Specific Notes |
|---------|---------------------|----------------------|
| `/api/ingredients` (Railway) | GET, cached in Redis | Unchanged; subpages filter client-side |
| `content/zoho-snapshot.json` | Static file fetch | Subpages use root-relative path `/content/zoho-snapshot.json` |
| Google Apps Script | Recipe CRUD via `action=` params | Not involved in subpages |
| Zoho Inventory | Per-ingredient `item_id` on kiosk invoice | Not changed for subpages |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Module pattern (standalone) | HIGH | Directly matches `15-hops.js` precedent, verified in source |
| Data flow via `/api/ingredients` | HIGH | Verified in `catalog.js`, `08-catalog-ingredients.js`, `15-hops.js` |
| Subcategory field availability | MEDIUM | `flattenCF` maps it from Zoho CF — requires Zoho items to have field populated first |
| CSS strategy (shared file) | HIGH | Pattern consistent with existing per-page CSS files |
| Build script changes | HIGH | Verified all four explicit lists from `package.json` |
| Search overlay (reuse cached data) | MEDIUM | Correct in principle; exact UX interaction design TBD in phase |
| Sub-nav as static HTML | HIGH | No SSI/templating on static site — duplication is unavoidable |

---

## Sources

- Direct codebase analysis: `js/modules/08-catalog-ingredients.js`, `js/modules/15-hops.js`, `js/modules/13-init.js`, `js/modules/11-cart.js`, `zoho-middleware/routes/catalog.js`, `package.json`, `hops.html`, `products/ferment-in-store.html`
- [Zoho Inventory Composite Items API](https://www.zoho.com/inventory/api/v1/compositeitems/) — confirmed composite items are not line-itemizable in Sales Orders/Invoices via REST API
- [beerxml npm package](https://www.npmjs.com/package/beerxml) — lightweight BeerXML 1.0 parser for Node.js
- [BeerXML Standard](https://beerxml.com/) — BeerXML 1.0 schema reference

---

*Architecture research for: Steins & Vines catalog subpages + recipe-based product system*
*Originally: 2026-05-09 | Updated for v3.0 catalog subpages: 2026-05-27*
