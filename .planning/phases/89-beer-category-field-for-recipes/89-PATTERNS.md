# Phase 89: Beer category field for recipes - Pattern Map

**Mapped:** 2026-10-14
**Files analyzed:** 27 (source/config/docs) plus 7 new test files and 8 pinned-test edits
**Analogs found:** 27 / 27 source files (one partial: migration 0006, no ALTER TABLE precedent)

Primary analog for every layer: the `pricing_mode` and `schedule_id` columns. Line numbers were read on 2026-10-14 and match 89-RESEARCH.md. Key differences from `pricing_mode`:
- `normalizeBeerCategory` returns `null` for invalid input (reject), unlike `normalizePricingMode` which coerces to `'locked'`.
- `undefined` means "untouched" on update. `''` clears the field.
- Postgres stores NULL for blank and reads back `''`.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `zoho-middleware/lib/recipe-rules.js` | utility | transform | same file, `normalizePricingMode` (:49-52) | exact |
| `apps-script/adminApi.gs` (ensure, normaliser, createRecipe, updateRecipe, mirrorRecipeState) | service | CRUD + sheet mirror | same file, `ensureRecipesPricingModeColumn` / `ensureRecipesScheduleIdColumn` (:4161-4194) and their call sites | exact |
| `zoho-middleware/migrations/0006_recipes_beer_category.sql` | migration | schema | `0003_recipes.sql` (columns inline in `create table`) | partial: first ALTER ADD COLUMN |
| `zoho-middleware/lib/recipe-pg.js` | service | CRUD | same file, `pricing_mode` handling (:249, :323), `schedule_id` (:90, :250) | exact |
| `zoho-middleware/scripts/backfill/specs/recipes.js` | config | batch | same file, `txt('schedule_id', false)` (:53) | exact |
| `zoho-middleware/scripts/backfill/recipes-verify.js` | utility | batch | same file, `RECIPE_FIELDS` (:34-38) | exact |
| `zoho-middleware/scripts/backfill/recipes-backfill.js` (optional off-list reject) | utility | batch | same file, `invalid_pricing_mode` reject (:164-166) | exact |
| `zoho-middleware/routes/recipes.js` (`checkBeerCategory`, `PUBLIC_RECIPE_FIELDS`) | route | request-response | same file: allowlist (:54), activation guard 422 (:769-785), POST (:729), PUT (:754) | exact |
| `js/lib/constants.js` (`BEER_CATEGORIES`) | config | n/a | same file: `KIT_CATEGORIES` / `module.exports` block | role-match |
| `js/modules/07-catalog-kits.js` (`recipeTintClass`, `buildRecipeCard`, stale comment) | component | transform | same file `buildRecipeCard` (:205-210) + `getTintClass` in `04-label-cards.js:3` | exact |
| `brewpad.html` / `admin.html` (select after Style) | component | request-response | Style field markup (brewpad.html ~:186-189, admin.html ~:572-575) | exact |
| `js/brewpad.js` (4 functions + Save-as-new copies) | component | request-response | same functions, `pricing_mode` lines | exact |
| `js/admin.js` (`populateRecipeForm`, `saveRecipe`, Save-as-new copy) | component | request-response | same functions, `pricing_mode` lines | exact |
| `docs/RUNBOOK.md` (D-14 callout, v63 deploy row, staging refresh) | docs | n/a | RUNBOOK Apps Script section (225-283), Phase 85 section (704-865) | role-match |
| Build artifacts (`js/main.js`, `*.min.js`, HTML `?v=`) | build | batch | `npm run build`, never hand-edit | n/a |

New tests (analogs in "Test Patterns" below): `tests/frontend/adminapi-recipe-beer-category.test.js`, `tests/frontend/catalog-recipe-tint.test.js`, a key-list drift test, editor carry tests, plus added cases in the existing DB, route, public-guard, backfill and migration tests.

## Pattern Assignments

### `zoho-middleware/lib/recipe-rules.js` (utility, transform)

**Analog:** same file. Pure module, ES5, no requires, line-for-line ports of the `.gs` functions, exported in a single object (:131-137).

**Existing pattern to extend** (:49-52, exports :131-137):
```javascript
/** Port of normalizePricingMode (adminApi.gs). */
function normalizePricingMode(value) {
  return value === 'dynamic' ? 'dynamic' : 'locked';
}
...
module.exports = {
  sanitizeInput: sanitizeInput,
  normalizePricingMode: normalizePricingMode,
  ...
};
```

**New code (from RESEARCH Normaliser Design, ES5):** add `var BEER_CATEGORY_KEYS = ['pilsner','lager','pale','ipa','amber','wheat','session','saison','stout','porter','redale','brown'];` and:
```javascript
// returns the canonical key, '' for blank, or null for invalid
function normalizeBeerCategory(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return null;
  if (value.trim() === '') return '';
  var key = value.toLowerCase().replace(/[^a-z]/g, '');
  return BEER_CATEGORY_KEYS.indexOf(key) === -1 ? null : key;
}
```
Export both `BEER_CATEGORY_KEYS` and `normalizeBeerCategory`. The identical function body goes in `adminApi.gs` (must not reference Apps Script globals, because the purity gate and the `new Function` parity eval both evaluate it).

---

### `apps-script/adminApi.gs` (service, CRUD + mirror)

**Analog:** same file, `ensureRecipesPricingModeColumn` / `ensureRecipesScheduleIdColumn`.

**Ensure helper** (:4161-4170; copy verbatim, rename):
```javascript
function ensureRecipesPricingModeColumn(sheet) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var idx = headers.indexOf('pricing_mode');
  if (idx === -1) {
    sheet.getRange(1, lastCol + 1).setValue('pricing_mode').setFontWeight('bold');
    return lastCol; // zero-based index of the newly added column
  }
  return idx;
}
```
Add next to `normalizePricingMode` (:4172): `BEER_CATEGORY_KEYS`, `normalizeBeerCategory` (same body as the middleware one), `ensureRecipesBeerCategoryColumn`.

**createRecipe** (:4196-4250). Validate BEFORE `acquireScriptLock` / `appendRow`, near the `name`/ingredients checks at :4197-4208:
```javascript
if (!payload.name) {
  return { ok: false, error: 'missing_fields', message: 'name is required' };
}
```
Add: `var bc = normalizeBeerCategory(payload.beer_category); if (bc === null) return { ok: false, error: 'invalid_data', message: 'Invalid beer_category' };`
Then after the existing two header-lookup writes (:4242-4250), add a third in the same shape:
```javascript
var scheduleCol = ensureRecipesScheduleIdColumn(recipesSheet);
recipesSheet.getRange(recipesSheet.getLastRow(), scheduleCol + 1)
  .setValue(sanitizeInput(payload.schedule_id || ''));
```
becoming `var bcCol = ensureRecipesBeerCategoryColumn(recipesSheet); recipesSheet.getRange(recipesSheet.getLastRow(), bcCol + 1).setValue(bc);`. Do NOT add it to the 16-cell positional `appendRow` (:4223-4240).

**updateRecipe** (:4329-4340). The ensure must run unconditionally, before the row read and before the single `invalidateSheetCache`:
```javascript
var pmCol = ensureRecipesPricingModeColumn(recipesSheet);
var schedCol = ensureRecipesScheduleIdColumn(recipesSheet);
invalidateSheetCache(RECIPES_SHEET_NAME);
```
Add `var bcCol = ensureRecipesBeerCategoryColumn(recipesSheet);` between the existing ensures. Validate the payload value before any write (before :4329 ensure calls or at least before any `setValue`). Write by the `pricing_mode` special-case shape (:4387-4392), not `stringFields` (:4362), because there is a reject path:
```javascript
if (payload.pricing_mode !== undefined && pmCol > 0) {
  rowValues[pmCol] = normalizePricingMode(payload.pricing_mode);
  if (minCol === null || pmCol < minCol) minCol = pmCol;
  if (maxCol === null || pmCol > maxCol) maxCol = pmCol;
}
```
Copy with `payload.beer_category !== undefined && bcCol > 0` and the canonical key (`''` clears).

**mirrorRecipeState** (:4716-4718): add the ensure beside the other two, inside the lock, before headers are read at :4720:
```javascript
ensureRecipesPricingModeColumn(recipesSheet);
ensureRecipesScheduleIdColumn(recipesSheet);
```
Without this, the value is silently dropped (rows are built from existing headers only, :4722-4725).

**Optional editor-run helper** (RESEARCH A3): `setupRecipeBeerCategoryColumn()` calling the ensure helper and `Logger.log`, modelled on `setupBatchMirrorNotices`. Do NOT add to `setupRecipeTabs` (:5181-5197 never got `schedule_id` either).

**Deploy note:** one deployment serves staging and prod; record v63 / rollback v62 in RUNBOOK (owner reads the live version).

---

### `zoho-middleware/migrations/0006_recipes_beer_category.sql` (migration, schema)

**Analog:** `zoho-middleware/migrations/0003_recipes.sql` for header style and markers. Existing files are `0001_init`, `0002_gift_cards`, `0003_recipes`, `0004_ops_data`, `0005_batches`. There is NO prior `ALTER TABLE ADD COLUMN`; 0006 is the first (verified allowed by guard + allowlist).

**Header comment style to copy** (0003 :1-4, :15-16):
```sql
-- 0003_recipes.sql — Phase 85 (DB-04): recipes + recipe_ingredients schema.
-- Additive only (D-04, Phase 83): nothing here drops, renames, or rewrites 0001/0002 objects.
-- Never edit this file once it has been applied to any environment — add a new migration instead.
...
-- Up Migration
create sequence ...
```
**Content (RESEARCH, verified):**
```sql
-- Up Migration
alter table recipes add column beer_category text;
-- Down Migration
alter table recipes drop column beer_category;
```
Optionally add `comment on column recipes.beer_category is 'app-level enum; see lib/recipe-rules.js';` (CommentStmt allowed). No `check (...)` (D-03), no data step, no backslashes. Gate: `cd zoho-middleware && npm run migrate:guard`.

---

### `zoho-middleware/lib/recipe-pg.js` (service, CRUD)

**Analog:** same file.

**RECIPE_COLUMNS** (:24-28): append `'beer_category'` last (after `'schedule_id'`). This alone drives `RECIPE_SELECT`, `LIST_SQL`, `GET_RECIPE_SQL`, `LOCK_RECIPE_SQL` and `rowToRecipe` (NULL becomes `''`, :106-107). Also update the header comment "18 recipe keys" (:16).
```javascript
var RECIPE_COLUMNS = [
  'recipe_id', 'name', ..., 'updated_at', 'pricing_mode', 'schedule_id'
];
```

**INSERT_RECIPE_SQL** (:64-67): add `beer_category` to the column list and `$17` to values (`$13` stays reused for `updated_at`):
```javascript
'... updated_at, pricing_mode, schedule_id) ' +
'values ($1, ..., $14, $13, $15, $16) returning recipe_id';
```

**createRecipe** (:181-251). Validate near the status/numeric checks (:204-219), before the insert, using the `invalid()` helper (:177-179):
```javascript
var status = payload.status || 'draft';
if (ALLOWED_STATUSES.indexOf(status) === -1) {
  return invalid('status must be draft, active or inactive');
}
```
Add `var bc = recipeRules.normalizeBeerCategory(payload.beer_category); if (bc === null) return invalid('beer_category is not a valid beer category');`. Append as the 17th insert param after `emptyToNull(recipeRules.sanitizeInput(payload.schedule_id || ''))` (:250): `emptyToNull(bc)`.

**updateRecipe** (:295-323). Special-case, NOT `UPDATE_STRING_FIELDS` (:90), because that loop has no reject path (:303-315). Place next to the `pricing_mode` line and BEFORE `LOCK_RECIPE_SQL` (:342) so a bad value returns `invalid_data`, never `stale_recipe`:
```javascript
if (payload.pricing_mode !== undefined) addSet('pricing_mode', recipeRules.normalizePricingMode(payload.pricing_mode));
```
New:
```javascript
if (payload.beer_category !== undefined) {
  var bc = recipeRules.normalizeBeerCategory(payload.beer_category);
  if (bc === null) return invalid('beer_category is not a valid beer category');
  addSet('beer_category', emptyToNull(bc));
}
```
(Mind `var` hoisting: `bc` is also declared in createRecipe only in that function scope, which is separate.)

Mirror needs no change: `recipe-mirror.mirrorLatest` reads the full PG row, so the key rides along.

---

### `zoho-middleware/scripts/backfill/specs/recipes.js` (config, batch)

**Analog:** same file (:35-54). Append after `txt('schedule_id', false)` (:53), with the comma:
```javascript
      txt('pricing_mode', true),
      txt('schedule_id', false)
```
becomes `txt('schedule_id', false),` + `txt('beer_category', false)`. Headers map by name, so order is irrelevant. D-14 warning: after this lands, `headerRejects` (recipes-backfill.js:126-131) rejects the whole Recipes sheet if the column is missing, and `--promote` fails on prod PG. Run backfill/verify/replay from a pinned `d2c66be9` worktree until 89 reaches production.

### `zoho-middleware/scripts/backfill/recipes-verify.js` (utility, batch)

**Analog:** same file `RECIPE_FIELDS` (:34-38). Append `'beer_category'`; `'' == null` must compare equal (see how other nullable text fields compare).

### `zoho-middleware/scripts/backfill/recipes-backfill.js` (optional, RESEARCH Open Question 1)

**Analog:** the reason-code-only reject pattern (:161-166):
```javascript
if (VALID_PRICING_MODES.indexOf(values.pricing_mode) === -1) {
  rejects.push(makeReject(specs.recipes.sheet, row.rowNumber, id, 'pricing_mode', 'invalid_pricing_mode'));
}
```
Add a sibling: non-blank `values.beer_category` not in `recipeRules.BEER_CATEGORY_KEYS` produces reason `invalid_beer_category` (code only, never the value).

---

### `zoho-middleware/routes/recipes.js` (route, request-response)

**Analog:** same file.

**Imports** (:1-12): add `var recipeRules = require('../lib/recipe-rules');` alongside `recipeStore`.

**Allowlist** (:49-54): append `'beer_category'` and update the comment block (D-16-style note that this is a deliberately public field):
```javascript
var PUBLIC_RECIPE_FIELDS = ['recipe_id', 'name', 'style', 'description', 'ferment_days'];
```
`toPublicRecipe` (:63-79) copies by `hasOwnProperty`, so a blank `''` arrives from PG; the card treats it as blank.

**Validation helper** (RESEARCH Code Examples; the repo has no `status(400)` today, only 422 with `code`, so D-04's 400 is new):
```javascript
function checkBeerCategory(payload) {
  if (payload.beer_category === undefined) return null;
  var key = recipeRules.normalizeBeerCategory(payload.beer_category);
  if (key === null) {
    return { error: 'Beer category must be one of: ' + recipeRules.BEER_CATEGORY_KEYS.join(', '), code: 'invalid_beer_category' };
  }
  payload.beer_category = key;
  return null;
}
```
**POST** (:729-733) and **PUT** (:754-791): first statement after reading payload (in PUT, after `payload.recipe_id` / `expected_updated_at` handling at :756-760, before the activation guard or at least before `validateIngredientUnits`):
```javascript
var bad = checkBeerCategory(payload); if (bad) return res.status(400).json(bad);
```
Existing response shape to match: `res.status(422).json({ error: '...', code: 'activation_locked_price' })` (:774-777).

---

### `js/lib/constants.js` (config)

**Analog:** same file. Plain `var` globals, then a CommonJS guard at the bottom (last lines):
```javascript
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CART_KEYS:     CART_KEYS,
    ...
    CATEGORY_DISPLAY_NAMES: CATEGORY_DISPLAY_NAMES
  };
}
```
Add `var BEER_CATEGORIES = [{ key: 'ipa', label: 'IPA' }, ...12 entries];` (ES5, ESLint `ecmaVersion: 5`) with a section-header comment in the file's `// ----` style, and add `BEER_CATEGORIES: BEER_CATEGORIES` to `module.exports`. This file reaches public pages via the `main.js` concat, `brewpad.html` (line 17) and `admin.html` (line 1140, defer).

---

### `js/modules/07-catalog-kits.js` (component, transform)

**Analog:** same file `buildRecipeCard` (:205-210) and `getTintClass` (`js/modules/04-label-cards.js:3-5`: `if (product.tint) return 'tint-' + product.tint.toLowerCase().replace(/\s+/g, '');`).

**Current:**
```javascript
function buildRecipeCard(recipe, doc) {
  var d = doc || (typeof document !== 'undefined' ? document : null);
  var card = d.createElement('div');
  card.className = 'label-beer';
```
**New (RESEARCH, whitelist first, short-circuit blank so existing Jest tests without the globals stay green):**
```javascript
function recipeTintClass(recipe) {
  var key = recipe && typeof recipe.beer_category === 'string' ? recipe.beer_category : '';
  if (!key) return '';
  for (var i = 0; i < BEER_CATEGORIES.length; i++) {
    if (BEER_CATEGORIES[i].key === key) return getTintClass({ tint: key });
  }
  return '';
}
// buildRecipeCard: var tint = recipeTintClass(recipe);
// card.className = 'label-beer' + (tint ? ' ' + tint : '');
```
`className` assignment only, never `innerHTML`. Also reword the stale `fetchActiveRecipes` doc comment (~:350-357, "Recipes carry no category field of any kind"). Export `recipeTintClass` if the module's test export block lists helpers (check the bottom `module.exports`). Never hand-edit `js/main.js`.

---

### `brewpad.html` and `admin.html` (component)

**Analog:** the Style field.

brewpad.html (~:185-188):
```html
<div class="bp-recipes-form-field">
  <label for="bp-recipe-style">Style</label>
  <input type="text" id="bp-recipe-style" class="bp-input" placeholder="e.g. American Pale Ale" />
</div>
```
admin.html (~:571-575):
```html
<div class="recipes-form-field">
  <label for="recipe-style">Style</label>
  <input type="text" id="recipe-style" class="admin-input" placeholder="e.g. American Pale Ale" />
</div>
```
Insert immediately after, a new field div with `<select id="bp-recipe-beer-category" class="bp-select">` (admin: `id="recipe-beer-category" class="admin-select"`) containing a static `<option value="">— None (gold) —</option>`; fill the other 12 from `BEER_CATEGORIES` in JS, or hard-code in HTML and rely on the drift test. Verify the select class names (`bp-select`, `admin-select`) against the existing pricing-mode select in each file before use.

---

### `js/brewpad.js` (component, request-response)

**Analog:** same functions, copy the neighbouring lines.

- `buildRecipePayload` (:776-795): after `style: formData.style || '',` add `beer_category: formData.beer_category || '',` (blank `''` is sent so a PUT clears it).
- `populateRecipeForm` (:2740-2755), guarded style:
  `if (get('bp-recipe-style')) get('bp-recipe-style').value = r.style || '';` then `if (get('bp-recipe-beer-category')) get('bp-recipe-beer-category').value = r.beer_category || '';`
- `bpCloneRecipePayload` (:3055-3070): `style: r.style || '',` then `beer_category: r.beer_category || '',`
- `readRecipeFormData` (:3368-3384):
  `style: get('bp-recipe-style') ? get('bp-recipe-style').value.trim() : '',` then `beer_category: get('bp-recipe-beer-category') ? get('bp-recipe-beer-category').value : '',`
- Kiosk/"Save as new" draft copies that copy `style` (RESEARCH: ~:2008-2020, ~:5428-5440): decision A4, one-line carry-over each. Verify exact lines with `grep -n "style:" js/brewpad.js` before editing.
- Drafts (`recipeDraftSnapshot` via `readRecipeFormData`, restored by `populateRecipeForm`) pick it up automatically.
- Error UX: `submitRecipeSave` already toasts `'Could not save recipe. ' + msg` for non-2xx; no change.

### `js/admin.js` (component, request-response)

**Analog:** same functions.

- `populateRecipeForm` (:8678-8695). Admin does not guard `getElementById`, but the `pricing_mode` select line does; copy that form:
  ```javascript
  var pricingModeSelect = document.getElementById('recipe-pricing-mode');
  if (pricingModeSelect) pricingModeSelect.value = r.pricing_mode || 'locked';
  ```
  Add `var beerCategorySelect = document.getElementById('recipe-beer-category'); if (beerCategorySelect) beerCategorySelect.value = r.beer_category || '';`
- `saveRecipe` (:9050-9066): beside
  `pricing_mode: document.getElementById('recipe-pricing-mode') ? document.getElementById('recipe-pricing-mode').value : 'locked',`
  add `beer_category: document.getElementById('recipe-beer-category') ? document.getElementById('recipe-beer-category').value : '',`
- Admin "Save as new" copy (~:11728-11745) optional, same as BrewPad. BeerXML import (~:9824) leaves it blank. Admin's generic save error message stays.

---

## Test Patterns

**Parity test** (`zoho-middleware/__tests__/recipe-rules-parity.test.js`, :18-26 and :41-47). Extend the `new Function(src + '\nreturn {' ...)` return list with `normalizeBeerCategory: normalizeBeerCategory, BEER_CATEGORY_KEYS: BEER_CATEGORY_KEYS`, and add a describe block in the existing shape:
```javascript
describe('normalizePricingMode', function () {
  ['dynamic', 'DYNAMIC', ' dynamic ', 'locked', '', null, undefined, 'x', 5].forEach(function (v, i) {
    it('vector ' + i + ' matches', function () {
      expect(rules.normalizePricingMode(v)).toEqual(gs.normalizePricingMode(v));
    });
  });
});
```
Vectors: `'IPA'`, `' Red Ale '`, `''`, `'   '`, `null`, `undefined`, `'purple'`, `'Pale Ale'`, `'123'`, `5`, `['ipa']`, `{}`, and each of the 12 keys.

**Apps Script fake-runtime test** (`tests/frontend/adminapi-recipe-beer-category.test.js`, new). Copy the harness from `tests/frontend/adminapi-recipe-schedule-column.test.js`: `fs.readFileSync(ADMIN_API_PATH)`, `new Function('SpreadsheetApp','Logger','LockService', src + 'return {...}')`, and `makeFakeSheet(headerRow)` (:21-70, records `setValue` / `setFontWeight` calls, `getLastColumn`, block `getRange(...).getValues()`). Reuse `makeFakeSheet` from `adminapi-recipe-mirror.test.js` for the mirror case.

**Card test** (`tests/frontend/catalog-recipe-tint.test.js`, new). Copy the setup of `tests/frontend/catalog-recipe-block.test.js` (:1-35: `global.KIT_CATEGORIES`, `global.fetch`, `global.SHEETS_CONFIG`, `global.formatCurrency`, `var mod = require('../../js/modules/07-catalog-kits.js')`), plus:
```javascript
global.BEER_CATEGORIES = require('../../js/lib/constants.js').BEER_CATEGORIES;
global.getTintClass = require('../../js/modules/04-label-cards.js').getTintClass;
```
(Confirm `04-label-cards.js` exports `getTintClass` under `module.exports`; if not, define the global inline.) The existing `catalog-recipe-block.test.js` className assertion (:68-71) stays green for blank categories and needs no edit (research prototype).

**Existing tests that must be edited (D-12, names must appear in the plan):**
- `zoho-middleware/__tests__/backfill/recipes-spec-headers.test.js` (append `beer_category` to `REAL_RECIPES_HEADERS`; rename the "18 real headers" title)
- `zoho-middleware/__tests__/backfill/recipes-backfill-plan.test.js:80` (18 to 19)
- `tests/frontend/adminapi-recipe-mirror.test.js` (`RECIPE_HEADERS_FULL` / `recipeObj`, legacy-header expectations, length 19)
- `zoho-middleware/__tests__/db/recipe-pg-read.test.js` + `fixtures/recipes-sheet-shape.json` (`"beer_category": ""` after `"schedule_id"`)
- Per research, the other tests listed in NOTES section 9 do not fail and are NOT edited, except adding `'beer_category'` to `ALLOWED_PUBLIC_FIELDS` in `recipes-public-guard.test.js` (:148, :226, :292) where D-12 permits it.

## Shared Patterns

### Enum normalise-then-reject (single semantics, three runtimes)
**Source:** `normalizeBeerCategory` (new) in `zoho-middleware/lib/recipe-rules.js`, mirrored in `apps-script/adminApi.gs`, key list in `js/lib/constants.js`.
**Apply to:** route (`checkBeerCategory`), `recipe-pg` create and update, Apps Script create and update, backfill reject.
Return contract: canonical key, `''` for blank, `null` for invalid. Keep the three key lists honest with a drift test that also checks each key has a `.tint-<key>` selector in `css/styles.css` (:4416-4430).

### `undefined` means untouched, `''` clears
**Source:** `if (payload.pricing_mode !== undefined)` guards (recipe-pg.js:323, adminApi.gs:4388). Editors always send a string.

### Validate before any write or lock
**Source:** `invalid(...)` before `INSERT` (recipe-pg.js:204-219) and before `LOCK_RECIPE_SQL` (:342). Apps Script: before `acquireScriptLock` / `appendRow` / any `setValue`.

### Build-by-allowlist public projection
**Source:** `routes/recipes.js:54-79`. Add only `beer_category`; keep a test that `status`, `locked_price`, `notes`, `pricing_mode` stay absent.

### Self-migrating sheet column (ensure before read)
**Source:** `ensureRecipes*Column` (adminApi.gs:4161-4194), called unconditionally before the row read and before the single cache invalidation in `updateRecipe` (:4338-4340) and inside the lock in `mirrorRecipeState` (:4717-4718).

### ES5 and lint
`js/` is ES5 (`ecmaVersion: 5`, `eslint js/ --max-warnings 0`); middleware lint is `eslint routes/ lib/ scripts/ server.js --max-warnings 0`. Build once, in the last frontend plan (`npm run build`), then `bash scripts/check-artifact-drift.sh`.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `0006_recipes_beer_category.sql` ALTER TABLE statement | migration | schema | No prior `ALTER TABLE ... ADD COLUMN` in `migrations/`; 0003-0005 are pure creates. Use the RESEARCH-verified SQL. |
| RUNBOOK "2026-10-14 staging refresh procedure" | docs | n/a | CONTEXT cites it but it is not in `docs/RUNBOOK.md`; write a new subsection (RESEARCH Staging UAT Path). |
| Pinned-worktree callout for D-14 | docs | n/a | New procedure (RESEARCH D-14 section). Do not edit `85-13-PLAN.md` or its pin. |

## Metadata

**Analog search scope:** `zoho-middleware/{lib,routes,migrations,scripts/backfill,__tests__}`, `apps-script/adminApi.gs`, `js/{lib,modules}`, `js/brewpad.js`, `js/admin.js`, `brewpad.html`, `admin.html`, `tests/frontend`
**Files read for excerpts:** recipe-rules.js, recipe-pg.js (3 ranges), routes/recipes.js (2 ranges), adminApi.gs (4 ranges), specs/recipes.js, recipes-verify.js, recipes-backfill.js (range), 0003_recipes.sql, 07-catalog-kits.js (range), 04-label-cards.js (range), constants.js, brewpad/admin html and js ranges, 2 test files
**Pattern extraction date:** 2026-10-14
