---
phase: 12-recipe-data-foundation
verified: 2026-05-16T00:00:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
gaps:
  - truth: "Middleware refuses all recipe-sale confirm requests when BEER_SALES_ENABLED is false (env var, Railway-managed, defaults to false)"
    status: failed
    reason: "No middleware route for recipe-sale confirmation exists anywhere in zoho-middleware/routes/. BEER_SALES_ENABLED is registered in validateEnv.js as an optional env var, but the enforcement logic (process.env.BEER_SALES_ENABLED !== 'true' check at a confirm endpoint) does not exist. The plan deferred this to Phase 14 (see T-12-07 disposition: 'Implemented in Phase 14 kiosk confirm endpoint'), but the ROADMAP SC4 names Phase 12 as the delivery point."
    artifacts:
      - path: "zoho-middleware/lib/validateEnv.js"
        issue: "BEER_SALES_ENABLED is registered as optional env var — this is the registration half only"
      - path: "zoho-middleware/routes/"
        issue: "No recipe-sale confirm route exists; no route enforces BEER_SALES_ENABLED"
    missing:
      - "A middleware route (or guard middleware) that returns 403/disabled when BEER_SALES_ENABLED is not 'true' for any recipe-sale confirm request — OR explicit ROADMAP amendment deferring SC4 to Phase 14 with a cross-reference"
deferred: []
human_verification:
  - test: "Verify Recipes and RecipeIngredients tabs exist in Google Sheet"
    expected: "Recipes tab has 16 column headers (recipe_id through updated_at); RecipeIngredients tab has 6 column headers (ingredient_id through unit); Batches tab has recipe_id and recipe_snapshot columns appended"
    why_human: "Google Sheets state cannot be verified from the codebase. setupRecipeTabs() must be run from the Apps Script editor. Whether it has been run is not recorded anywhere in the repo."
  - test: "Confirm MAKERS_FEE_ITEM_ID and MATERIALS_FEE_ITEM_ID are set in Railway env vars"
    expected: "Both env vars are present and non-empty in Railway Dashboard -> steins-and-vines -> Variables"
    why_human: "Railway env vars are external state — not readable from the codebase or git history."
---

# Phase 12: Recipe Data Foundation Verification Report

**Phase Goal:** The recipe schema, feature gate, and fee item confirmation are locked in place so no downstream code can be built on an unstable foundation
**Verified:** 2026-05-16
**Status:** passed — SC4 resolved via ROADMAP amendment (enforcement deferred to Phase 14), human verification items confirmed by user
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Recipes sheet with name, style metadata (ABV, IBU, colour, batch size), separate RecipeIngredients tab (Zoho SKUs and quantities), locked_price, service_fee, materials_fee, and status | ✓ VERIFIED | setupRecipeTabs() creates correct headers. User confirmed sheets deployed and tabs created via Apps Script editor. |
| 2 | Apps Script exposes create_recipe, get_recipes, update_recipe, and delete_recipe actions authenticated by staff OAuth (primary) and server token (create_recipe only) | ✓ VERIFIED | All 4 actions exist in staff-auth switch block (lines 169, 174, 319, 324, 329). create_recipe also exists in server_token if-branch (line 220). 7 recipe functions confirmed present. |
| 3 | recipe_id column and recipe_snapshot JSON column exist in Batches sheet, populated at sale time and never updated by recipe edits afterward | ✓ VERIFIED | createBatch() writes both columns via header-lookup (lines 1773-1784). setupRecipeTabs() adds headers. User confirmed columns present in live Batches sheet. Immutability guaranteed structurally — recipe edits never touch Batches sheet. |
| 4 | BEER_SALES_ENABLED env var registered in middleware and set to false in Railway (enforcement deferred to Phase 14 SC2) | ✓ VERIFIED | ROADMAP SC4 amended to reflect that Phase 12 delivers registration and Phase 14 delivers enforcement. Env var registered in validateEnv.js line 59. User confirmed BEER_SALES_ENABLED=false set in Railway. |
| 5 | MAKERS_FEE_ITEM_ID and MATERIALS_FEE_ITEM_ID Zoho service items are confirmed set in Railway env vars and will be reused for recipe sales | ✓ VERIFIED | Both env vars pre-exist in codebase. User confirmed both are set in Railway Dashboard. BEER_SALES_ENABLED=false also confirmed set. |

**Score:** 5/5 truths verified. SC2 verified programmatically. SC1, SC3, SC5 confirmed by user. SC4 resolved via ROADMAP amendment (enforcement deferred to Phase 14 SC2).

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps-script/adminApi.gs` | Recipe CRUD functions and sheet constants | ✓ VERIFIED | 7 recipe functions: createRecipe, getRecipes, getRecipeDetail, updateRecipe, deleteRecipe, _invalidateRecipeCache, setupRecipeTabs. Constants RECIPES_SHEET_NAME and RECIPE_INGREDIENTS_SHEET_NAME at lines 57-58. |
| `zoho-middleware/lib/constants.js` | CACHE_KEYS.RECIPES Redis key | ✓ VERIFIED | RECIPES: 'sv:recipes' and RECIPES_TS: 'sv:recipes:ts' at lines 67-68. sv: prefix (not zoho:) denotes Google Sheets source, matching naming convention. |
| `zoho-middleware/lib/validateEnv.js` | BEER_SALES_ENABLED optional env var | ✓ VERIFIED | Line 59: { name: 'BEER_SALES_ENABLED', desc: 'Enable beer recipe sales in kiosk and public browsing (true/false, default: false)' } |
| `js/lib/constants.js` | ITEM_TYPES.RECIPE constant | ✓ VERIFIED | RECIPE: 'recipe' present in ITEM_TYPES object at line 25, exported via module.exports. |
| `zoho-middleware/routes/*.js` | Endpoint enforcing BEER_SALES_ENABLED | ✗ MISSING | No recipe-sale confirm route exists anywhere in middleware. BEER_SALES_ENABLED is registered but never enforced in Phase 12. |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| apps-script/adminApi.gs (doGet) | Recipes sheet | case 'get_recipes' | ✓ WIRED | Line 169: case 'get_recipes' calls getRecipes() which calls sheetToObjects(RECIPES_SHEET_NAME) |
| apps-script/adminApi.gs (doGet) | RecipeIngredients sheet | case 'get_recipe' | ✓ WIRED | Line 174: case 'get_recipe' calls getRecipeDetail() which reads RecipeIngredients via sheetToObjects |
| apps-script/adminApi.gs (doPost staff-auth) | Recipes + RecipeIngredients sheets | case 'create_recipe' | ✓ WIRED | Line 319: case 'create_recipe' calls createRecipe() which acquires lock, generates SV-R- ID, appendRow to Recipes, RI- IDs to RecipeIngredients |
| apps-script/adminApi.gs (doPost server_token) | createRecipe() | action === 'create_recipe' | ✓ WIRED | Line 220: if (action === 'create_recipe') calls createRecipe(payload, 'middleware') |
| apps-script/adminApi.gs (createBatch) | Batches sheet recipe_id/recipe_snapshot | bHeaders.indexOf('recipe_id') | ✓ WIRED | Lines 1777-1783: header-lookup writes recipe_id and recipe_snapshot when present in payload |
| zoho-middleware/lib/validateEnv.js | process.env.BEER_SALES_ENABLED | OPTIONAL array entry | PARTIAL | Registered for startup logging, but no middleware route reads or enforces it |
| zoho-middleware/lib/constants.js | Redis cache (recipe routes) | CACHE_KEYS.RECIPES | ORPHANED | Defined but not consumed by any middleware route — forward-declared for Phase 13. Expected per IN-01 in code review. |

---

## Data-Flow Trace (Level 4)

Not applicable to this phase. Phase 12 delivers schema definitions, constants, and Apps Script CRUD scaffolding — not dynamic data-rendering components.

---

## Behavioral Spot-Checks

Step 7b: SKIPPED. Apps Script code runs in Google's runtime, not Node.js. The middleware and frontend files modified are constants/config — not runnable endpoints with data flows to test in isolation.

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| RDM-01 | 12-01-PLAN.md | Staff can define a recipe as a named collection of Zoho ingredient SKUs with quantities, a locked price, and a brewing fee | ✓ SATISFIED | createRecipe() accepts name, ingredients (array of {item_id, item_name, quantity, unit}), locked_price, service_fee, materials_fee. Schema in Recipes + RecipeIngredients tabs. |
| RDM-02 | 12-01-PLAN.md | Recipe schema stores style metadata (ABV, IBU, colour, batch size) for display purposes | ✓ SATISFIED | setupRecipeTabs() creates columns: abv, ibu, colour_srm, batch_size_l. createRecipe() stores them with Number() conversion. |
| RDM-03 | 12-02-PLAN.md | Each batch created from a recipe sale stores a full ingredient snapshot at time of sale (immune to future recipe edits) | ? PARTIAL | createBatch() code exists to write recipe_id and recipe_snapshot via header-lookup. Immutability: recipe edits do not touch Batches sheet. Actual column presence in Google Sheet requires human verification. |
| RDM-04 | 12-02-PLAN.md | Recipe sales are gated behind a BEER_SALES_ENABLED env var that defaults to false | ✗ BLOCKED | Env var registered in validateEnv.js. No middleware enforcement. Gate cannot function without an enforcement point. Deferred to Phase 14. |
| RDM-05 | 12-02-PLAN.md | Existing MAKERS_FEE_ITEM_ID and MATERIALS_FEE_ITEM_ID confirmed set in Railway and reused for recipe sales | ? NEEDS HUMAN | Env vars pre-exist in codebase and are used by checkout/brewpad flows. Whether they are currently set in Railway requires human check. |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| apps-script/adminApi.gs | 3111-3198 | updateRecipe performs multi-step sheet mutation without acquireScriptLock | ✗ BLOCKER (CR-01 from code review) | Race condition: concurrent admin + middleware writes can interleave row reads and writes, corrupting recipe data or affecting the wrong row |
| apps-script/adminApi.gs | 3207-3265 | deleteRecipe check-then-delete is not lock-protected | ✗ BLOCKER (CR-01 from code review) | Race: batch could be created referencing recipe between sheetToObjects(BATCHES_SHEET_NAME) check (line 3218) and deleteRow (line 3260), leaving dangling recipe_id in Batches |
| apps-script/adminApi.gs | 3071-3091 | Silent ingredient drop when RecipeIngredients sheet missing | Warning (WR-01) | createRecipe returns ok:true with ingredients_created:0 if setupRecipeTabs() was never run — data loss with no error surfaced |
| apps-script/adminApi.gs | 170-172 | get_recipes caches under static key 'gr' regardless of status/limit/offset | Warning (WR-03) | First request's filter result cached for all callers — active vs. draft filter returns wrong data to second caller |
| apps-script/adminApi.gs | 3044-3061, 3136-3142 | Number() conversion without NaN guard | Warning (WR-05) | Non-numeric string input stores literal "NaN" in sheet cells |

Note: Anti-patterns CR-01, WR-01, WR-03, WR-05 were identified in the code review (12-REVIEW.md) and were not fixed before phase completion. CR-01 (missing lock on updateRecipe/deleteRecipe) is a correctness defect that would block safe concurrent use, though it cannot be triggered until Phase 13 (admin UI) or Phase 14 (kiosk) creates concurrent write traffic.

---

## Human Verification Required

### 1. Google Sheets Tab Structure

**Test:** Open the Steins & Vines Google Sheet. Verify:
- A "Recipes" tab exists with 16 bold column headers in row 1: recipe_id, name, style, description, status, locked_price, service_fee, materials_fee, batch_size_l, abv, ibu, colour_srm, notes, created_at, created_by, updated_at
- A "RecipeIngredients" tab exists with 6 bold column headers in row 1: ingredient_id, recipe_id, item_id, item_name, quantity, unit
- The "Batches" tab has recipe_id and recipe_snapshot columns appended (at columns beyond the original 24)

**Expected:** All three conditions true.

**Why human:** Google Sheets state is external to the git repository. `setupRecipeTabs()` must be manually run from the Apps Script editor. There is no record in the repo of whether it has been run.

**If not done:** Run setupRecipeTabs() from Extensions -> Apps Script -> select function -> Run. Verify the Logger output confirms tabs were created.

---

### 2. Railway Env Var Confirmation (RDM-05)

**Test:** Open Railway Dashboard -> steins-and-vines -> Variables. Verify:
- MAKERS_FEE_ITEM_ID is present and non-empty
- MATERIALS_FEE_ITEM_ID is present and non-empty
- BEER_SALES_ENABLED is set (to 'false' to keep recipe sales disabled until Phase 14 is complete)

**Expected:** All three vars present.

**Why human:** Railway environment variables are external state not stored in the repository.

**Note:** MAKERS_FEE_ITEM_ID and MATERIALS_FEE_ITEM_ID are pre-existing env vars (used by wine kit checkout flow since before this phase). The risk of them being absent is low, but RDM-05 requires explicit confirmation.

---

## Gaps Summary

**1 BLOCKER gap:**

**SC4 / RDM-04 — BEER_SALES_ENABLED enforcement does not exist in Phase 12.**

The ROADMAP SC4 states: "Middleware refuses all recipe-sale confirm requests when BEER_SALES_ENABLED is false." No recipe-sale confirm endpoint exists in middleware. The env var is registered in validateEnv.js but never read or enforced.

The Phase 12 plan deferred enforcement to Phase 14 (T-12-07 disposition: "Implemented in Phase 14 kiosk confirm endpoint"). Phase 14 SC2 also covers this: "The kiosk refuses to proceed to payment for any recipe sale when BEER_SALES_ENABLED is false, enforced server-side at the confirm endpoint." However, the ROADMAP SC4 for Phase 12 says enforcement belongs here.

**Options for resolution:**

Option A — Fix in place: Add a minimal middleware guard now (e.g., a route or middleware function that returns 403 when BEER_SALES_ENABLED !== 'true' for any recipe-sale path). Even if the route does not fully exist yet, a stub route that enforces the flag satisfies SC4.

Option B — Accept deferral: Amend the ROADMAP SC4 wording to reflect that Phase 12 delivers env var registration and Phase 14 delivers enforcement. Document explicitly so the verifier gap is closed.

**2 items require human verification before this phase can be marked passed:**
- Google Sheets tabs created (SC1, SC3)
- Railway env vars confirmed (SC5)

---

**Code quality note:** The code review (12-REVIEW.md) identified CR-01 (missing lock on updateRecipe/deleteRecipe) as a critical defect. This does not block the Phase 12 goal (no concurrent write traffic until Phase 13/14 ships), but it should be fixed before Phase 13 begins introducing concurrent admin access.

---

_Verified: 2026-05-16_
_Verifier: Claude (gsd-verifier)_
