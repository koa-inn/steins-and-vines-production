---
phase: 34-ingredient-display-server-enrichment
reviewed: 2026-06-19T16:45:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - js/lib/constants.js
  - js/lib/recipe-grouping.js
  - js/modules/17-search-overlay.js
  - zoho-middleware/routes/recipes.js
  - js/admin.js
  - js/brewpad.js
  - js/kiosk.js
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
status: issues_found
---

# Phase 34: Code Review Report

**Reviewed:** 2026-06-19T16:45:00Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Seven files reviewed spanning the grouping helper, server enrichment, and three
render surfaces. The grouping logic (recipe-grouping.js), constants promotion
(constants.js), and search-overlay refactor (17-search-overlay.js) are clean.
The server enrichment in recipes.js correctly chains after `enrichWithComputedPrice`,
never touches money-path fields, and degrades gracefully when the cache is cold.
Index-integrity via `ingredients.indexOf(ing)` is sound across admin and BrewPad.

One Critical XSS is present in kiosk.js: `ing.quantity` is interpolated directly
into `innerHTML` without `escapeHTML`. Three Warnings cover an unescaped HTML
attribute in admin.js (quantity value), an unescaped class attribute in admin.js
(availability status), and a silent data-loss edge case in admin's remove-listener
when `indexOf` unexpectedly returns -1. Two Info items cover code-quality matters.

---

## Critical Issues

### CR-01: XSS — `ing.quantity` unescaped in kiosk.js `innerHTML`

**File:** `js/kiosk.js:1223`
**Issue:** `ing.quantity` is concatenated directly into an HTML string assigned to
`el.innerHTML` with no `escapeHTML` wrapper. All other dynamic values in this same
`<li>` (`ing.item_name`, `ing.unit`) are correctly escaped. `ing.quantity` comes
from the Apps Script / middleware response — while Zoho normally returns numeric
strings, a malformed or tampered API response containing `<script>` or event
handler syntax in the `quantity` field would execute in the kiosk context.
The CLAUDE.md non-negotiable rule states `escapeHTML` must wrap *all* dynamic HTML.
BrewPad's equivalent render at L3044/L3046 correctly uses `escapeHTML(String(ing.quantity || ''))`.

**Fix:**
```js
// js/kiosk.js L1223 — wrap ing.quantity exactly as brewpad.js does
html += '<li>' + escapeHTML(ing.item_name) + ' — '
      + escapeHTML(String(ing.quantity || ''))
      + ' ' + escapeHTML(ing.unit || '') + '</li>';
```

---

## Warnings

### WR-01: Unescaped `ing.quantity` in admin.js `value` HTML attribute

**File:** `js/admin.js:8795`
**Issue:** The `<input type="number">` for ingredient quantity writes `ing.quantity`
directly into the `value="..."` HTML attribute without `escapeHTML`:
```js
html += '<td><input type="number" class="admin-input ing-qty" value="' + (ing.quantity || '') + '"...
```
While Zoho returns numeric quantities, the project rule requires `escapeHTML` on all
dynamic HTML. A non-numeric string containing `"` would break out of the attribute
and inject arbitrary HTML attributes (e.g., `onfocus="..."`). Admin is authenticated,
but defense-in-depth applies. BrewPad's parallel code at L3044 correctly wraps with
`escapeHTML(String(ing.quantity || ''))`.

**Fix:**
```js
html += '<td><input type="number" class="admin-input ing-qty" value="'
      + escapeHTML(String(ing.quantity || ''))
      + '" step="0.01" min="0" inputmode="decimal" /></td>';
```

---

### WR-02: Unescaped `avail.status` in admin.js `class` HTML attribute

**File:** `js/admin.js:8780, 8800`
**Issue:** `dotClass` is constructed from `avail.status` (an availability endpoint
response field) and written directly into a `class="..."` attribute with no escaping:
```js
var dotClass = 'ing-status-dot ing-status-dot--' + (avail.status || 'unknown');
...
html += '<td><span class="' + dotClass + '" ...></span></td>';
```
The `/api/recipes/:id/availability` endpoint constrains `status` to `'out'|'low'|'ok'|'unknown'`
today, but if that invariant ever changes (or is bypassed by a cache injection), an
unescaped class attribute allows HTML attribute injection. Consistency with the
project's `escapeHTML` convention requires this to be wrapped.

**Fix:**
```js
var safeStatus = escapeHTML(avail.status || 'unknown');
var dotClass = 'ing-status-dot ing-status-dot--' + safeStatus;
// dotClass is now safe — but still pass the full class string through escapeHTML
// if building via innerHTML, or switch the span creation to DOM API.
```
Alternatively, and more robustly, validate `avail.status` against the known set
before concatenating:
```js
var VALID_STATUSES = { out: true, low: true, ok: true, unknown: true };
var statusKey = VALID_STATUSES[avail.status] ? avail.status : 'unknown';
var dotClass = 'ing-status-dot ing-status-dot--' + statusKey;
```

---

### WR-03: `splice(-1, 1)` silent data-loss if `indexOf` returns -1 in admin remove handler

**File:** `js/admin.js:8832-8833`
**Issue:** The remove-button listener reads `data-ing-idx` and calls
`_recipesState.currentIngredients.splice(idx, 1)`. The `data-ing-idx` attribute
is written as `ingredients.indexOf(ing)` (L8778). `Array.prototype.indexOf` returns
`-1` when the object is not found by identity. `splice(-1, 1)` in JavaScript removes
the **last** element of the array — silently deleting the wrong ingredient instead of
throwing or no-oping.

In normal operation `indexOf` will always find the element because the same object
references flow from source array through the grouping helper and back. However, if
any code path clones the ingredients array via `JSON.parse(JSON.stringify(...))` or
`Object.assign({})` before passing to `renderIngredientRows` (breaking reference
identity), clicking "remove" on any row would silently delete the last ingredient.
No current callsite does this, but there is no defensive guard.

**Fix:** Add a guard before splicing:
```js
var idx = parseInt(row.getAttribute('data-ing-idx'), 10);
if (isNaN(idx) || idx < 0) return; // guard against indexOf=-1 stored in attribute
_recipesState.currentIngredients.splice(idx, 1);
```

---

## Info

### IN-01: `resolveLabel` redundantly re-checks `CATEGORY_DISPLAY_NAMES` global at every call

**File:** `js/lib/recipe-grouping.js:49-51`
**Issue:** The IIFE at L21-29 already resolves `_labelMap` to `CATEGORY_DISPLAY_NAMES`
at module-load time (in both browser and Node contexts). `resolveLabel` then checks
`typeof CATEGORY_DISPLAY_NAMES !== 'undefined'` again at every call, potentially
using the global instead of `_labelMap`. In the browser the two are the same object
(fine). In Jest, if a test mutates `global.CATEGORY_DISPLAY_NAMES` after module load,
`resolveLabel` would pick up the mutation while `_labelMap` would not — creating a
test-vs-runtime inconsistency. The simpler and consistent approach is to always use
`_labelMap`.

**Fix:**
```js
function resolveLabel(raw) {
  return (_labelMap && _labelMap[raw]) || raw || 'Other';
}
```

---

### IN-02: Snapshot inconsistency — `notes` field missing from create-recipe path

**File:** `js/brewpad.js:5514-5520`
**Issue:** The recipe-attach snapshot (L3124-3129) carries `notes: snap.notes || ''`
in the `minimal` object. The create-recipe snapshot (L5514-5520) omits `notes`.
Phase 34's changes correctly added `cf_type`/`cf_subcategory`/`display_group` to
**both** paths, but the pre-existing `notes` gap was not addressed. Batches created
via the create-recipe flow will have snapshots without `notes`, while attach-path
batches have them. This inconsistency pre-dates Phase 34 but is visible here because
both paths were touched during the phase.

**Fix:** Add `notes` to the create-recipe path snapshot:
```js
var minimal = {
  name: snap.name, style: snap.style, abv: snap.abv,
  ibu: snap.ibu, batch_size_l: snap.batch_size_l, notes: snap.notes || '',
  ingredients: (data.ingredients || []).map(function (i) { ... })
};
```

---

## Structural Findings (fallow)

No structural pre-pass was provided for this phase.

---

_Reviewed: 2026-06-19T16:45:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
