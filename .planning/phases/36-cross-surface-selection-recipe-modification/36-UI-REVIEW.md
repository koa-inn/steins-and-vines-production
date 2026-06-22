# Phase 36 — UI Review: Recipe Modify / Sale Region

**Audited:** 2026-06-22
**Baseline:** 36-UI-SPEC.md (approved design contract)
**Screenshots:** not captured (no dev server running — code-only audit)
**Surfaces in scope:** admin.html `#kiosk-recipe-prompt`, kiosk.html `#kiosk-recipe-prompt`, brewpad.html `#bp-recipe-attach-expanded`

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Copy is mostly correct; one wrong label ("× factor:" trailing colon on BrewPad); "Save as new recipe" placed above action buttons on admin surface, disrupting the claimed order |
| 2. Visuals | 1/4 | No scroll container on kiosk `#kiosk-recipe-prompt` (overflow:hidden parent); `#bp-recipe-attach-expanded` clipped by `bp-batches-panel overflow:hidden`; no visible price affordance when modify panel is closed; no CSS styling on price-preview element (no background, border, or padding) |
| 3. Color | 2/4 | Kiosk autocomplete dropdown hardcodes `background:#fff` (should be `--cellar-raised`) and `border:1px solid #ccc` (should use `--cellar-border`); no CSS class applied to price-preview div (color contract not enforced) |
| 4. Typography | 2/4 | `admin.js` modify-row `ing-search` and `ing-qty` inputs use `.admin-input` at 13px — no `font-size:1rem` override — so the admin kiosk surface will trigger iOS auto-zoom on an iPad; kiosk surface fixes this with a per-file CSS override but only for the volume inputs, not the ingredient rows |
| 5. Spacing | 2/4 | `kiosk.css` does not define `--sp-*` tokens in `:root` (only fallback literals in the volume-row rules); `#kiosk-recipe-price-preview` has no padding/border/background — its content is raw inline text with no visual container; `#kiosk-save-as-new-wrap` ordering in admin.html violates spec (appears before sale-type buttons, not after Add-to-Cart) |
| 6. Experience Design | 1/4 | GAP-4 unfixed: live price is ONLY shown when `_kioskModifyPanelOpen === true` (lines admin.js:11031, 11043, 11056, 11066; kiosk.js:801, 813, 826, 836); GAP-5 unfixed: `kiosk-product-pane` is `overflow:hidden` with no inner scroll container for `#kiosk-recipe-prompt`; BrewPad `bp-recipe-attach-expanded` is clipped by `bp-batches-panel overflow:hidden`; `bp-ing-remove` touch target is 36px × 36px (spec: 44px × 44px); `admin-btn-sm` on save-as-new button has `min-height:unset` |

**Overall: 11/24**

---

## Recommended Element Order + Scroll Structure for the Modify/Sale Panel

This is the structure all three surfaces should converge on. It satisfies GAP-4 (visible price) and GAP-5 (full scrollability) on iPad.

```
#kiosk-recipe-prompt (or bp-recipe-attach-expanded)
  — MUST be a flex column with overflow-y:auto and a bounded height
  — On kiosk: height:100% within a flex parent that itself has flex:1 + min-height:0

  1. Back button + recipe name           [flex-shrink:0 — always visible]
  2. #kiosk-recipe-summary              [flex-shrink:0]
  3. #kiosk-recipe-volume-wrap          [flex-shrink:0]
     Volume (L) input | × factor input  [flex row]
     "1.50× base 20.0 L" readout
  4. #kiosk-recipe-modify-wrap          [flex-shrink:0]
     "Modify Ingredients" toggle
     (expanded) ingredient table
     (expanded) "+ Add Ingredient"
  5. #kiosk-recipe-price-preview        [styled card, flex-shrink:0, NOT inside modify-wrap]
     "Estimated total: $XX.XX" — ALWAYS VISIBLE once sale-type is selected,
     updated on every volume/factor/ingredient change regardless of panel state
  6. #kiosk-locked-price-notice         [flex-shrink:0]
  7. #kiosk-stock-conflict              [flex-shrink:0]
  8. #kiosk-avail-banner                [flex-shrink:0]
  9. Sale-type buttons + milling toggle  [flex-shrink:0]
  10. #kiosk-add-recipe-to-cart         [sticky or flex-shrink:0]
  11. #kiosk-save-as-new-wrap           [flex-shrink:0, BELOW add-to-cart]
```

Scroll strategy: items 1–3 should be `flex-shrink:0` so they stay accessible. Items 4–11 scroll within the bounded container. The Add-to-Cart button may optionally be `position:sticky; bottom:0` within the scroll container so it remains reachable without scrolling all the way down.

---

## Top 3 Priority Fixes

1. **GAP-5: No scroll container on kiosk `#kiosk-recipe-prompt` (kiosk.html + admin.html kiosk tab)** — On a recipe with 10+ ingredients + expanded modify panel, the Add-to-Cart and sale-type buttons are unreachable. Staff cannot complete a sale on longer recipes. Fix: Change `.kiosk-product-pane` in `kiosk.css` and `admin.css` so that `#kiosk-recipe-prompt` gets `overflow-y:auto; -webkit-overflow-scrolling:touch; height:100%` while the grid views retain their current scroll behaviour. The cleanest approach: give `#kiosk-recipe-prompt` an explicit `height:100%; overflow-y:auto; -webkit-overflow-scrolling:touch` style (or a CSS class `.kiosk-recipe-scroll-view`) when it replaces the product/recipe grid.

2. **GAP-4: Live price only shown when modify panel is open** — Staff see a stale base price in `#kiosk-recipe-summary-price` after changing volume/factor. They have no confidence the displayed price equals what will be charged. Fix (three parts): (a) Remove the `_kioskModifyPanelOpen` gate from all four write paths in `kioskFetchRecipeQuote` (admin.js:11031/11043/11056/11066; kiosk.js:801/813/826/836). (b) Move `#kiosk-recipe-price-preview` out of `#kiosk-recipe-modify-wrap` in the HTML and place it as a standalone element between `#kiosk-recipe-modify-wrap` and `#kiosk-stock-conflict`. (c) Show the price preview element as soon as a sale-type is selected (not only when modify is open). The `#kiosk-recipe-summary-price` div should then be updated by `kioskFetchRecipeQuote` on success (or remain as a fallback display).

3. **BrewPad `#bp-recipe-attach-expanded` is clipped by `overflow:hidden` parent** — When a recipe with many ingredients is selected in the attach flow, the modify panel + Attach Recipe button overflow and are cut off by `.bp-batches-panel { overflow:hidden }`. Fix: Move `#bp-recipe-attach-expanded` out of the static HTML and inject it dynamically into `sectionBodyEl` (which lives inside `.bp-batch-detail-pane`, which already has `overflow-y:auto`). When `wireAttachExpandedPanel(b, sectionBodyEl)` is called, append the expanded panel's content into `sectionBodyEl` rather than toggling a global element's display. This is a one-time DOM restructure: the `#bp-recipe-attach-expanded` in `brewpad.html` becomes a template fragment or is removed from the static HTML entirely.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

**PASS — most copy matches the spec exactly.** The following specific deviations were found:

**WARNING — BrewPad `× factor:` label has a spurious trailing colon (brewpad.html:103)**
The spec (Copywriting Contract) states the label is `"× factor"` (no colon). The admin and kiosk surfaces correctly use `&times; factor` (no colon). BrewPad uses `&times; factor:` (colon present). This is a copy inconsistency, not a functional defect. Fix: remove the `:` from line 103 of `brewpad.html`.

**WARNING — `#kiosk-save-as-new-wrap` appears before the sale-type buttons in admin.html (line 669 vs 678)**
The spec's corrected element order (GAP-2 section) requires: "Sale/attach action buttons → Save-as-new affordance." In admin.html the `#kiosk-save-as-new-wrap` div renders at line 669, before `kiosk-sale-type-btns` (line 678) and `kiosk-add-recipe-to-cart` (line 687). Visually, "Save as new recipe" appears above the sale-type buttons rather than below "Add to Cart." Staff will see a secondary action before they can even select a sale type. Fix: move `#kiosk-save-as-new-wrap` in admin.html to after `#kiosk-add-recipe-to-cart` (line 688+).

**PASS — Modify toggle label, empty-state, Add Ingredient, volume label, price preview strings all correct.**
The JS renders `'No ingredients — use ‘+ Add Ingredient’ to build a custom list'` using the Unicode single-quote characters, which matches the spec. Toggle state labels ("Modify Ingredients" / "Modify Ingredients ▲") are correct on all three surfaces. "Add to Cart (Modified)" suffix logic is wired correctly in `kioskUpdateAddToCartButton`.

**PASS — Locked-price notice copy exact.**
`kiosk.html:138` and `admin.html:657` inline the correct notice text verbatim.

**PASS — No-base disabled copy correct on all three surfaces** (`"Set batch size (L) on this recipe to enable scaling"`).

---

### Pillar 2: Visuals (1/4)

**BLOCKER — No scroll container for `#kiosk-recipe-prompt` on kiosk.html and admin kiosk tab**
`.kiosk-product-pane` has `overflow:hidden` (kiosk.css:409; admin.css:2202). `#kiosk-recipe-prompt` is a direct child of `.kiosk-product-pane` with no CSS class and no `overflow-y:auto` of its own. When the modify panel expands on a recipe with many ingredients, the content overflows its parent and is clipped. The sale-type buttons and Add-to-Cart button become unreachable. This is the owner-confirmed blocker from GAP-5.

**BLOCKER — `#bp-recipe-attach-expanded` clipped by `bp-batches-panel overflow:hidden`**
`.bp-batches-panel { overflow:hidden; padding-bottom:0 }` (brewpad.css:515-518). `#bp-recipe-attach-expanded` is a sibling of `.bp-batches-layout` inside `.bp-batches-panel`, not inside `.bp-batch-detail-pane` (which scrolls). When the expanded panel is shown with `style.display=''` via JS, it renders in normal document flow below `.bp-batches-layout` and is clipped. On a recipe with 8+ ingredients plus the modify panel expanded, the Attach Recipe button is cut off.

**BLOCKER — No prominent live price affordance when modify panel is closed (GAP-4)**
The `#kiosk-recipe-price-preview` element is nested inside `#kiosk-recipe-modify-wrap` and all four write paths in `kioskFetchRecipeQuote` (and `admin.js` equivalents) are gated on `_kioskModifyPanelOpen`. When the modify panel is collapsed (the default and common state), the element has `display:none` and is never updated. The `#kiosk-recipe-summary-price` div shows the static `computed_price` from the recipe list endpoint and is never updated from the live quote on volume or factor change. Staff must open the modify panel to see a live price even if they only changed the volume. The quote is fetched (wasted network call) but the result is silently discarded when the panel is closed.

**WARNING — `#kiosk-recipe-price-preview` has no visual container styling**
The spec requires: "background --cellar-raised, border 1px solid --ledger-line, border-radius --r-md, padding --sp-3 --sp-4." The element has only `style="display:none;"` in the HTML; the JS writes raw `innerHTML` text into it with no wrapping class. The div renders as unstyled inline text against whatever the parent background is — no card, no separation from surrounding elements.

**WARNING — Visual hierarchy is weak for the price display before sale-type selection**
`#kiosk-recipe-summary-price` is sized at `1.1rem / font-weight:700 / color:var(--barrel)` (inline style in JS). After sale-type selection, the volume-adjusted price should be the dominant visual element (staff need to verify the charge amount before tapping Add to Cart). Currently the summary price never updates from the static computed_price once displayed, so it may be wrong or stale.

**WARNING — No visual separator between volume-wrap and modify-wrap sections**
The two control blocks (`#kiosk-recipe-volume-wrap` and `#kiosk-recipe-modify-wrap`) stack with no margin, border, or spacing between them. On a small screen the "Modify Ingredients" toggle button immediately follows the scale readout with no gap, making the page feel dense.

---

### Pillar 3: Color (2/4)

**WARNING — Kiosk autocomplete dropdown uses hardcoded `background:#fff` (kiosk.js:963)**
The spec mandates `background:var(--cellar-raised)` (#faf8f2) for the dropdown. The kiosk.js builds the dropdown with an inline `style.cssText = 'position:absolute;z-index:200;background:#fff;border:1px solid #ccc;...'`. On the warm-toned kiosk background (#e8e2ca and #faf8f2), a pure white dropdown stands out as visually jarring and inconsistent with the cellar palette. The border `1px solid #ccc` also departs from `--cellar-border` / `--ledger-emphasis`. Fix: replace inline cssText with the `.ing-autocomplete-drop` class (already defined in admin.css line 3119-3131, which uses cellar-raised and the correct border color) and add a matching rule to `kiosk.css`.

**WARNING — No CSS class governs `#kiosk-recipe-price-preview` color or background**
The spec declares the loading state should use `--ink-tertiary` and the error state `--batch-danger`. The JS directly writes `<span style="color:var(--ink-tertiary);">` and `<span style="color:var(--batch-danger);">` inline. While the token references are correct, the container has no background, border, or structural color treatment from CSS. The element is visually invisible when empty or loading.

**PASS — Accent color (`--stain`) correctly reserved.**
`#kiosk-add-recipe-to-cart` (`.btn` / `--stain`), `#bp-recipe-attach-confirm-btn` (`.btn` / `--stain`). The "Modify Ingredients" toggle is `.btn-secondary` (transparent background, stain border) — correct secondary treatment. The "Save as new recipe" button uses `.admin-btn-sm` on admin surface and `.btn-secondary.bp-btn-sm` on BrewPad — not accent. Correct.

**PASS — Locked-price notice uses `color:var(--ink-tertiary)` inline (kiosk.html:656/admin.html:656) — matches spec.**

**PASS — Availability banners use correct semantic colors** (`.kiosk-avail-warning` uses `--batch-warning` border; `.kiosk-avail-block` uses `--batch-danger` background).

**PASS — BrewPad stock advisory uses `.bp-toast--warning`** per spec (brewpad.html:120).

---

### Pillar 4: Typography (2/4)

**BLOCKER — `admin.js` modify-row inputs have no `font-size:1rem` override (admin.js:11106-11112)**
The admin kiosk surface renders ingredient rows with `.admin-input` class. In `admin.css`, `.admin-input { font-size: 13px }` (line 400). The kiosk surface of admin.html runs on an iPad where iOS Safari auto-zooms on any focused input with `font-size < 16px`. The `ing-search` (text) and `ing-qty` (number) inputs in the modify rows will trigger zoom, making the modify panel unusable. In contrast, `kiosk.html` uses `kiosk.css` where `.admin-input { font-size: 1rem }` (line 177) — the fix already exists in kiosk.css but is not applied to the admin surface's kiosk tab. Fix: either add `style="font-size:1rem;"` to each input in `renderKioskModifyRows` in `admin.js`, or add a scoped CSS rule in `admin.css`: `#tab-kiosk .admin-input { font-size: 1rem; }`.

**WARNING — kiosk.js modify-row inputs use `style="font-size:1rem;"` inline (kiosk.js:895, 898)**
The `ing-search` and `ing-qty` inputs in kiosk.js do apply `font-size:1rem` via inline style — this is correct for iOS safety but brittle. A better approach is a CSS class rule in `kiosk.css` for `.kiosk-recipe-modify-table .admin-input { font-size: 1rem; min-height: 44px; }`. This also addresses the missing min-height on those inputs (see Spacing pillar).

**PASS — Volume inputs have correct typography.**
`.kiosk-volume-input { font-size: 1rem }` in kiosk.css:2783 covers both the litres and factor inputs on the kiosk surface. `bp-volume-input` inherits `font-size:16px` from `.bp-input` (brewpad.css:2214). Admin surface `kiosk-volume-input` at admin.css:2987 uses `font-size: 13px` — this is the admin kiosk volume input. The admin volume inputs are technically in the kiosk tab of admin and could also trigger iOS zoom. However admin.html's kiosk tab is a desktop/embedded admin surface, not the iPad-primary kiosk surface (`kiosk.html`), so this is a WARNING not a BLOCKER.

**PASS — Scale readout typography correct on all surfaces:** `font-weight:700`, `font-size:13px` (kiosk.css:2804, admin.css:3007, brewpad.css:2665).

**PASS — Two font weights (400, 700) in use across the region; no extra weights introduced.**

---

### Pillar 5: Spacing (2/4)

**WARNING — `#kiosk-save-as-new-wrap` placed incorrectly in admin.html element order**
Spec GAP-2 ordering: action buttons (sale-type + Add-to-Cart) → save-as-new affordance. In admin.html the save-as-new wrap is at line 669, before `kiosk-sale-type-btns` (678) and `kiosk-add-recipe-to-cart` (687). Staff land on the secondary save-as-new action before they can even tap the primary Add-to-Cart. Correct order in kiosk.html is also wrong in a different way: there is no save-as-new in kiosk.html (correct per spec D-05) but the ordering issue in admin.html still stands.

**WARNING — `kiosk.css` does not define `--sp-*` spacing tokens in `:root`**
The volume-row CSS in kiosk.css uses `var(--sp-4, 16px)`, `var(--sp-1, 4px)`, etc., with fallback literals. This works but means the project-standard spacing token system is incomplete in kiosk.css. Any future rule that omits the fallback literal will silently collapse to `0` or `initial`. Admin.css defines all `--sp-*` tokens in `:root` (lines 44-49). kiosk.css should add `--sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-6: 24px; --sp-8: 32px;` to its `:root` block.

**WARNING — `#kiosk-recipe-price-preview` has zero padding, border, or background**
Spec: `padding: --sp-3 --sp-4; border: 1px solid --ledger-line; border-radius: --r-md; background: --cellar-raised`. Actual: no CSS class. The element is an unstyled div whose only styling comes from inline `innerHTML` text. This is a missing-class gap, not just a spacing detail — the element reads as undifferentiated body text.

**WARNING — Gap between `#kiosk-recipe-volume-wrap` and `#kiosk-recipe-modify-wrap` is 0**
Neither element has margin-bottom on the volume-wrap or margin-top on the modify-wrap. Spec says `--sp-6` (24px) between volume section and modify section. Admin.css defines `#kiosk-recipe-volume-wrap { margin-bottom: var(--sp-4) }` (16px — not the spec's --sp-6). kiosk.css has no `#kiosk-recipe-volume-wrap` rule at all.

**PASS — `.kiosk-volume-row { gap: 16px }` and `.kiosk-volume-label { gap: 4px }` match spec.**

**PASS — BrewPad `.bp-volume-row`, `.bp-volume-label` spacing matches spec.**

---

### Pillar 6: Experience Design (1/4)

**BLOCKER — GAP-4: Price display never updates when modify panel is closed (admin.js + kiosk.js)**
All four write paths in `kioskFetchRecipeQuote` (and the identical admin.js equivalent) are gated on `_kioskModifyPanelOpen`:
- kiosk.js line 801: `if (previewEl && _kioskModifyPanelOpen)` — "Calculating…" only shown in open state
- kiosk.js line 813: `if (el && _kioskModifyPanelOpen)` — result only written in open state
- kiosk.js line 826: `if (errEl && _kioskModifyPanelOpen)` — error only shown in open state
- kiosk.js line 836: `if (errEl2 && _kioskModifyPanelOpen)` — catch branch also gated

The quote IS fetched on volume and factor change (kioskScheduleRecipeQuote fires correctly). The server responds correctly. But the response is silently discarded when the panel is closed. The `_kioskQuote` value IS stored (line 810: `_kioskQuote = result.data`) and used in `kioskUpdateAddToCartButton` to update the button label — so the Add-to-Cart button does show the right price. But the button is only visible AFTER a sale type is selected, and the prominent summary price (`#kiosk-recipe-summary-price`) is NEVER updated from the quote. Result: staff see the wrong (base) price in the summary area and a correct price only on the Add-to-Cart button after sale-type selection.

**BLOCKER — GAP-5: Recipe-prompt overflows and clips action buttons (kiosk + admin kiosk + BrewPad)**
- kiosk.html: `#kiosk-recipe-prompt` is inside `.kiosk-product-pane { overflow:hidden }` with no scroll container. The product grid scrolls internally but the recipe prompt has no equivalent.
- admin.html kiosk tab: identical structure — `.kiosk-product-pane { overflow:hidden; }` (admin.css:2202).
- brewpad.html: `#bp-recipe-attach-expanded` is inside `.bp-batches-panel { overflow:hidden }` (brewpad.css:516) but NOT inside the scrollable `.bp-batch-detail-pane`. The attach button is clipped.

**BLOCKER — BrewPad `bp-ing-remove` touch target is 36px × 36px (brewpad.css:2537-2539), below the 44px spec**
The spec (Spacing section, Implementation Notes) states "The ingredient-row Remove button must meet 44px × 44px minimum on these surfaces." `.bp-ing-remove { min-height: 36px; min-width: 36px }` in brewpad.css fails this by 8px in each dimension. On a moving iPad, 36px targets cause mis-taps. Fix: `min-height: 44px; min-width: 44px; padding: 10px 12px;` on `.bp-ing-remove`.

**WARNING — `admin-btn-sm` in kiosk.css has `min-height: unset` (kiosk.css:168)**
The "Save as new recipe" button on the admin kiosk surface uses `class="admin-btn-sm"`. In kiosk.css, `.admin-btn-sm { padding:4px 12px; font-size:12px; min-height:unset; }`. This gives a rendered height of approximately 24px — far below the 44px touch target requirement. Admin.css `.admin-btn-sm` also has no `min-height` (only `padding` and `font-size`). The save-as-new affordance will be difficult to tap accurately on a touch device. Fix: add `min-height: 44px` to `.admin-btn-sm` in both admin.css and kiosk.css, or use a different CSS class for this button that doesn't strip the height.

**WARNING — `.admin-input` in modify rows has no `min-height` guarantee on the admin surface**
`admin.css` `.admin-input` has no `min-height` property (lines 395-410). The `ing-search` (text autocomplete) and `ing-qty` (number) inputs in the modify rows will render at browser default height (~30px) — below the 44px touch target requirement. In kiosk.css, `.admin-input` also has no min-height. The kiosk volume inputs are correct (`.kiosk-volume-input { min-height: 44px }`) but the modify-row inputs use the `.admin-input` class which has no such rule. Fix: add `#kiosk-recipe-modify-table .admin-input, .kiosk-recipe-modify-table .admin-input { min-height: 44px; }` to both admin.css and kiosk.css.

**WARNING — Save-as-new wiring gap: `kioskUpdateAddToCartButton` in admin.js exposes `#kiosk-save-as-new-wrap` (line 11660), but `#kiosk-save-as-new-wrap` is NOT present in kiosk.html**
kiosk.js correctly excludes the save-as-new flow (per the "intentionally NOT exported" comment at kiosk.js:4783). But admin.js's `kioskUpdateAddToCartButton` references `#kiosk-save-as-new-wrap` — on the admin surface this element exists and works. On any surface that uses admin.js but lacks the element, `getElementById` returns null safely. No bug, but the save-as-new button on the admin kiosk surface appears at line 669 (before sale-type buttons), has min-height:unset, and uses class `admin-btn-sm` which is styled as a small text link. This combination means the affordance is both mispositioned and undersized.

**WARNING — Empty modify-panel state: `_kioskModifiedIngredients = null` check vs spec**
Spec says the empty-state placeholder row renders "only when the modify panel has been expanded AND all ingredients have been removed." The JS in kiosk.js:876 checks `if (!ingredients || ingredients.length === 0)` — if `_kioskModifiedIngredients` is null (never expanded) this renders the placeholder. But `renderKioskModifyRows` is only called when the panel is expanded (modifyToggle.onclick or addRowBtn.onclick), so null is only possible if "+ Add Ingredient" is clicked before any expand — which is blocked since the button is hidden until the panel opens. This is fine in practice. However, if `_kioskModifiedIngredients` is set to an empty array `[]` (the `addRowBtn.onclick` path when it starts with a null list), `renderKioskModifyRows` would show the empty-state placeholder before a row is added, then immediately add a blank row. This is acceptable per spec ("A freshly-added blank row is acceptable").

**PASS — Quote fetch triggers (volume, factor, qty change, add row, remove row) are all wired correctly.**
Volume oninput (admin.js:11392, kiosk.js:1555) → `kioskScheduleRecipeQuote`. Factor oninput (admin.js:11413, kiosk.js:1578) → `kioskScheduleRecipeQuote`. Qty change (admin.js:11145, kiosk.js:935) → `kioskScheduleRecipeQuote`. Remove (admin.js:11133, kiosk.js:923) → `kioskScheduleRecipeQuote`. Add row (admin.js:11488, kiosk.js:1674) → `kioskScheduleRecipeQuote`. All correct.

**PASS — Debounce is 350ms on all paths.**
`kioskScheduleRecipeQuote` uses `setTimeout(kioskFetchRecipeQuote, 350)` (admin.js:11076, kiosk.js:846).

**PASS — Ingredient catalog lazy-load on modify panel first expand.** Both kiosk.js (line 1654: `kioskLoadIngredientCatalog()`) and admin.js (GAP-1 fix, line 11209-11214: loads `_recipesState.catalog` on expand) guard against this. BrewPad (brewpad.js:4036) also lazy-loads on wireAttachExpandedPanel call. GAP-1 confirmed fixed.

**PASS — `_kioskModifiedIngredients = null` reset on recipe change (admin.js:11446, kiosk.js:1611) prevents stale modifications carrying forward.**

**PASS — BrewPad does not trigger any quote/charge on factor or volume change** (brewpad.js:4093: "No kioskScheduleRecipeQuote / recipe-quote / recipe-sale / Helcim call — D-10").

---

## UI-SPEC Update Notes

The following gaps in the UI-SPEC should be addressed in the next spec revision:

1. **Scroll container specification is absent.** The spec describes element ordering but does not specify the CSS scroll model for `#kiosk-recipe-prompt` or `#bp-recipe-attach-expanded`. Add: "The recipe prompt / attach expanded panel MUST be a scrollable flex column. On kiosk and admin surfaces: `#kiosk-recipe-prompt` receives `height:100%; overflow-y:auto; -webkit-overflow-scrolling:touch` (or equivalent class). On BrewPad: `#bp-recipe-attach-expanded` must be rendered inside `bp-batch-detail-pane` (or equivalent scrollable container), not as a sibling of `.bp-batches-layout`."

2. **Price preview visibility contract needs clarification.** The spec (GAP-2 section, step 6) lists price preview in the ordered list but does not state it must be visible when the modify panel is collapsed. The spec's own "Modify-Price Preview: Display Rules" table lists the trigger events but not the visibility condition. Add: "The price preview element MUST be visible at all times after a sale-type is selected, regardless of whether the Modify Ingredients panel is open or closed. The `_kioskModifyPanelOpen` gate MUST NOT be applied to any write path in `kioskFetchRecipeQuote`."

3. **`bp-ing-remove` touch target specification should be in the BrewPad surface section, not only in the Spacing section.** Currently "44px × 44px Remove button" is in the Spacing exceptions table but `.bp-ing-remove` in brewpad.css is 36px. Add explicitly to the BrewPad surface section: "`.bp-ing-remove { min-height: 44px; min-width: 44px }`."

4. **`admin-btn-sm` used on save-as-new button violates the 44px touch target.** Either the spec should prohibit `admin-btn-sm` on touch surfaces or define a safe minimum. Recommend: replace `class="admin-btn-sm"` on `#kiosk-save-as-new-btn` in admin.html with `.btn-secondary` (standard secondary with min-height:44px already from kiosk.css), visually de-emphasised via font-size or max-width rather than by stripping the height.

---

## Consolidated Fix List

### Critical (BLOCKER)

| # | Surface(s) | Element / Selector | Defect | Concrete Fix |
|---|-----------|-------------------|--------|--------------|
| C1 | kiosk.html, admin.html | `.kiosk-product-pane`, `#kiosk-recipe-prompt` | No scroll container — action buttons unreachable on long recipes (GAP-5) | Add CSS class `.kiosk-recipe-prompt-view { height:100%; overflow-y:auto; -webkit-overflow-scrolling:touch; }` and apply it to `#kiosk-recipe-prompt` when shown, OR change `.kiosk-product-pane` to `overflow:hidden` for the grid view and `overflow-y:auto` for the recipe prompt view by toggling a class in `kioskShowRecipePrompt` and `kioskShowRecipeGrid` |
| C2 | brewpad.html | `#bp-recipe-attach-expanded`, `.bp-batches-panel` | Clipped by `overflow:hidden` parent — Attach button unreachable (GAP-5) | Refactor: render expanded panel content into `sectionBodyEl` (which is inside `.bp-batch-detail-pane`, already scrollable) instead of toggling the static `#bp-recipe-attach-expanded` sibling |
| C3 | admin.html, kiosk.html | `kioskFetchRecipeQuote` (admin.js:11031/11043/11056/11066; kiosk.js:801/813/826/836) | Price not shown/updated unless modify panel open (GAP-4) | Remove all `_kioskModifyPanelOpen` gates; move `#kiosk-recipe-price-preview` outside of `#kiosk-recipe-modify-wrap` in HTML; show it as soon as a sale-type is selected; also update `#kiosk-recipe-summary-price` from the quote result |
| C4 | admin.html kiosk tab | `renderKioskModifyRows` (admin.js:11106-11112), `.admin-input` | Missing `font-size:1rem` on modify-row inputs → iOS auto-zoom on admin iPad | Add `style="font-size:1rem;"` to `ing-search` and `ing-qty` in `renderKioskModifyRows` in admin.js, OR add `#tab-kiosk .admin-input { font-size: 1rem; }` to admin.css |
| C5 | brewpad.html | `.bp-ing-remove` (brewpad.css:2537-2539) | 36px × 36px touch target — below 44px spec | `min-height: 44px; min-width: 44px; padding: 10px 12px;` on `.bp-ing-remove` |

### High (WARNING)

| # | Surface(s) | Element / Selector | Defect | Concrete Fix |
|---|-----------|-------------------|--------|--------------|
| H1 | admin.html | `#kiosk-save-as-new-wrap` (admin.html:669) | Appears before sale-type buttons — wrong element order | Move to after `#kiosk-add-recipe-to-cart` (admin.html:688+) |
| H2 | admin.html, kiosk.html | `#kiosk-recipe-price-preview` | No CSS class — no background, border, padding | Add `.kiosk-price-preview { background:var(--cellar-raised); border:1px solid var(--ledger-line); border-radius:var(--r-md); padding:12px 16px; font-size:13px; margin:8px 0; }` to both admin.css and kiosk.css and apply the class to the element in HTML |
| H3 | admin.html, kiosk.html | `.admin-input.ing-search`, `.admin-input.ing-qty` in modify rows | No `min-height` on touch inputs — ~30px rendered height | Add `.kiosk-recipe-modify-table .admin-input { min-height: 44px; }` to admin.css and kiosk.css |
| H4 | admin.html | `#kiosk-save-as-new-btn.admin-btn-sm` | `min-height:unset` — ~24px touch target | Replace class with `.btn-secondary` or add `min-height:44px` to `.admin-btn-sm` |
| H5 | kiosk.html | `kioskShowIngredientAutocomplete` (kiosk.js:963) | Hardcoded `background:#fff; border:1px solid #ccc` — off-palette | Replace inline cssText with `.ing-autocomplete-drop` class; add rule to kiosk.css mirroring admin.css:3119-3131 but also set option padding to `14px 12px` and remove unused `role="option"` check |
| H6 | admin.html, kiosk.html | `#kiosk-recipe-volume-wrap` | Margin-bottom 16px (admin.css spec: should be 24px / `--sp-6`) | Change admin.css:2959: `margin-bottom: var(--sp-6);` and add equivalent rule to kiosk.css |

### Medium

| # | Surface(s) | Element / Selector | Defect | Concrete Fix |
|---|-----------|-------------------|--------|--------------|
| M1 | brewpad.html | `<label>&times; factor:</label>` (brewpad.html:103) | Trailing colon on label — mismatches spec and admin/kiosk | Remove `:` → `&times; factor` |
| M2 | kiosk.css | `:root` block | Missing `--sp-*` token definitions | Add `--sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-6:24px; --sp-8:32px;` to kiosk.css `:root` (lines 13-63) |
| M3 | admin.html, kiosk.html | Volume-wrap / modify-wrap gap | No visual separation between volume controls and modify toggle | Add `margin-top: var(--sp-4)` to `#kiosk-recipe-modify-wrap` in admin.css and kiosk.css |
| M4 | admin.html kiosk tab | `#kiosk-recipe-volume-wrap .kiosk-volume-input` | font-size:13px on admin surface — potential iOS zoom risk on iPad | Add `#tab-kiosk .kiosk-volume-input { font-size: 1rem; }` to admin.css |

### Low

| # | Surface(s) | Element / Selector | Defect | Fix |
|---|-----------|-------------------|--------|-----|
| L1 | kiosk.js | `kioskShowIngredientAutocomplete` (kiosk.js:962) | Uses `.ing-autocomplete-drop` class name but kiosk.css has no `.ing-autocomplete-drop` rule; relies entirely on inline cssText | Add `.ing-autocomplete-drop` rule block to kiosk.css matching admin.css:3119-3141 to avoid future breakage if cssText is removed |
| L2 | admin.html | `kioskFetchRecipeQuote` summary-price update | `#kiosk-recipe-summary-price` never reads from `_kioskQuote` — stays at static base price | In `kioskFetchRecipeQuote`, after `_kioskQuote = result.data`, also call `kioskUpdateSummaryPrice()` or update `#kiosk-recipe-summary-price` directly with the live total |
| L3 | all 3 | `kiosk-modify-group-header` and `bp-recipe-ing-group` | Group header styling is inline (`style="font-size:11px..."` in JS on admin/kiosk) vs defined CSS class on BrewPad (`.bp-recipe-ing-group td`) | Extract to a CSS class `.kiosk-modify-group-header td { font-size:11px; font-weight:700; text-transform:uppercase; color:var(--ink-tertiary); padding:6px 8px; background:var(--ledger-soft); }` in admin.css and kiosk.css |

---

## Registry Safety

Registry audit: not applicable — vanilla project, no shadcn or third-party component registry.

---

## Files Audited

- `/Users/koa/dev/steins-and-vines-website/.planning/phases/36-cross-surface-selection-recipe-modification/36-UI-SPEC.md`
- `/Users/koa/dev/steins-and-vines-website/.planning/phases/36-cross-surface-selection-recipe-modification/36-HUMAN-UAT.md`
- `/Users/koa/dev/steins-and-vines-website/admin.html` (lines 590–692 — `#tab-kiosk` / `#kiosk-recipe-prompt` region)
- `/Users/koa/dev/steins-and-vines-website/kiosk.html` (lines 58–162 — `#kiosk-view-browse` / `#kiosk-recipe-prompt` region)
- `/Users/koa/dev/steins-and-vines-website/brewpad.html` (lines 57–133 — `#bp-panel-batches` / `#bp-recipe-attach-expanded` region)
- `/Users/koa/dev/steins-and-vines-website/js/admin.js` (lines 9809–11494 — kiosk IIFE; `kioskFetchRecipeQuote`, `renderKioskModifyRows`, `kioskShowRecipePrompt`, `kioskUpdateAddToCartButton`, `kioskOpenModifyPanel`)
- `/Users/koa/dev/steins-and-vines-website/js/kiosk.js` (lines 737–1679 — `kioskFetchRecipeQuote`, `renderKioskModifyRows`, `kioskShowRecipePrompt`, `kioskUpdateAddToCartButton`, `kioskShowIngredientAutocomplete`)
- `/Users/koa/dev/steins-and-vines-website/js/brewpad.js` (lines 1245–1439, 4020–4340 — `renderBpModifyRows`, `wireAttachExpandedPanel`, `openRecipeAttachPanel`)
- `/Users/koa/dev/steins-and-vines-website/css/admin.css` (lines 2177–3160 — kiosk POS region, volume-row, ing-autocomplete, recipe prompt styles)
- `/Users/koa/dev/steins-and-vines-website/css/kiosk.css` (lines 380–2807 — kiosk layout, buttons, inputs, recipe-prompt region, volume-row styles)
- `/Users/koa/dev/steins-and-vines-website/css/brewpad.css` (lines 313–325, 515–542, 2202–2668 — bp-panel, batches layout, bp-input, bp-ing-*, volume-row styles)
