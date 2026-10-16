---
phase: 89-beer-category-field-for-recipes
reviewed: 2026-10-15T00:00:00Z
depth: standard
scope: git diff 5c863725..07598231 (excl .planning, *.min.*, js/main.js, HTML ?v= stamps)
files_reviewed: 20
files_reviewed_list:
  - apps-script/adminApi.gs
  - docs/RUNBOOK.md
  - js/admin.js
  - js/brewpad.js
  - js/lib/constants.js
  - js/modules/07-catalog-kits.js
  - zoho-middleware/lib/recipe-pg.js
  - zoho-middleware/lib/recipe-rules.js
  - zoho-middleware/migrations/0006_recipes_beer_category.sql
  - zoho-middleware/routes/recipes.js
  - zoho-middleware/scripts/backfill/recipes-backfill.js
  - zoho-middleware/scripts/backfill/recipes-verify.js
  - zoho-middleware/scripts/backfill/specs/recipes.js
findings:
  critical: 0
  high: 0
  medium: 2
  low: 4
  total: 6
status: issues_found
---

# Phase 89: Code Review Report

**Depth:** standard. Test files and HTML (stamp-only) were not reviewed in depth.

## Summary

No critical or high issues. The normaliser is byte-identical across recipe-rules.js, adminApi.gs (same 12 keys, same branch order), and constants.js carries the same key set (drift test exists). The migration is additive only (nullable `text` column, no CHECK, no data step). Rendered category values are XSS-safe: `recipeTintClass` whitelists against `BEER_CATEGORIES` before the value reaches `className`, and the admin/BrewPad selects only assign `.value`. `PUBLIC_RECIPE_FIELDS` adds exactly one non-sensitive field. Apps Script validates before the lock and before any ensure/write. Concerns are an empty-tab crash path, a backfill/normaliser rule mismatch, and a few robustness gaps.

## Medium

### MD-01: Backfill reject rule is stricter than the runtime normaliser (hand-typed sheet values reject the whole promote)

**File:** `zoho-middleware/scripts/backfill/recipes-backfill.js:168-171`
**Issue:** The reject compares the trimmed raw cell against `BEER_CATEGORY_KEYS` case-sensitively. The runtime gate (`normalizeBeerCategory`) accepts `IPA`, `Red Ale`, `red-ale`. A sheet cell with any of those is therefore rejected as `invalid_beer_category`, although the app would have accepted and stored the canonical key. Because `--promote` is all-or-nothing on rejects, one hand-edited cell blocks the cutover. Verify also compares raw sheet text against the stored canonical key, so it would report a mismatch.
**Fix:** Normalise before the check and store the canonical value:
```js
var bc = recipeRules.normalizeBeerCategory(values.beer_category);
if (bc === null) {
  rejects.push(makeReject(specs.recipes.sheet, row.rowNumber, id, 'beer_category', 'invalid_beer_category'));
} else {
  values.beer_category = bc === '' ? null : bc;
}
```
Apply the same normalisation in recipes-verify.js's comparison, or document that the sheet is key-only and add a test for `"IPA"`.

### MD-02: `ensureRecipesBeerCategoryColumn` throws on an existing-but-empty Recipes tab (known crash class); setup helper has no null guard

**File:** `apps-script/adminApi.gs:4225-4233`, `apps-script/adminApi.gs:5217-5221`
**Issue:** For a tab with no columns, `sheet.getLastColumn()` returns 0, so `getRange(1, 1, 1, 0)` throws. The helper is now called unconditionally from `updateRecipe`, `createRecipe` and `mirrorRecipeState`, so every recipe write hits it (the sibling pricing_mode and schedule_id helpers share the flaw, but this widens exposure). `setupRecipeBeerCategoryColumn` passes `getSheetByName(...)` straight in; a missing tab gives an opaque TypeError.
**Fix:**
```js
function ensureRecipesBeerCategoryColumn(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) {            // empty tab: bootstrap header row
    sheet.getRange(1, 1).setValue('beer_category').setFontWeight('bold');
    return 0;
  }
  ...
}
```
Better, bootstrap the full header set via the existing recipes header constants rather than a lone `beer_category`; and in the setup helper `if (!sheet) { Logger.log('Recipes sheet missing'); return; }`. Note updateRecipe's `bcCol > 0` guard would then skip a column-0 write, which is acceptable because column 0 is `recipe_id`.

## Low

### LW-01: Editor save can silently clear an existing category

**File:** `js/admin.js:9060`, `js/brewpad.js:3377`, `js/admin.js:8682-8683`, `js/brewpad.js:2747`
**Issue:** Form readers send `''` when the select element is absent, and PUT treats `''` as "clear". Separately, if a stored value is off-list (hand-edited sheet), the select shows blank and a save clears it with no warning. Both are data-loss edge cases rather than normal paths.
**Fix:** Omit the key when the element is absent (`if (el) payload.beer_category = el.value;`), so update leaves the cell untouched (`undefined` semantics already supported server-side).

### LW-02: Normaliser is permissive: strips all non-letters including digits and punctuation

**File:** `zoho-middleware/lib/recipe-rules.js:572` (mirrored in `adminApi.gs:4196`)
**Issue:** `"IPA2"`, `"p-i-l-s-n-e-r"`, `"red_ale!"` all normalise to valid keys. Consistent across copies and probably intended (D-03), but it accepts garbage as valid input.
**Fix:** Optional: restrict stripped characters to whitespace, `-` and `_` (`/[\s_-]/g`) and lowercase, so digits and other symbols reject. Change all three copies together; parity test will catch drift.

### LW-03: Route returns 400 while the rest of routes/recipes.js validation returns 422

**File:** `zoho-middleware/routes/recipes.js:625-629, 637, 786`
**Issue:** Documented as a locked decision, but clients that special-case 422 for validation (and the Apps Script `invalid_data` path via the proxy) will treat this differently; the error code is `invalid_beer_category` rather than the file's usual shape.
**Fix:** Ensure admin/BrewPad error handlers surface `error` text for 400 as well as 422; add a frontend test if not covered.

### LW-04: Route mutates `req.body` and recipe-pg re-validates; four hand-synced key lists

**File:** `zoho-middleware/routes/recipes.js:630`, `js/lib/constants.js:369-382`
**Issue:** Key lists live in recipe-rules.js, adminApi.gs, constants.js and CSS. Drift tests cover them, which is adequate, but constants.js orders keys differently from the other two (display order), so any future order-sensitive parity check will fail spuriously.
**Fix:** Keep parity tests set-based (they appear to be); add a comment noting the intentional ordering difference.

---

_Reviewed: 2026-10-15_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Resolution (2026-10-16)

- **MD-01: resolved, no code change (owner decision).** The backfill keeps exact-key matching (89-07 orchestrator resolution 1: "backfill never coerces"), pinned by `__tests__/backfill/recipes-beer-category.test.js`. All writers emit canonical keys. The live production sheet had 0 non-canonical values on 2026-10-16 (13 recipes, all blank). The recovery step is documented in docs/RUNBOOK.md (Phase 85 cutover step 1).
- **MD-02: fixed.**
  - All three Recipes ensure-column helpers read headers through `recipesHeaderRow`, which treats an empty tab as having no headers, so the column is added at A instead of throwing.
  - `setupRecipeBeerCategoryColumn` logs and returns when the tab is missing.
  - Behavioural test: `tests/frontend/adminapi-recipes-ensure-columns-empty-tab.test.js`, which uses a fake SpreadsheetApp.
  - Needs an owner Apps Script paste and redeploy.
