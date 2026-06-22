---
status: partial
phase: 36-cross-surface-selection-recipe-modification
source: [36-VERIFICATION.md]
started: 2026-06-21T05:40:00Z
updated: 2026-06-21T05:40:00Z
---

## Current Test

[awaiting human testing on staging]

## Tests

### 1. Cross-surface control parity (SEL-01, D-01)
expected: The identical target-volume control (pre-fill base, 0.5 L steps, >0 & ≤~10× base bounds, no-base ⇒ disabled, "1.5× base 20 L" readout) appears and behaves the same on admin recipe-sale, kiosk recipe-sale, and BrewPad recipe-attach.
result: [pending]

### 2. Displayed == charged, end-to-end (MOD-02)
expected: On admin + kiosk, the modified-list price shown before Add-to-Cart equals the amount charged at the Helcim terminal for a real (or test) transaction.
result: [pending]

### 3. Locked-recipe add/remove asymmetry (D-07/D-08) — owner acknowledgement
expected: On a live locked-price recipe at 1.5×, ADDING a discrete ingredient increases the charge by the scaled added line (e.g. 1 pcs → 2 pcs × rate; the $125.50 worked example), while REMOVING an ingredient leaves the charge unchanged (no credit). Staff/owner acknowledge the intentional asymmetry.
result: [pending]

### 4. SEL-02 carry-through chain (SEL-02, D-02)
expected: A sale at a non-1× volume flows the chosen volume through cart → Zoho invoice → frozen recipe_snapshot → created batch record with NO re-entry. The batch row shows target_volume_l + scale_factor. (Depends on test #5.)
result: [pending]

### 5. Apps Script create_batch redeploy (SEL-02 — human-action; CODE NOW IN REPO)
expected: The code is committed in `apps-script/adminApi.gs` (createBatch now writes target_volume_l + scale_factor by header lookup, commit f5037c2). Two LIVE steps remain: (a) add `target_volume_l` and `scale_factor` column headers to the Batches sheet; (b) copy apps-script/adminApi.gs into the Apps Script editor (or clasp push) and redeploy the existing Web App (same URL). Verified by a staging sale at 30 L / 1.5× showing those values on the batch row without re-typing.
result: [pending]

### 6. BrewPad attach is record-keeping only (D-10/D-11)
expected: Attaching a (possibly modified) recipe freezes a scaled+modified snapshot via updateBatch with NO price preview, NO Helcim charge. The stock advisory is soft — the Attach button is never disabled by stock.
result: [pending]

### 7. Save-as-new recipe (MOD-03, D-12/D-13/D-14)
expected: On admin + BrewPad, saving a modification prompts for a name and creates a NEW draft (inactive), dynamic-priced recipe storing the modified BASE list at base volume. The original recipe is untouched. Kiosk has NO save-as-new affordance.
result: [pending]

### 8. iPad Safari touch/zoom
expected: On the in-store iPad (kiosk + BrewPad), number/text inputs do not trigger iOS auto-zoom (font-size ≥16px), and the modify panel + autocomplete are touch-friendly.
result: [pending]

### 9. [Gap-closure re-test] GAP-1 — modify autocomplete now lists ingredients (admin)
expected: On admin.html?tab=kiosk, pick a recipe → Modify Ingredients → typing/focusing the ingredient field now LISTS catalog items (the original bug). Kiosk + BrewPad too.
result: [pending]

### 10. [Gap-closure re-test] GAP-3 — synced ×factor input (all 3 surfaces)
expected: Next to Target volume (L) there is a "× factor" input. Editing the factor updates litres (factor × base); editing litres updates the factor (litres ÷ base). Readout "1.5× base 20 L" stays. No base ⇒ both disabled. On BrewPad the factor change must NOT trigger any charge/quote (attach is record-keeping).
result: [pending]

### 11. [Gap-closure re-test] GAP-2 — modify-panel polish/reorder + edit-at-base
expected: The control/modify region looks clean and consistent across admin/kiosk/BrewPad (no phantom empty rows, sensible ordering). Opening Modify Ingredients on a recipe WITH base ingredients pre-populates them as editable rows (edit-at-base), not an empty list.
result: [pending]

## Summary

total: 11
passed: 0
issues: 0
pending: 11
skipped: 0
blocked: 0

## Gaps

### GAP-1 (BLOCKER, MOD-01) — Modify-panel ingredient autocomplete loads nothing in the sale/attach flow
status: HOTFIXED on staging 2026-06-21 (commit 2c422d1) — admin now loads the catalog on panel open; kiosk/BrewPad already did. Regression test still owed by the gap-closure cycle (panel toggle handler isn't exported).
scope_correction: Only the ADMIN surface was actually affected — kiosk (kiosk.js:1614) and BrewPad (brewpad.js:4036) already lazy-load the catalog on panel open.
surfaces: admin (js/admin.js — FIXED), kiosk (js/kiosk.js — already OK), BrewPad (js/brewpad.js — already OK)
symptom: Clicking "Modify Ingredients" / "+ Add Ingredient" shows an empty search row, but typing/focusing the ingredient field never lists any catalog items — so staff cannot add or substitute an ingredient at all.
root_cause: The modify panel reuses `showIngredientAutocomplete()`, which early-returns when `_recipesState.catalogLoaded` is false (js/admin.js:8900). `_recipesState.catalog` is only populated by `loadIngredientCatalogForRecipes()`, which runs in the Recipes management tab — NOT in the recipe-sale/attach flow. In the sale flow the catalog is empty, so the dropdown silently no-ops. Same pattern on kiosk and BrewPad (each has its own catalog loader that isn't triggered on the sale/attach surface).
fix: When the modify panel first expands (or when the recipe-sale/attach prompt loads), ensure the ingredient catalog is loaded once (guarded) before wiring the autocomplete, on all three surfaces. Add a regression test asserting the dropdown lists items after the panel opens without first visiting the Recipes tab.

### GAP-2 (enhancement) — Modify-panel + control UI polish & reordering
surfaces: admin, kiosk, BrewPad
symptom: The modify rows + volume control area is cramped and visually rough (greyed empty inputs, awkward order of: target volume → readout → Modify toggle → rows → Add Ingredient → sale buttons). The empty modify row renders before any ingredient is chosen, looking broken.
fix: Polish + reorder the recipe-modification region for a cleaner, touch-friendly layout consistent across all three surfaces (see UI-SPEC update). Edit-at-base rows should read clearly; empty-state and add-row affordances should look intentional. Keep ES5/escapeHTML rules.

### GAP-3 (enhancement, SEL-01) — Synced ×factor input alongside Target volume (L)
surfaces: admin, kiosk, BrewPad
decision (owner, 2026-06-21): Add a "× factor" number input next to the existing Target volume (L) box. The two are two-way synced: editing the factor updates litres (factor × base_batch_size_l) and editing litres updates the factor (litres ÷ base). The "1.5× base 20 L" readout stays. Same bounds as today (>0, ≤~10× base; no-base ⇒ both disabled). Identical control on all three surfaces (D-01).
fix: Extend the ported Phase 35 control with the synced factor field + sync logic; reflect in UI-SPEC; add tests for both directions of the sync and bounds.
