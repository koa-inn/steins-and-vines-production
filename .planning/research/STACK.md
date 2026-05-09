# Stack Research

**Domain:** Recipe-based fermentation products — ingredient collections, BeerXML import, kiosk sales, inventory deduction
**Researched:** 2026-05-09
**Confidence:** HIGH for core additions; MEDIUM for Apps Script schema expansion; HIGH for Zoho deduction mechanism

---

## Context: What Already Exists (Do Not Rebuild)

The existing stack is locked by constraint. This document covers only **new additions**.

| Layer | Existing | Status |
|-------|----------|--------|
| Frontend | Vanilla JS ES5, `var`, module concat via build | Locked |
| Build | cleancss + terser + `npm run build` | Locked |
| Backend | Express.js on Railway | Locked |
| Batch/recipe data | Google Apps Script + Sheets (adminApi.gs) | Extend only |
| Inventory | Zoho Inventory API (OAuth, via middleware) | Extend only |
| Auth | Google OAuth GSI | Locked |
| Cache | Redis (redis@5) on Railway | Locked |
| Payments | Helcim | Locked |

---

## New Stack Additions

### 1. BeerXML Parsing (Middleware)

**Recommendation: `fast-xml-parser` v4.x already in ecosystem via AWS SDK deps; add explicitly at `^4.5.0`**

Do NOT use `beerxml` (npm) or `brauhaus-beerxml`. Both are abandoned (last publish 6+ years ago, Node 0.8 era target). BeerXML 1.0 is simple, well-documented XML — it does not need a dedicated parser library.

BeerXML structure is predictable:
```
<RECIPES>
  <RECIPE>
    <NAME>, <STYLE>, <BATCH_SIZE>, <BOIL_TIME>, <OG>, <FG>, <COLOR>, <IBU>
    <HOPS><HOP> — NAME, AMOUNT (kg), USE, TIME, ALPHA
    <FERMENTABLES><FERMENTABLE> — NAME, AMOUNT (kg), TYPE, COLOR, PPG
    <YEASTS><YEAST> — NAME, FORM, ATTENUATION, LABORATORY
    <MISCS><MISC> — NAME, AMOUNT, USE, TYPE
  </RECIPE>
</RECIPES>
```

`fast-xml-parser` at v4.x parses this to a plain JS object in one call. No callbacks, no streaming, no schemas. BeerXML files are small (< 50 KB for any real recipe), so performance is irrelevant — but `fast-xml-parser` is the only widely-maintained pure-JS XML parser (70M downloads/week as of 2025, active development through v5+).

The parse result maps directly to a recipe data model with a short normalization function. Write this normalization in middleware (`zoho-middleware/lib/beerxml.js`) where you control the output shape — never expose raw BeerXML structure to the frontend.

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `fast-xml-parser` | `^4.5.0` | Parse BeerXML files uploaded via admin | Only maintained pure-JS XML parser; v4 API is stable; no native deps |

Install in middleware only:
```bash
cd zoho-middleware && npm install fast-xml-parser@^4.5.0
```

---

### 2. Recipe Data Storage (Google Apps Script + Sheets)

**Recommendation: Two new sheet tabs in the existing Steins & Vines spreadsheet — `Recipes` and `RecipeIngredients`**

The existing `adminApi.gs` already implements a multi-tab pattern (`Batches`, `FermSchedules`, `BatchTasks`, `PlatoReadings`, `VesselHistory`). Recipes follow exactly the same pattern. No new infrastructure.

**Schema:**

`Recipes` tab columns:
```
recipe_id | name | style | batch_size_l | og | fg | ibu | color_srm | fee_amount | fee_label | notes | source | created_at | updated_at | status
```

`RecipeIngredients` tab columns:
```
row_id | recipe_id | ingredient_type | name | amount_kg | use_phase | zoho_item_id | zoho_sku | matched_at
```

`ingredient_type` values: `fermentable`, `hop`, `yeast`, `misc`
`use_phase` values: `mash`, `boil`, `fermentation`, `dry_hop`, `other`
`zoho_item_id` and `zoho_sku` are populated during the "match ingredients to Zoho" step (can be blank at import time and filled later in admin)

**Why two tabs instead of JSON blob in one tab:**
- Zoho ingredient matching needs to query by `zoho_item_id` across all recipes (to find "what recipes use this SKU")
- BrewPad batch linking needs to join recipe → ingredients to build the deduction list
- A flat ingredient blob in one column is unqueryable by Apps Script without parsing JSON on every row

**Why Apps Script / Sheets instead of middleware storage:**
- Batches already live there; recipes linking to batches must be co-located
- Staff can view/edit raw data in Sheets as a fallback (resilience)
- No new Railway data service needed

New Apps Script functions to add to `adminApi.gs`:
- `createRecipe(payload)` — write to Recipes + RecipeIngredients tabs
- `getRecipe(recipe_id)` — read recipe + its ingredients
- `listRecipes(filters)` — list with status filter
- `updateRecipe(payload)` — update recipe row + replace ingredient rows
- `deleteRecipe(recipe_id)` — soft-delete (set status=archived)
- `matchIngredient(recipe_id, row_id, zoho_item_id, zoho_sku)` — update single ingredient row with Zoho mapping

---

### 3. Recipe API Routes (Middleware)

**Recommendation: New Express router `zoho-middleware/routes/recipes.js`**

This is purely additive. Pattern matches existing routes (`catalog.js`, `pos.js`, `checkout.js`).

New endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/recipes/import` | Accept BeerXML file upload, parse, return structured JSON for admin review |
| `POST` | `/api/recipes` | Create recipe (calls Apps Script `createRecipe`) |
| `GET` | `/api/recipes` | List recipes (public: status=active only; staff: all) |
| `GET` | `/api/recipes/:id` | Get recipe + ingredients |
| `PUT` | `/api/recipes/:id` | Update recipe |
| `DELETE` | `/api/recipes/:id` | Archive recipe |
| `POST` | `/api/recipes/:id/match-ingredient` | Map an ingredient row to a Zoho SKU |
| `GET` | `/api/recipes/:id/availability` | Check Zoho stock levels for all ingredient SKUs in the recipe |

The `/api/recipes/import` endpoint needs `multer` to handle multipart file upload. BeerXML files come from BeerSmith as `.xml` file attachments.

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `multer` | `^1.4.5-lts.1` | Multipart file upload for BeerXML import | Industry standard Express multipart middleware; LTS version avoids 2.x breaking changes |

```bash
cd zoho-middleware && npm install multer@^1.4.5-lts.1
```

**File size limit:** Set `multer` `limits.fileSize` to 500KB. BeerSmith exports are typically 10–50 KB. This blocks accidental wrong file uploads cleanly.

**Storage:** Use `multer.memoryStorage()` — parse the XML in-memory and discard. Do not write BeerXML files to disk on Railway (ephemeral filesystem).

---

### 4. Inventory Deduction Mechanism (Zoho)

**Recommendation: Use Zoho Inventory Item Adjustments API with multi-line negative quantity adjustment**

Two approaches were evaluated:

**Option A: Sales Order per recipe sale (multi-line)**
Creating a multi-line sales order (one line per ingredient) and then invoicing it triggers inventory deduction. But this creates financial records in Zoho Books for in-store ingredient pulls that are internal cost movements, not customer sales. It also requires a Zoho customer record per sale and complicates reporting.

**Option B: Item Adjustment with negative quantities (recommended)**
`POST /api/v1/itemadjustments` with `adjustment_type: "quantity"` and `quantity_adjusted: -N` per ingredient. A single API call covers all ingredients in the recipe. Reason field carries the recipe name + batch ID for audit trail.

The existing middleware already has Zoho OAuth handling. Add a function `deductRecipeIngredients(recipe_id, batch_id, zoho_auth_token)` to a new or existing lib file that:
1. Fetches the recipe + ingredients from Apps Script
2. Groups by `zoho_item_id` (in case a recipe uses the same SKU multiple times via different ingredient types)
3. Makes one `POST /itemadjustments` call with all line items
4. Returns the adjustment_id for the batch audit record

**OAuth scope required:** `ZohoInventory.inventoryadjustments.CREATE`

This scope is additive to existing scopes — verify it is included when re-authorizing Zoho OAuth. The existing `zoho-middleware/routes/auth.js` manages scope list.

**Timing:** Deduction happens when a kiosk recipe sale is confirmed (same point where the batch is created). Not at recipe browsing or cart add.

No new npm packages needed for this — uses existing `axios` calls.

---

### 5. Admin Interface (Vanilla JS IIFE, no framework)

**Recommendation: New IIFE section in `js/admin.js` — follow existing BrewPad/Kiosk pattern**

The admin interface for recipe management is a new tab in `admin.html` following the same pattern as the existing Batches tab. No new files, no new framework.

Key UI patterns already available in the codebase to reuse:
- Modal overlays (existing in admin.js)
- Table render with action buttons (existing batch list pattern)
- Form with field validation (existing batch create form)
- Ingredient row list with inline edit (new, but same DOM pattern as task lists)

The BeerXML import flow in admin:
1. File input `<input type="file" accept=".xml">` → `FileReader.readAsText()` → `POST /api/recipes/import`
2. Server returns structured recipe object with ingredient list
3. Admin reviews, can rename ingredients, sets fee
4. Admin clicks "Match to Zoho" per ingredient → searches live Zoho catalog → selects SKU
5. Admin saves recipe → `POST /api/recipes`

**No new JS libraries.** `FileReader` is native browser API, available in all modern browsers including iPad Safari. No dependency needed.

---

### 6. Public Browsing (Vanilla JS, new catalog section)

**Recommendation: New JS module `js/modules/14-catalog-recipes.js` in existing concat pipeline**

Follows the exact pattern of `07-catalog-kits.js` and `08-catalog-ingredients.js`. Fetches from `/api/recipes` (public endpoint, no auth), renders using existing card infrastructure.

Recipe cards use the existing `.label-beer` card type (already implemented in `04-label-cards.js`).

Add `recipes.html` as a new public page, or extend `products.html` with a "Beer Recipes" tab using the existing 10-tabs.js system. The tab system already supports dynamic tab visibility — recipes tab can be hidden until federal brewing licence is granted.

**No new npm packages needed.**

---

### 7. Kiosk Recipe Sales (Vanilla JS IIFE extension)

**Recommendation: Extend `js/kiosk.js` with a recipe selection flow**

The kiosk flow for recipe sales:
1. Staff selects "Beer Recipe" product category tab
2. Recipe list loads from `/api/recipes`
3. Staff selects recipe → ingredient list displays with quantities
4. Cart auto-populates with each ingredient at its quantity (using existing `setReservationQty` or equivalent kiosk cart logic)
5. Brewing fee line item added
6. Sale proceeds through existing Helcim POS terminal flow
7. On success: `POST /api/kiosk/sale` extended to handle recipe sales → triggers ingredient deduction + batch creation

The kiosk-to-batch bridge already exists (kiosk sale → middleware → Apps Script `createBatch`). Recipe sales extend this: the batch is created with `recipe_id` reference.

**No new npm packages needed for frontend.**

Middleware extension: Add recipe sale handling to `zoho-middleware/routes/pos.js` or a new `zoho-middleware/routes/recipe-sales.js`. On recipe sale confirmation:
1. `deductRecipeIngredients()` call
2. `createBatch()` call with recipe_id
3. Response includes batch_id for kiosk receipt display

---

### 8. BrewPad Recipe Linking

**Recommendation: Add `recipe_id` field to Batches sheet + batch creation payload**

The `Batches` sheet already has columns for product/customer info. Adding `recipe_id` (nullable) to the batch row is a non-breaking schema change. Existing batches have blank recipe_id.

BrewPad batch detail view shows recipe info when `recipe_id` is present:
- Recipe name, style, target OG/FG
- Ingredient list used (from RecipeIngredients tab)
- Link to recipe admin view

This is a data-layer addition — the Apps Script `createBatch` and `getBatch` functions need the `recipe_id` field threaded through. No new infrastructure.

---

## Complete New Dependency List

### Middleware (zoho-middleware/package.json)

| Package | Version | Purpose |
|---------|---------|---------|
| `fast-xml-parser` | `^4.5.0` | BeerXML parsing at import |
| `multer` | `^1.4.5-lts.1` | BeerXML file upload handling |

```bash
cd zoho-middleware && npm install fast-xml-parser@^4.5.0 multer@^1.4.5-lts.1
```

### Frontend (root package.json)

**No new npm packages.** All frontend work uses:
- Native `FileReader` API (BeerXML file reading)
- Existing build pipeline (concat + terser)
- Existing card rendering system
- Existing tab system

### Google Apps Script

**No new external dependencies.** New sheet tabs and functions only.

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `beerxml` npm package | Abandoned 2019, targets Node 0.8, no maintenance | `fast-xml-parser` + custom normalization |
| `brauhaus-beerxml` npm package | Abandoned, brings in Brauhaus.js dependency tree for a 20-line parse | `fast-xml-parser` + custom normalization |
| `xml2js` | Callback-based, heavier than needed for predictable BeerXML structure | `fast-xml-parser` |
| React/Vue/any framework | Violates hard stack constraint, cannot mix with ES5 `var` codebase | Vanilla JS IIFE pattern |
| New database (Postgres, SQLite, etc.) | Recipes co-locate with batches in Sheets; adding a DB adds Railway service, secrets, migration tooling | Apps Script + Sheets (existing) |
| Zoho Sales Orders for deduction | Creates financial records for internal ingredient pulls, wrong abstraction | Zoho Item Adjustments API with negative qty |
| multer v2.x | Major breaking changes, still stabilizing | multer@^1.4.5-lts.1 (LTS line) |
| BeerJSON | BeerSmith exports BeerXML 1.0 only; BeerJSON is not widely supported by brewing software | BeerXML 1.0 |

---

## Integration Points and Constraints

**Zoho OAuth scope:** The recipe deduction path needs `ZohoInventory.inventoryadjustments.CREATE`. Current scope set should be audited at implementation time. If missing, Zoho re-auth is required (one-time, non-breaking).

**Apps Script deployment:** Every change to `adminApi.gs` requires a new deployment in the Google Apps Script editor. The deployed URL changes on major version bumps — verify the URL in `sheets-config.js` is current after any deployment.

**Licence gating:** The federal brewing licence is pending. The recipes tab on the public site and the kiosk recipe sales flow must be feature-flagged (similar to the existing `PAYMENT_DISABLED` flag in `01-config.js`). A `BEER_RECIPES_ENABLED` flag in `01-config.js` and a corresponding env var in the middleware will control visibility without requiring a code deploy.

**Ingredient matching is a one-time staff task:** BeerSmith recipes use ingredient names like "Pale Malt (2 Row) US" which will not match Zoho SKU names automatically. The admin must map each ingredient name to a Zoho SKU on first import. Matched mappings persist in `RecipeIngredients.zoho_item_id`. A future enhancement could cache common name → SKU mappings in a `IngredientAliases` sheet tab, but that is out of scope for this milestone.

**Stock availability check before sale:** The kiosk should call `/api/recipes/:id/availability` before confirming a recipe sale. This checks current Zoho stock for each ingredient SKU. If any ingredient is below the required quantity, display a staff alert (not a hard block — staff may have physical stock not yet reconciled in Zoho).

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `fast-xml-parser@^4.5.0` | Node.js 14+ | Railway runs Node 18+; no issue |
| `multer@^1.4.5-lts.1` | `express@^4.x` | LTS line maintained for Express 4; do not upgrade to multer 2.x until Express 5 is adopted |
| `fast-xml-parser@^4.x` | `fast-xml-parser@^5.x` | API is largely compatible but v5 has some option renames; pin to `^4.5.0` to avoid surprise upgrades |

---

## Sources

- [fast-xml-parser GitHub](https://github.com/NaturalIntelligence/fast-xml-parser) — version confirmed at 5.7.x active, v4 LTS stable; HIGH confidence
- [fast-xml-parser npm](https://www.npmjs.com/package/fast-xml-parser) — 70M+ weekly downloads, active maintenance; HIGH confidence
- [BeerXML Standard](https://beerxml.com/) — official specification, structure confirmed; HIGH confidence
- [brauhaus-beerxml GitHub](https://github.com/homebrewing/brauhaus-beerxml) — 4 commits total, targets Node 0.8, abandoned; HIGH confidence (avoid)
- [beerxml npm](https://www.npmjs.com/package/beerxml) — last published 6+ years ago; HIGH confidence (avoid)
- [Zoho Inventory Item Adjustments API](https://www.zoho.com/inventory/api/v1/itemadjustments/) — confirmed multi-line support, negative quantity deduction; HIGH confidence
- [Zoho Inventory stock deduction timing](https://www.zoho.com/us/inventory/kb/items/item-decrease.html) — confirmed invoice path vs. adjustment path; HIGH confidence
- [Zoho Inventory Sales Orders API](https://www.zoho.com/inventory/api/v1/salesorders/) — confirmed multi-line item support; MEDIUM confidence (deduction timing requires invoice step)
- Existing codebase inspection (`adminApi.gs`, `package.json`, `routes/`, `js/modules/`) — HIGH confidence (direct source read)

---

*Stack research for: Steins & Vines v2.0 Recipe-Based Products*
*Researched: 2026-05-09*
