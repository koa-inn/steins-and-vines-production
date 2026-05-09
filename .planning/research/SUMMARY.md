# Project Research Summary

**Project:** Steins & Vines — Recipe-Based Ferment-in-Store Products (v2.0)
**Domain:** Recipe-based fermentation product system integrated into existing POS and fermentation management platform
**Researched:** 2026-05-09
**Confidence:** HIGH (stack and architecture directly verified against codebase; features validated against live competitor sites; pitfalls verified against official APIs and BeerXML spec)

## Executive Summary

Steins & Vines is adding beer recipe products to an existing ferment-in-store system built on vanilla JS / Express / Google Sheets / Zoho Inventory / Helcim. The recipe system allows staff to define named beer recipes (grain bill, hops, yeast, brewing fee), sell them through the kiosk by auto-populating an ingredient cart, deduct inventory in Zoho per ingredient, and auto-create a batch in BrewPad. All existing stack constraints are locked — the work is purely additive within those constraints. The two new dependencies required are `fast-xml-parser` and `multer` in the middleware only; the frontend requires no new packages.

The recommended approach treats a recipe as a named collection of Zoho ingredient references stored in Google Sheets, not a Zoho composite item or custom catalog entry. This is the critical architectural decision: Zoho composite items are designed for physical assembly workflows and do not auto-deduct components via the REST API invoice path. The existing per-ingredient line-item pattern used by the ingredients checkout already works correctly and simply scales to recipe sales. The recipe data store (Google Sheets "Recipes" tab + Apps Script CRUD) mirrors the proven Batches pattern already in production. All inventory deduction flows through the existing Zoho invoice path — no new Zoho API mechanisms are needed.

The two highest risks are (1) the inventory race condition when a multi-ingredient recipe sale runs concurrently with other ingredient sales, and (2) the BrewPad batch detection logic creating one batch per ingredient instead of one per recipe. Both must be designed and gated before the first recipe sale is processed. The federal brewing licence is also pending — a `BEER_SALES_ENABLED` env var gate must be in place before any recipe feature ships to production. The phased build order is: recipe data model and feature flag first, then admin CRUD and middleware API, then kiosk sale flow, then BeerXML import, then public browsing.

## Key Findings

### Recommended Stack

The stack is locked. New additions are minimal: `fast-xml-parser@^4.5.0` and `multer@^1.4.5-lts.1` in the middleware for BeerXML import handling. Both are mature, widely-maintained packages. All other recipe work uses existing infrastructure — the same Apps Script + Sheets pattern for data storage, the same Express route pattern for the API, the same vanilla JS IIFE pattern for admin and kiosk UI, the same Zoho invoice line-items path for inventory deduction.

**Core technologies (new additions only):**
- `fast-xml-parser@^4.5.0`: BeerXML parsing at import endpoint — only maintained pure-JS XML parser (70M+ weekly downloads); Node 18+ compatible; v4 LTS API is stable
- `multer@^1.4.5-lts.1`: Multipart file upload for BeerXML import — LTS line avoids multer 2.x breaking changes; use `memoryStorage()` (Railway filesystem is ephemeral); 500KB file size limit
- Google Sheets "Recipes" tab: Recipe data store — extends existing Batches pattern; staff-accessible fallback; no new Railway service
- `zoho-middleware/routes/recipes.js` (new): Recipe CRUD API — mirrors existing route file patterns
- `js/modules/14-recipes.js` (new): Public recipe browser — mirrors existing `07-catalog-kits.js` pattern
- New Zoho "Brewing Fee" service item + `BREWING_FEE_ITEM_ID` env var: Fee line item on recipe sales — mirrors existing Maker's Fee pattern exactly

**Explicitly avoided:**
- `beerxml` and `brauhaus-beerxml` npm packages — abandoned, Node 0.8 era targets
- Zoho composite items — require separate assembly workflow, incompatible with REST API invoice line-item deduction
- Any new database or React/Vue framework — violates stack constraints

### Expected Features

**Must have — v2.0 kiosk launch (P1):**
- Recipe data model in Google Sheets (name, style, ABV/IBU/colour, ingredient list with Zoho SKUs, locked_price, brewing_fee, status)
- Ingredient-to-SKU mapping — keystone dependency; every other feature depends on BeerXML names resolving to Zoho item_ids
- Admin recipe CRUD — create, edit, activate/deactivate; ingredient line items editable per recipe
- Public recipe browsing — recipe cards on products page using existing `.label-beer` card type
- Kiosk recipe sale — select recipe → ingredients auto-populate kiosk cart → brewing fee added → Helcim checkout → Zoho multi-line invoice → ingredient stock deducted
- Batch auto-creation in BrewPad on recipe sale — recipe_id + recipe_snapshot linked to batch
- Feature flag `BEER_SALES_ENABLED` — env var gate on Railway, defaults false, no code deploy to toggle

**Should have — v2.1 (P2):**
- BeerXML import (upload .xml → parse → staff reviews ingredient mappings → saves draft recipe) — accelerates recipe setup but not a gate since recipes can be entered manually
- Custom recipe consultation request form — public-facing contact form, triggers staff notification

**Defer — v2.2+ (P3):**
- Staff ad-hoc recipe builder (live ingredient picker without pre-registered recipe)
- Online checkout for recipe products (awaiting federal brewing licence)
- Recipe versioning / changelog

**Anti-features (never build):**
- Customer self-serve recipe builder — consultation model is correct; customers need staff guidance
- Dynamic pricing computed from live Zoho ingredient rates — use `locked_price`; live rate summation exposes price volatility and erodes margin transparency
- Zoho composite items per recipe — wrong abstraction for this workflow

**Competitive context:** Terminal City Brewing (Vancouver) offers 40+ named styles at $170–$215 per 48L batch — flat per-batch pricing with all fees embedded. This validates the flat `locked_price` approach over dynamic ingredient-sum pricing.

### Architecture Approach

Recipe data lives in Google Sheets ("Recipes" tab with `locked_price`, `brewing_fee`, `status`, `ingredients` JSON column). The middleware resolves a recipe_id to its ingredient list server-side, never trusting the client to supply ingredient details. The kiosk receives a recipe object, populates its local `_kioskCart`, and proceeds through the existing Helcim terminal flow unchanged. The Zoho invoice is created with individual ingredient line items plus a brewing fee service line — identical to how the existing ingredient checkout works. BrewPad batch creation for recipe sales uses a separate explicit code path (`createBatchFromRecipeSale`) rather than `detectKitItems` — mandatory because cardinality differs (one batch per recipe, not one per line item).

**Major components:**

1. **Google Sheets "Recipes" tab + Apps Script CRUD** — recipe definitions; new `create_recipe`, `get_recipes`, `update_recipe` actions in existing `adminApi.gs`; `recipe_id` + `recipe_snapshot` column added to Batches tab
2. **`zoho-middleware/routes/recipes.js`** — REST API for recipe CRUD and BeerXML parse; Redis cache `sv:recipes` (5-min TTL); mirrors existing catalog route pattern
3. **`js/admin.js` — new Recipes tab** — staff recipe management UI: list, create/edit form, BeerXML import modal; follows existing admin IIFE tab pattern
4. **`js/kiosk.js` (modified)** — `kioskLoadRecipe()` populates `_kioskCart` from recipe ingredients + brewing fee; `_kioskActiveRecipeId` for downstream batch creation; recipe sale bypasses the public dual-cart entirely
5. **`brewpad-integration.js` (modified)** — new `detectRecipeSale()` + `createBatchFromRecipeSale()` path; `recipe_snapshot` JSON stored on batch row; existing `detectKitItems` path untouched
6. **`js/modules/14-recipes.js`** — public recipe browser on products page; "Recipes" tab added to `10-tabs.js`; "Reserve in store" CTA only (no online cart until licence granted)
7. **Zoho Invoice line items** — existing mechanism handles ingredient stock deduction per line item at invoice submit; no new Zoho API mechanisms required

### Critical Pitfalls

1. **BrewPad batch detection creates 12 batches instead of 1** — `detectKitItems` fires once per non-fee line item; for a 12-ingredient recipe this creates 12 batches. Add a separate `detectRecipeSale()` that checks for `recipe_id` first; never route recipe sales through `detectKitItems`. Test: a single recipe sale must produce exactly one batch record.

2. **Inventory race condition on multi-ingredient recipe sales** — two simultaneous kiosk sales both read sufficient stock, both proceed, one over-deducts an ingredient. Pre-sale reservation step using Redis `DECRBY` with floor check (Lua script or MULTI/EXEC watch) before charging the terminal; restore on payment failure. A recipe-sale mutex key is an acceptable simpler interim.

3. **Pricing drift — recipe price computed from live Zoho ingredient rates** — ingredient prices change with supplier orders; use `locked_price` on the recipe record, explicitly set by staff; never compute customer-facing price at runtime. Unretrofit-able — must be in the schema from day one.

4. **BeerXML unit ambiguity from BeerSmith non-compliance** — BeerSmith's BeerXML export does not strictly conform to the spec; `DISPLAY_AMOUNT` is not the calculation value, `AMOUNT_IS_WEIGHT` defaults to false. Validate `AMOUNT_IS_WEIGHT`; use `AMOUNT` not `DISPLAY_AMOUNT`; assert sanity ranges (grain: 0.1–10 kg, hops: 0.01–0.2 kg); require staff review before any import commits.

5. **Recipe snapshot missing — historical batches show wrong ingredients after recipe edits** — storing only a `recipe_id` reference means recipe edits overwrite historical records. Serialize full ingredient list + quantities + fee as JSON into `recipe_snapshot` column on batch row at sale time. Unretrofit-able — must be in Batches schema before the first recipe sale.

6. **Brewing licence timing — recipe features deployed without regulatory clearance** — `BEER_SALES_ENABLED` env var must gate the kiosk sale confirm endpoint server-side, not just hide UI. Public recipe browsing (informational) can be enabled before the licence. BC PST rules for brewed-on-premises beer must be confirmed before first live sale.

## Implications for Roadmap

The dependency graph drives a clear phase order. The ingredient-to-SKU mapping is the keystone — nothing else works without it. The data model (schema, feature flag, snapshot) must be fully designed before any sale flow is coded. BeerXML import is a P2 accelerator and follows after the core kiosk sale works.

### Phase 1: Recipe Data Foundation
**Rationale:** Everything depends on this phase. The recipe schema, `locked_price`, `recipe_snapshot`, and feature flag must be established before any code is written elsewhere. Pitfalls 2, 3, 5, and 6 all require design decisions at this phase — they cannot be retrofitted.
**Delivers:** Google Sheets "Recipes" tab with schema; Apps Script CRUD actions (`create_recipe`, `get_recipes`, `update_recipe`); `recipe_id` + `recipe_snapshot` column added to Batches tab; `BEER_SALES_ENABLED` feature flag in middleware (env var, defaults false); Zoho "Brewing Fee" service item created and `BREWING_FEE_ITEM_ID` set on Railway
**Addresses:** Recipe catalog (table stakes), locked_price, recipe_snapshot, licence gating
**Avoids:** Pricing drift (Pitfall 3), recipe snapshot loss (Pitfall 5), licence timing risk (Pitfall 6)
**Research flag:** None needed — Apps Script + Sheets pattern is battle-tested in this codebase

### Phase 2: Middleware Recipe API + Admin CRUD
**Rationale:** The admin must be able to create and manage recipes before the kiosk can sell them. The API layer establishes the server-side contract that both admin and kiosk depend on.
**Delivers:** `zoho-middleware/routes/recipes.js` (GET/POST/PUT/DELETE; Redis cache `sv:recipes`); recipe management tab in `js/admin.js` (list, create, edit, activate/deactivate, ingredient line items); `CACHE_KEYS.RECIPES` in constants; `/api/recipes/:id/availability` endpoint
**Uses:** `fast-xml-parser@^4.5.0` and `multer@^1.4.5-lts.1` (middleware install); existing Apps Script URL + auth; existing Redis cache pattern
**Implements:** Recipe API component; Admin recipe manager component
**Research flag:** None — route and admin IIFE patterns directly replicate existing `pos.js`, `catalog.js`, and admin batch tab

### Phase 3: Kiosk Recipe Sales + Batch Creation
**Rationale:** Core revenue-generating workflow. Must be built after the API exists and staff have created at least one test recipe. This phase also implements the inventory reservation model (Pitfall 1) and the separate batch creation path (Pitfall 8).
**Delivers:** `kioskLoadRecipe()` in `kiosk.js`; recipe browser tab in kiosk UI; `_kioskActiveRecipeId` state; brewing fee auto-added; `detectRecipeSale()` + `createBatchFromRecipeSale()` in `brewpad-integration.js`; recipe_id + recipe_snapshot propagated through kiosk sale confirm → batch creation; inventory reservation before payment; `BEER_SALES_ENABLED` check in confirm endpoint server-side
**Addresses:** Kiosk recipe sale (P1), inventory deduction (P1), batch auto-creation (P1)
**Avoids:** Race condition (Pitfall 1), batch detection failure (Pitfall 8), recipe-as-cart confusion (Pitfall 4)
**Research flag:** Needs design decision on Redis reservation mechanism — Lua script vs MULTI/EXEC vs recipe-sale mutex. The mutex is simpler and acceptable for kiosk-only volume; Lua is correct for future online sales. Decide at planning time before implementation.

### Phase 4: BeerXML Import
**Rationale:** Staff-efficiency accelerator, not a gate. Add after the kiosk flow is stable and staff have validated the data model manually with at least a few hand-entered recipes. Avoids burning time on import edge cases while the core sale flow is being validated.
**Delivers:** `POST /api/recipes/import-beerxml` endpoint; BeerXML parse via `fast-xml-parser`; fuzzy name matching against `zoho:ingredients` cache; staff ingredient-mapping review table in admin UI; unit validation (grain kg sanity ranges, `AMOUNT_IS_WEIGHT` flag, `AMOUNT` vs `DISPLAY_AMOUNT`); `multer.memoryStorage()` with 500KB limit
**Uses:** `fast-xml-parser@^4.5.0`, `multer@^1.4.5-lts.1` (installed in Phase 2)
**Avoids:** BeerXML unit ambiguity (Pitfall 3)
**Research flag:** Requires testing against real BeerSmith exports (and Brewfather if available) before merge — spec non-compliance behavior is confirmed but specific edge cases must be caught in test, not code review. The fuzzy matching algorithm quality should be evaluated on a real export.

### Phase 5: Public Recipe Browser
**Rationale:** Informational browsing can be staged independently and can go live before the brewing licence is granted (no purchase path). Goes last because real recipe content must exist before public display is worthwhile.
**Delivers:** `js/modules/14-recipes.js`; "Recipes" tab on products page via `10-tabs.js`; recipe cards using existing `.label-beer` card style; "Reserve in store" CTA modal; `GET ?action=get_recipes` public Apps Script endpoint (active recipes only, no auth)
**Addresses:** Public recipe browsing (table stakes for online presence)
**Avoids:** Licence timing risk (Pitfall 6) — no purchase path until `BEER_SALES_ENABLED=true`
**Research flag:** None — renders using existing card infrastructure with no new patterns

### Phase Ordering Rationale

- Schema decisions (`locked_price`, `recipe_snapshot`) are unretrofit-able once sales begin — Phase 1 must be first
- Admin must exist before kiosk can be tested with real recipes — Phase 2 before Phase 3
- BeerXML import is an accelerator; manual admin entry in Phase 2 unblocks Phase 3 testing without it
- Public browsing requires real recipe content and benefits from the kiosk flow being validated first
- Feature flag gates kiosk sales independent of public browsing — these can ship at different times without coordination

### Research Flags

Needs deeper research during planning:
- **Phase 3 (Kiosk Recipe Sales):** Redis multi-item atomic reservation — `inventory-ledger.js` handles single items via `incrByFloat`; a multi-item floor-check (Lua script or MULTI/EXEC watch) is the non-trivial part; recipe-sale mutex is the acceptable simpler alternative
- **Phase 3 (Kiosk Recipe Sales):** Tax rule per line item for recipe sales — brewing ingredients may use 12% BC HST while the brewing service fee uses 5% GST only; confirm before first test sale; the Zoho `sales_tax_rule_id` per item should handle this if set correctly

Standard patterns (skip research-phase):
- **Phase 1 (Data Foundation):** Apps Script + Sheets schema — well-established in this codebase
- **Phase 2 (API + Admin):** Route and admin IIFE patterns — directly replicates existing code
- **Phase 4 (BeerXML Import):** `fast-xml-parser` normalization — format is stable; testing catches edge cases
- **Phase 5 (Public Browser):** Recipe card rendering — reuses existing `.label-beer` infrastructure

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | New dependencies confirmed against npm and GitHub; avoided packages verified as abandoned; version constraints derived from existing package.json compatibility |
| Features | MEDIUM-HIGH | Table-stakes verified against 5 live competitor sites; BeerXML structure from official spec; Zoho composite item limitation confirmed against API docs; consultation UX patterns inferred from industry practice |
| Architecture | HIGH | Based on direct codebase analysis of `pos.js`, `brewpad-integration.js`, `kiosk.js`, `adminApi.gs`, `inventory-ledger.js`; Zoho API limitations confirmed against official docs |
| Pitfalls | HIGH | System internals read directly; external pitfalls verified against official Zoho API docs, BeerXML spec, Brewtarget manual (BeerSmith non-compliance), BC PST-121 bulletin, Redis race condition patterns |

**Overall confidence:** HIGH

### Gaps to Address

- **Inventory reservation mechanism:** The exact Redis approach (Lua script vs MULTI/EXEC vs recipe-sale mutex) needs a design decision at Phase 3 planning. The mutex approach is simpler and acceptable for kiosk-only volume; the Lua approach is correct for eventual online sales. Decide at planning time.
- **Tax rules for recipe line items:** Each ingredient in a recipe sale carries a `sales_tax_rule_id` in Zoho. The brewing service fee item's tax rule must be confirmed in Zoho before any test sale. The existing tax pipeline fix (commit `281d796`) ensures `sales_tax_rule_id` survives enrichment — but the brewing fee item must be configured correctly in Zoho itself.
- **Ingredient name fuzzy matching quality:** BeerXML ingredient names from BeerSmith will have low exact-match rates against Zoho SKU names. The quality of the fuzzy match algorithm determines staff manual work at import time. Evaluate on first real BeerSmith export before committing to an approach.
- **BC brewing licence conditions:** Tax treatment for "brewing service" income vs "ingredient sale" income under the ferment-in-store model needs confirmation before the first recipe sale. The PST-121 bulletin covers liquor producers; the specific treatment for customer-owned fermentation-on-premises may differ.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis (`zoho-middleware/routes/pos.js`, `lib/brewpad-integration.js`, `js/modules/11-cart.js`, `js/kiosk.js`, `js/lib/constants.js`, `apps-script/adminApi.gs`, `lib/inventory-ledger.js`, `lib/pricing.js`) — architecture patterns and existing code paths
- [fast-xml-parser GitHub](https://github.com/NaturalIntelligence/fast-xml-parser) — version confirmed, maintenance status, v4/v5 API compatibility
- [fast-xml-parser npm](https://www.npmjs.com/package/fast-xml-parser) — 70M+ weekly downloads confirmed active maintenance
- [BeerXML Official Standard](https://beerxml.com/beerxml.htm) — data structure, field definitions, unit requirements
- [Zoho Inventory Item Adjustments API](https://www.zoho.com/inventory/api/v1/itemadjustments/) — multi-line support, negative quantity deduction confirmed
- [Zoho Inventory Composite Items API](https://www.zoho.com/inventory/api/v1/compositeitems/) — confirmed composite items are not line-itemizable in invoices via REST API
- [Zoho Inventory Sales Orders API](https://www.zoho.com/inventory/api/v1/salesorders/) — line_items field accepts standard inventory item_ids only

### Secondary (MEDIUM confidence)
- [Terminal City Brewing](https://tcbrewing.com/beer/) — live competitive analysis; pricing model, recipe selection UX validated
- [The Flying Barrel](https://www.flyingbarrel.com/bopinfo.html) — pricing tiers, U-Brew model comparison
- [Brewtarget manual](http://www.brewtarget.org/manual.html) — BeerSmith BeerXML non-compliance documented
- [BeerXML Wikipedia](https://en.wikipedia.org/wiki/BeerXML) — version history, known limitations
- [BC PST-121 bulletin](https://www2.gov.bc.ca/assets/gov/taxes/sales-taxes/publications/pst-121-liquor-producers.pdf) — liquor producer tax rules
- [Brewfather inventory docs](https://docs.brewfather.app/inventory) — recipe versioning snapshot model confirmed

### Tertiary (LOW confidence)
- Custom recipe consultation UX patterns — inferred from competitor "contact us" flows; no direct documentation
- Fuzzy ingredient name matching quality — estimated from BeerXML name variance; requires real BeerSmith export testing to validate

---
*Research completed: 2026-05-09*
*Ready for roadmap: yes*
