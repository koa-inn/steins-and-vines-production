---
status: partial
phase: 36-cross-surface-selection-recipe-modification
source: [36-VERIFICATION.md]
started: 2026-06-21T05:40:00Z
updated: 2026-06-22T21:30:00Z
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
status: shipped 36-08..36-11 (control renders + synced). SECOND-PASS UAT (2026-06-22) found follow-on issues — see GAP-4..GAP-7.

---

## Second-pass UAT gaps (2026-06-22, after 36-08..36-12 deploy)

### GAP-4 (BLOCKER) — Live price does NOT update when volume / ×factor / ingredients change
surfaces: admin, kiosk (the SALE surfaces with a money path)
symptom: Changing the target volume, ×factor, or ingredient list gives NO visible price change. The displayed price stays at the unchanged base amount; the correct (scaled/modified) total only materializes when the item is actually added to the cart. Staff get no confidence the price will be right before committing.
root_cause: The live server quote (`kioskFetchRecipeQuote`, kiosk.js:783-841 / admin equivalent) only writes its result into `#kiosk-recipe-price-preview`, and EVERY write to that element is gated on `_kioskModifyPanelOpen` (lines 801/813/826/836). So the live "Estimated total" is only shown when the Modify Ingredients panel is open. Meanwhile the prominent `#kiosk-recipe-summary-price` (kiosk.js:1683) shows the base `computed_price` and is never re-rendered from the quote on volume/factor/ingredient change.
fix: Surface the server quote total as the PROMINENT recipe price and update it on EVERY change (volume, ×factor, and ingredient edits) — not only when the modify panel is open. The summary price should reflect the live quote (server-authoritative; displayed == charged). Mirror on admin. Add tests asserting the visible price updates on volume/factor/ingredient change with the modify panel CLOSED.

### GAP-5 (BLOCKER) — Cannot scroll to see the full ingredient list or reach the accept / Add-to-Cart button
surfaces: kiosk (kiosk.html) confirmed; check admin + BrewPad
symptom: With a long ingredient list (and/or the modify panel expanded), the recipe sale/modify panel overflows the viewport and the user cannot scroll to see the whole list or reach the "Ferment in Store / Take Out" (accept) buttons. Effectively blocks completing a sale on longer recipes / smaller screens.
fix: Make the recipe prompt/modify container scrollable (overflow handling) so the full list AND the action buttons are always reachable on iPad/kiosk viewports. Verify the sticky action buttons or a scroll region keeps accept reachable.

### GAP-6 (needs investigation) — Modify/×factor feature not visible on admin's Kiosk view, though it works on kiosk.html
surfaces: admin (admin.html?tab=kiosk)
symptom: The ×factor control / modify feature "didn't show up" in the Kiosk view inside admin, but works on kiosk.html directly.
hypotheses: (a) stale cached admin.html / admin.min.js or a service-worker cache (the ?v= cache-bust may not have been picked up — try a hard refresh / clear cache FIRST); (b) the admin kiosk-sale render path differs from the standalone kiosk and didn't get the same wiring; (c) a JS error on the admin page aborts the render. Investigate: confirm the deployed admin.min.js contains the factor wiring, check for console errors on admin.html?tab=kiosk, and confirm the render path.
fix: TBD after root-cause (cache guidance vs real wiring fix).

### GAP-7 (enhancement) — UI/UX expert review + polish of the recipe modify/sale region
surfaces: all 3
request (owner): GAP-2 polish is "looking better" but bring in a UI/UX agent to review the modify/sale region and apply professional polish (hierarchy, spacing, affordances, touch ergonomics). Feeds concrete polish items into the gap plan.

---

## Third-pass UAT (2026-06-22, after 36-13..36-16 deploy to staging)

> Deployed to staging: commits `7082e06..8e2f593` pushed to `origin/main` 2026-06-22 (PUSH_CONFIRMED, remote head == local HEAD). Test on **staging.steinsandvines.ca** — use the in-store iPad for kiosk + BrewPad. **HARD REFRESH / clear cache FIRST** (GAP-6 cache guidance), and on the BrewPad PWA use the in-app ↻ Clear-cache button before testing.
>
> This pass **supersedes the round-1 re-UAT plan (36-12)** — it re-tests the new GAP-4/5/6/7 fixes AND re-confirms the still-pending original items (#1–#8) in one sign-off. Record each result inline (replace `[pending]`), or log a new gap with surface + symptom for a further cycle.

### TP-1. GAP-4 — Live PROMINENT price updates on every change, modify panel CLOSED (admin + kiosk)
expected: Select a recipe with a base size. Changing target volume → prominent price updates immediately. Changing ×factor → updates. Open Modify, add/remove an ingredient + change a qty → prominent price updates each time. Add to cart → displayed price == charged. No stale/base price on a long-list recipe. (Code: all 4 `&& _kioskModifyPanelOpen` quote gates removed in admin.js + kiosk.js; verified grep=0.)
result: [pending]

### TP-2. GAP-5 — Full list + accept/Add-to-Cart/Attach reachable on long recipes (admin + kiosk + BrewPad)
expected: On a many-ingredient recipe with Modify expanded, scroll the panel and reach the WHOLE list AND the sale-type + Add-to-Cart buttons (sticky bottom). On BrewPad, expand the attach modify panel on a long recipe → the Attach Recipe button is reachable, not clipped.
result: [pending]

### TP-3. GAP-6 — ×factor / Modify present + no iOS zoom on admin.html?tab=kiosk (after hard refresh)
expected: After a hard refresh, the ×factor input + Modify feature ARE visible and behave the same as kiosk.html; focusing an input does NOT auto-zoom the iPad (font-size:1rem). (Rebuilt admin.min.js carries the factor wiring.)
result: [pending]

### TP-4. GAP-7 — UI polish across all three surfaces
expected: Price-preview reads as a card; touch targets comfortable (incl. BrewPad Remove ×, ≥44px); volume+factor row and Modify panel look clean/consistent; save-as-new (admin/BrewPad) sits below the primary action; cellar-palette autocomplete; "× factor" label consistent (no stray colon on BrewPad).
result: [pending]

### TP-5. BrewPad no-charge (D-10)
expected: Attach a recipe at a scaled volume via the factor → NO price/charge appears anywhere in the attach flow; it only records the chosen volume.
result: [pending]

### TP-6. (orig #1) Cross-surface control parity
expected: The identical target-volume + ×factor control behaves the same on admin / kiosk / BrewPad.
result: [pending]

### TP-7. (orig #2/#3) Displayed==charged + locked add/remove asymmetry
expected: At 1.5× on a locked-price recipe, ADDING a discrete ingredient increases the charge by the scaled added line (the $125.50 worked example); REMOVING leaves the locked charge unchanged (owner acknowledges the intentional asymmetry).
result: [pending]

### TP-8. (orig #4/#5) SEL-02 carry-through to batch row
expected: A sale at a non-1× volume flows the volume through cart → invoice → snapshot → batch row (target_volume_l + scale_factor) with no re-entry. REQUIRES the LIVE Apps Script create_batch redeploy + the Batches sheet columns (item #5) to be done — confirm those steps are complete.
result: [pending]

### TP-9. (orig #7) Save-as-new
expected: admin + BrewPad save-as-new creates a NEW draft recipe; kiosk has none; original untouched.
result: [pending]

### TP-10. (orig #8) iPad touch/zoom
expected: No iOS auto-zoom on any input; modify panel + autocomplete touch-friendly.
result: [pending]

## Third-pass summary

total: 10
passed: 0
issues: 0
pending: 10
skipped: 0
blocked: 0

**Sign-off:** Type **"approved"** if GAP-4/5/6/7 are resolved across all surfaces, the still-pending original items pass, and the money path (displayed==charged, BrewPad no-charge) is unchanged — then I'll mark 36-17 (and the superseded 36-12) complete and route to phase verification. Otherwise describe the remaining issues (surface + symptom) for a further gap-closure cycle.
