---
phase: 36
plan: "05"
subsystem: kiosk-recipe-modify
tags: [kiosk, recipe, volume-scaling, ingredient-modification, ios-zoom-safe, tdd]
dependency_graph:
  requires: ["36-03"]
  provides: ["kiosk-recipe-volume-control", "kiosk-modify-panel", "kiosk-server-quote"]
  affects: ["js/kiosk.js", "kiosk.html", "js/kiosk.min.js"]
tech_stack:
  added: []
  patterns:
    - "Server-authoritative recipe quote via GET /api/kiosk/recipe-quote with modified_ingredients param"
    - "Deep-copy on first modify-panel expand (lazy clone, D-04)"
    - "data-ing-idx = ingredients.indexOf(ing) for flat-array splice safety (caveat #7)"
    - "iOS zoom guard: font-size:1rem on all inputs inside #kiosk-recipe-prompt"
key_files:
  created:
    - tests/frontend/kiosk-recipe-modify.test.js
  modified:
    - kiosk.html
    - js/kiosk.js
    - js/kiosk.min.js
decisions:
  - "No save-as-new affordance on kiosk surface (UI-SPEC §2 confirmed)"
  - "XSS test validates absence of live <script> elements in DOM (not innerHTML encoding) — attribute-value injection is benign; the real risk is innerHTML injection which escapeHTML prevents"
  - "Existing kiosk-recipe-quote.test.js tests admin.js; new kiosk-recipe-modify.test.js tests kiosk.js"
metrics:
  duration: "~25 minutes"
  completed: "2026-06-21"
  tasks_completed: 3
  files_changed: 4
---

# Phase 36 Plan 05: Kiosk Recipe Volume Control + Modify Panel Summary

Ported Phase 35 target-volume control + Phase 36 ingredient-modification panel to the standalone kiosk surface (kiosk.html / js/kiosk.js), which previously lacked both. The kiosk is now on parity with the admin surface for SEL-01/D-01 (identical volume control), SEL-02 (chosen size carries into the sale), MOD-01/MOD-02 (modify panel priced server-authoritatively via recipe-quote), and T-36-15 (XSS guard). Save-as-new is deliberately absent per UI-SPEC §2.

## What Was Built

**kiosk.html** — Ported Phase 35 `#kiosk-recipe-volume-wrap` (Target volume L input + scale factor readout) and Phase 35 `#kiosk-stock-conflict` (Manager Override block), and added Phase 36 `#kiosk-recipe-modify-wrap` (Modify Ingredients toggle, ingredient table with `#kiosk-modify-tbody`, `+ Add Ingredient` button, price preview, locked-price notice). All inputs have `style="font-size:1rem;"` for iOS Safari zoom prevention. `kiosk-save-as-new-btn` is NOT present (UI-SPEC §2).

**js/kiosk.js** — Full port of Phase 35 state vars + quote functions, plus Phase 36 modify panel logic:
- State: `_kioskTargetVolumeL`, `_kioskScaleFactor`, `_kioskStockOverride`, `_kioskQuote`, `_kioskQuoteTimer` (Phase 35), `_kioskModifiedIngredients`, `_kioskModifyPanelOpen`, `_kioskIngredientCatalog`, `_kioskCatalogLoaded` (Phase 36)
- `kioskFetchRecipeQuote` — hits `/api/kiosk/recipe-quote` with `target_volume_l` + `modified_ingredients` JSON param when non-null; 350ms debounce via `kioskScheduleRecipeQuote`; price preview updates `#kiosk-recipe-price-preview`
- `kioskLoadIngredientCatalog` — lazy, non-fatal; fetches `/api/ingredients?include_internal=1` for modify-panel autocomplete
- `renderKioskModifyRows` — grouped via `groupRecipeIngredients`, `data-ing-idx=indexOf(ing)`, `escapeHTML` on all dynamic names, iOS font-size guard on inputs
- `attachKioskModifyRowListeners` — remove/qty-change/search-autocomplete per row; each change calls `kioskScheduleRecipeQuote`
- `kioskShowRecipePrompt` — wires volume input (pre-fill + oninput), modify toggle (lazy deep-copy on first expand), add-row button; initial `kioskScheduleRecipeQuote()` call
- `kioskSelectSaleType` — added `kioskScheduleRecipeQuote()` call for re-quote on type change
- `kioskUpdateAddToCartButton` — uses `_kioskQuote.total` when available; appends `(Modified)` suffix when `_kioskModifiedIngredients` is non-null
- `processRecipeData` in `kioskAddRecipeToCart` — uses `_kioskQuote.ingredients` (scaled+modified) for cart line items; `target_volume_l` stored in `_kioskRecipeContext`
- Back button + `kioskClearCart` — reset `_kioskQuote`, `_kioskModifiedIngredients`, `_kioskModifyPanelOpen`, `_kioskTargetVolumeL`
- Test exports: `_kioskGetModifiedIngredients`, `_kioskSetModifiedIngredients`, `renderKioskModifyRows`, `kioskFetchRecipeQuote`, `kioskShowRecipePrompt`, Phase 35 accessors

**tests/frontend/kiosk-recipe-modify.test.js** — 15 tests covering:
- Volume input pre-fill + factor readout "1.0x base N L" (T1)
- `kioskFetchRecipeQuote` URL includes `target_volume_l` and `modified_ingredients` (T2)
- `kioskUpdateAddToCartButton` appends "(Modified)" suffix; uses quote total (T3)
- Source recipe immutability after edits — `_kioskModifiedIngredients` is a deep copy (T4)
- XSS: no live `<script>` elements injected into modify tbody (T5, T-36-15)
- `kioskSaveAsNewRecipe` is NOT exported from kiosk.js (T6, UI-SPEC §2)

**js/kiosk.min.js** — Rebuilt via `npm run build`; `modified_ingredients` URL param present in bundle.

## Task Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | 3460f6a | feat(36-05): port Phase 35 volume control + Phase 36 modify panel to kiosk.html |
| RED gate | ccd1067 | test(36-05): add failing tests for kiosk volume control + modify panel + XSS |
| Task 2 GREEN | 92704a6 | feat(36-05): port Phase 35 volume/quote + Phase 36 modify panel to js/kiosk.js |
| Task 3 | bffa37c | chore(36-05): rebuild kiosk bundle + update cache-bust stamps |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] XSS test expectation adjusted for DOM attribute serialization behavior**
- **Found during:** Task 2 (TDD GREEN phase)
- **Issue:** Test T5 checked `tbody.innerHTML.not.toContain('<script>')` — but jsdom correctly decodes attribute values in innerHTML serialization, making `&lt;script&gt;` appear as `<script>` in `value="..."` attribute output. This is safe behavior (attributes don't execute script) and the assertion was wrong.
- **Fix:** Changed test to assert `tbody.querySelectorAll('script').length === 0` — the actual XSS guard is that no live `<script>` DOM element is injected, which is what `escapeHTML` prevents.
- **Files modified:** tests/frontend/kiosk-recipe-modify.test.js
- **Commit:** 92704a6

## Threat Surface Scan

No new network endpoints were added. The kiosk surface already uses `x-api-key` on all middleware calls; the new `kioskFetchRecipeQuote` and `kioskLoadIngredientCatalog` both carry the key. The `modified_ingredients` param is client-provided but pricing is 100% server-authoritative (T-36-14 mitigated — no client-side price math). The `renderKioskModifyRows` function uses `escapeHTML` on all dynamic content (T-36-15 mitigated). No new trust boundaries introduced.

## Self-Check: PASSED

Files exist:
- `kiosk.html` — FOUND (31 insertions vs original)
- `js/kiosk.js` — FOUND (443 insertions)
- `js/kiosk.min.js` — FOUND (98919 bytes, `modified_ingredients` string present)
- `tests/frontend/kiosk-recipe-modify.test.js` — FOUND (428 lines)

Commits verified:
- 3460f6a FOUND (kiosk.html)
- ccd1067 FOUND (test file)
- 92704a6 FOUND (kiosk.js + test)
- bffa37c FOUND (kiosk.min.js)

Test results: 792 frontend tests pass; `kiosk-recipe-modify.test.js` 15/15 pass; `kiosk-recipe-quote.test.js` 17/17 pass.
