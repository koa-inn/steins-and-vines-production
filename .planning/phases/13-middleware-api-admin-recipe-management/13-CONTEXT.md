# Phase 13: Middleware API + Admin Recipe Management - Context

**Gathered:** 2026-05-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Staff can create, edit, activate, and deactivate recipes via a new "Recipes" tab in the admin panel. The middleware API (new `routes/recipes.js`) is the authoritative data contract between the admin frontend and Apps Script, with Redis caching and Zoho stock-availability checking. No public-facing recipe pages, no kiosk sales, no BeerXML import in this phase.

</domain>

<decisions>
## Implementation Decisions

### Recipe List & Editor Layout
- **D-01:** List → detail view swap pattern. Recipe list as a table; clicking a recipe replaces the list with a full detail/editor view. Back button returns to list. Gives more room for the ingredient editor than a modal approach.
- **D-02:** Activation guardrails — staff cannot set a recipe to `active` unless `locked_price` is set and at least one ingredient exists. Prevents incomplete recipes from going live.

### Zoho SKU Lookup for Ingredients
- **D-03:** Pre-load the full ingredient catalog when the Recipes tab opens. Autocomplete searches client-side — no per-keystroke API calls. Catalog size (~200-500 items) makes this fast and simple.
- **D-04:** Ingredient autocomplete auto-populates: item_name, unit, and current stock level as a hint (e.g., "Pale Malt — 45 kg available"). Helps staff know what's on hand while building recipes.
- **D-05:** Store Zoho `item_id` (internal numeric ID) as the ingredient reference in RecipeIngredients, not the SKU string. SKU shown in the UI for humans. Consistent with how checkout and inventory deduction already work.

### Availability Checking
- **D-06:** Auto-check availability on recipe detail load via `GET /api/recipes/:id/availability`. Staff see stock status without extra clicks.
- **D-07:** Per-ingredient colored indicators (green/yellow/red) on each ingredient row, plus a recipe-level summary banner at the top ("All ingredients in stock" / "2 ingredients low" / "Cannot brew — 1 ingredient out of stock").
- **D-08:** Yellow "low stock" threshold is batch-count based — yellow when remaining stock covers fewer than 3 batches of this recipe (ingredient quantity × 3). Contextual to each recipe's quantities rather than an arbitrary fixed number.

### Middleware Recipe Routes
- **D-09:** Long cache TTL (10-15 minutes) for recipe data with explicit invalidation. When admin creates/updates/deletes a recipe via middleware, bust `CACHE_KEYS.RECIPES` immediately. Stale data only possible if someone edits directly in Google Sheets (acceptable).

### Claude's Discretion
- **Tab placement:** Claude decides where the Recipes tab sits in admin tab order. Recommendation: after Batches, since the operational flow is recipe → sale → batch.
- **Ingredient editor UX:** Claude designs the inline autocomplete + editable rows pattern. Should include add/remove buttons, quantity and unit fields, and the stock-level hint from D-04.
- **Route file structure:** Claude decides file organization. Recommendation: new `routes/recipes.js` since recipes come from Apps Script (not Zoho like catalog.js). Clean separation matches existing route-per-domain pattern.
- **API response reshaping:** Claude decides whether middleware reshapes Apps Script responses. Recommendation: normalize to a clean REST contract so frontend depends on the middleware shape, not Apps Script internals.

### Phase 12 Code Review Fixes (carry forward)
- **D-10:** CR-01 from Phase 12 code review — `updateRecipe` and `deleteRecipe` in adminApi.gs need `acquireScriptLock` added before this phase introduces concurrent admin access. Fix as part of Phase 13 implementation.
- **D-11:** WR-03 from Phase 12 code review — `get_recipes` cache key `'gr'` ignores status/limit/offset parameters. Needs fix before admin UI fetches filtered recipe lists.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` — Current milestone goals, constraints, key decisions
- `.planning/REQUIREMENTS.md` — API-01 through API-03, ADM-01 through ADM-03 are this phase
- `.planning/ROADMAP.md` — Phase 13 success criteria and dependency chain

### Prior Phase Context
- `.planning/phases/12-recipe-data-foundation/12-CONTEXT.md` — D-01 through D-08 decisions (fee structure, ingredient storage, status workflow, feature flag scope)
- `.planning/phases/12-recipe-data-foundation/12-REVIEW.md` — CR-01, WR-03 findings that must be fixed in Phase 13

### Research
- `.planning/research/SUMMARY.md` — Synthesized research: stack, features, architecture, pitfalls
- `.planning/research/ARCHITECTURE.md` — Integration architecture, data flow, component mapping

### Existing Patterns
- `admin.html` — Admin panel tab structure (11 existing tabs, each with a content section)
- `js/admin.js` — Admin IIFE: tab switching, Apps Script API calls, toast notifications, confirm dialogs
- `apps-script/adminApi.gs` — Recipe CRUD functions created in Phase 12 (createRecipe, getRecipes, getRecipeDetail, updateRecipe, deleteRecipe)
- `zoho-middleware/routes/catalog.js` — Existing route pattern for product/ingredient listing with Redis cache
- `zoho-middleware/lib/constants.js` — `CACHE_KEYS.RECIPES` and `CACHE_KEYS.RECIPES_TS` already defined
- `zoho-middleware/lib/brewpad-integration.js` — Existing Apps Script proxy pattern (fire-and-forget; recipe routes need synchronous request-response)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `admin.js` tab system: `data-tab` attributes on buttons, content sections toggled by class. New Recipes tab follows same pattern.
- `admin.js` `adminApiGet()`/`adminApiPost()`: Wrappers for Apps Script fetch calls with auth. Recipe detail view can use these directly for any direct Apps Script calls.
- `catalog.js` route pattern: `router.get('/ingredients', ...)` with Redis cache check → Zoho fetch → cache write. Recipe routes mirror this with Apps Script as the data source instead of Zoho.
- `js/lib/constants.js` `ITEM_TYPES.RECIPE` — Already defined in Phase 12, ready for downstream use.
- Ingredient catalog endpoint: `GET /api/catalog/ingredients` already returns the full ingredient list with item_id, SKU, name, unit, stock — can be pre-loaded by the Recipes tab for autocomplete.

### Established Patterns
- **Admin tab IIFE pattern:** Each tab's JS is self-contained inside the admin IIFE. Recipe tab follows the same structure — init function called when tab is activated.
- **Middleware route registration:** `server.js` mounts route modules via `app.use('/api/...', require('./routes/...'))`. New recipe routes registered the same way.
- **Redis cache with bust:** `cache.get(key)` → miss → fetch → `cache.set(key, data, ttl)`. On mutation: `cache.del(key)`. Existing pattern in catalog.js.
- **Apps Script request-response:** `adminApiGet(action, params)` and `adminApiPost(action, payload)` in admin.js — synchronous fetch to Apps Script doGet/doPost.

### Integration Points
- `admin.html` — Add Recipes tab button + content section
- `js/admin.js` — Add recipe list/detail view rendering, ingredient autocomplete, availability display
- `zoho-middleware/server.js` — Mount new `routes/recipes.js`
- `zoho-middleware/routes/recipes.js` — New file: recipe CRUD proxy + availability endpoint
- `apps-script/adminApi.gs` — Fix CR-01 (add locks to update/delete) and WR-03 (cache key per filter)

</code_context>

<specifics>
## Specific Ideas

- Stock hint in autocomplete helps staff build recipes from ingredients they actually have on hand
- Batch-count threshold for availability (fewer than 3 batches = yellow) makes the warning contextual to each recipe's ingredient quantities
- Recipe-level banner gives at-a-glance status without scanning every ingredient row
- Ingredient catalog is pre-loaded from the existing `/api/catalog/ingredients` endpoint — no new data source needed for autocomplete

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 13-Middleware API + Admin Recipe Management*
*Context gathered: 2026-05-16*
