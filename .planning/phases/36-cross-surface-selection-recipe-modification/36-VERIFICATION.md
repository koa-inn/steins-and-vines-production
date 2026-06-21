---
phase: 36-cross-surface-selection-recipe-modification
verified: 2026-06-20T12:00:00Z
status: human_needed
score: 11/13 must-haves verified
overrides_applied: 0
human_verification:
  - test: "SEL-01 / D-01 — Open admin.html?tab=kiosk, kiosk.html, and a BrewPad batch detail attach panel. Select a recipe on each."
    expected: "The SAME 'Target volume (L)' control appears with the identical '1.5x base N L' readout and the same no-base disabled message on all three surfaces."
    why_human: "Identical visual/interactive parity across three surfaces requires browser inspection; grep confirms IDs exist but not that the control behaves identically."
  - test: "MOD-02 / D-06 — On admin and kiosk, complete one modified recipe sale. Check the terminal-charged amount."
    expected: "The charged amount equals the price preview shown by the (Modified) Add-to-Cart label before purchase — displayed==charged guarantee holds end-to-end."
    why_human: "The M-C2 test asserts parity at the code level, but a live terminal payment is required to confirm the full money path including Helcim."
  - test: "D-07 / D-08 (locked recipe) — Use a locked-price recipe. ADD an ingredient; confirm price increases. REMOVE an ingredient; confirm price does NOT decrease."
    expected: "Adding costs money; removing gives no refund. Staff see and acknowledge the asymmetry (intentional per D-08). Owner approval of the no-credit behaviour is recorded."
    why_human: "Requires a live locked-price recipe (only a dynamic recipe was available in Phase 35 UAT). Asymmetry acknowledgement is a human decision gate."
  - test: "SEL-02 — Complete one modified sale. Verify the Zoho invoice line items, created batch record, and recipe_snapshot."
    expected: "Invoice reflects scaled+modified ingredients. Batch record shows the chosen target volume without re-entry. recipe_snapshot carries modified_base_ingredients and is_modified."
    why_human: "Requires a live sale creating a real Zoho invoice and a batch row in Google Sheets. Code path is verified; end-to-end data trail requires human inspection."
  - test: "36-02 Apps Script redeploy — Verify the create_batch Apps Script handler persists target_volume_l and scale_factor on the Batches sheet row."
    expected: "After a recipe sale at a non-1x volume, the created batch row shows target_volume_l=chosen_volume (e.g. 30) without anyone re-entering it."
    why_human: "STATE.md line 70 explicitly records '36-02 BLOCKED: Apps Script create_batch handler must accept + persist target_volume_l and scale_factor; manual redeploy needed.' This is a human-action gate that has not been completed."
  - test: "D-10 / D-11 (BrewPad attach) — Attach a recipe at a scaled volume with a modification."
    expected: "No price is shown and no charge occurs. Stock advisory appears as a soft warning when scaled quantities exceed stock, but Attach button stays enabled. After attach the batch snapshot carries scaled+modified ingredients and target volume."
    why_human: "D-10 no-charge enforcement is asserted in tests; live BrewPad attach requires manual verification of the actual batch snapshot in Google Sheets."
  - test: "MOD-03 / D-12/D-13/D-14 — On admin and BrewPad, tap 'Save as new recipe', name it, Save Draft."
    expected: "A new draft (inactive, dynamic) recipe appears with BASE (pre-scale) quantities. Original recipe is untouched. New draft requires activation guardrail before going live."
    why_human: "Save-as-new POSTs to /api/recipes; confirmation requires checking the recipe catalogue that a draft was created and the original is unchanged."
  - test: "iPad Safari — kiosk and BrewPad inputs do not trigger iOS auto-zoom; all touch targets are comfortably tappable."
    expected: "No auto-zoom on number/text inputs inside recipe prompts on an iPad running Safari."
    why_human: "font-size:1rem iOS guard is verified in kiosk.html markup, but touch UX requires physical device testing."
---

# Phase 36: Cross-Surface Selection & Recipe Modification — Verification Report

**Phase Goal:** The batch-size control is available on every recipe-selection surface and persists through the sale/batch flow; staff can also add, remove, or substitute ingredients for a one-off modified sale without altering the saved recipe, with the option to save the modification as a new recipe.
**Verified:** 2026-06-20T12:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | computeModifiedRecipeTotal exists, is exported, handles locked-add (D-07), locked-remove no-credit (D-08), dynamic-modify (D-09), and the $125.50 literal 1.5x worked example passes | VERIFIED | `zoho-middleware/lib/recipe-scaling.js` lines 189-277; test suite line 425 `expect(result).toBe(125.50)` passes; 153 targeted tests green |
| 2 | detectRecipeSale forwards target_volume_l + scale_factor onto the batch payload (middleware side of SEL-02) | VERIFIED | `zoho-middleware/lib/brewpad-integration.js` lines 394-395; 3 new tests in brewpad-integration.test.js pass |
| 3 | Apps Script create_batch persists target_volume_l/scale_factor onto the batch row (end-to-end SEL-02 closure) | UNCERTAIN | STATE.md line 70 explicitly records "36-02 BLOCKED: Apps Script create_batch handler must accept + persist target_volume_l and scale_factor; manual redeploy needed." No SUMMARY for 36-07 confirms completion. Routes to human_verification item #5. |
| 4 | GET /api/kiosk/recipe-quote accepts modified_ingredients and returns server-authoritative modified total + is_modified flag | VERIFIED | `zoho-middleware/routes/pos-recipe.js` lines 266-278; test M-Q1 through M-Q7 pass; 897 middleware tests green |
| 5 | POST /api/kiosk/recipe-sale and /confirm price the modified base list via computeModifiedRecipeTotal; displayed==charged (MOD-02) | VERIFIED | pos-recipe.js lines 182-185 (sale), 364-365 + 486-490 (confirm); test M-C2 asserts quote total === confirm total for identical inputs |
| 6 | recipe_snapshot in confirm carries modified_base_ingredients and is_modified | VERIFIED | pos-recipe.js lines 564-565; test M-C1 asserts snapshot.is_modified:true and snapshot.modified_base_ingredients equals the submitted pre-scale list |
| 7 | Admin modify panel: staff can add/remove/change ingredients at base quantities without altering the saved recipe; price preview shows server-authoritative modified total; (Modified) label suffix; Save-as-new POSTs dynamic/draft to /api/recipes | VERIFIED | admin.html: 5 required IDs present (grep count = 5); js/admin.js: `_kioskModifiedIngredients`, `modified_ingredients` param, `(Modified)` suffix, `kioskSaveAsNewRecipe` at line 11476; 9 targeted tests pass; deep-copy immutability test T4 passes |
| 8 | Kiosk: identical Phase 35 volume control ported (SEL-01); modify panel ported; no save-as-new; iOS zoom guard on inputs | VERIFIED | kiosk.html: 6 required IDs present; `kiosk-save-as-new-btn` count = 0; font-size:1rem on inputs (line 117); js/kiosk.js: `_kioskModifiedIngredients` at line 741; 15 targeted tests pass |
| 9 | BrewPad attach: volume control ported; modify panel + soft stock advisory (never disables Attach); scaled+modified snapshot written via update_batch with NO charge; save-as-new | VERIFIED | brewpad.html: 5 required IDs present; no price preview (`kiosk-recipe-price-preview` count = 0); `bpScaleIngredients` top-level pure fn at line 697; `bpSaveAsNewRecipe` at line 1446; no recipe-quote/recipe-sale/Helcim call on attach path (test T6 asserts); 31 targeted tests pass |
| 10 | bpScaleIngredients inline scaler matches lib/recipe-scaling.js output: 5 kg grain at 1.5x → 7.5 kg (linear), 1 pcs hop at 1.5x → 2 pcs (Math.max(1,Math.ceil)) | VERIFIED | tests/frontend/brewpad-recipe-attach-modify.test.js lines 169 (expect 7.5) and 175 (Math.max/Math.ceil); test T1b and T1c and T3c pass with literal values |
| 11 | Original recipe is never mutated by modification or save-as-new on any surface | VERIFIED | Deep-copy test T4 (admin-recipe-modify.test.js) and kiosk-recipe-modify.test.js T4; bpSaveAsNewRecipe uses POST /api/recipes only (no PUT); deep-copy on first modify-toggle expand on all three surfaces |
| 12 | All three surfaces: cross-surface human UAT on staging — same control on all three, carry-through into invoice/snapshot/batch, locked-remove asymmetry acknowledged, save-as-new confirmed | HUMAN NEEDED | Plan 36-07 (wave 4) has not been executed; no 36-07-SUMMARY.md exists; ROADMAP.md still shows Phase 36 as `[ ]` (incomplete) |
| 13 | REQUIREMENTS.md traceability rows SEL-01/SEL-02/MOD-01/MOD-02/MOD-03 marked Complete AFTER owner UAT approval | HUMAN NEEDED | Rows were marked Complete incrementally during plan execution (git history: a633038, a47dd4e, 37a2ef6 docs commits), not after 36-07 UAT gate. 36-07 Task 3 ("flip to Complete only after owner approval") has not run. The current Complete state is premature per the plan's stated gate. |

**Score:** 11/13 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `zoho-middleware/lib/recipe-scaling.js` | computeModifiedRecipeTotal pure helper exported | VERIFIED | Defined at line 223, exported at line 277; no mutation of input arrays |
| `zoho-middleware/__tests__/recipe-scaling.test.js` | 10-case suite with $125.50 literal | VERIFIED | describe block at line 380; LOCKED_ADD_1_5X assertion `toBe(125.50)` at line 425 |
| `zoho-middleware/lib/brewpad-integration.js` | detectRecipeSale forwards target_volume_l + scale_factor | VERIFIED | Lines 394-395; null fallback for legacy sales |
| `zoho-middleware/__tests__/brewpad-integration.test.js` | 3 new tests for payload forwarding | VERIFIED | 36 tests pass (33 pre-existing + 3 new) |
| `zoho-middleware/routes/pos-recipe.js` | modified_ingredients in quote/sale/confirm + snapshot fields | VERIFIED | Lines 55, 120, 182-185, 266-278, 364-365, 486-490, 564-565 |
| `zoho-middleware/__tests__/pos-recipe.test.js` | 17 new MOD-02 tests (M-Q1..M-Q7, M-S1..M-S3, M-C1..M-C7) | VERIFIED | All 897 middleware tests pass |
| `admin.html` | 5 IDs: kiosk-recipe-modify-wrap, kiosk-modify-tbody, kiosk-recipe-price-preview, kiosk-save-as-new-btn, kiosk-locked-price-notice | VERIFIED | grep count = 5; asymmetry copy present at line 650 |
| `js/admin.js` | _kioskModifiedIngredients, modified_ingredients param, (Modified) label, kioskSaveAsNewRecipe | VERIFIED | Lines 9811, 11027, line 1588 region, 11476; indexOf(ing) at 11103 |
| `tests/frontend/admin-recipe-modify.test.js` | 9 tests covering modify flag, (Modified) label, splice, deep-copy, save-as-new | VERIFIED | 9 tests pass; 823 total frontend tests green |
| `kiosk.html` | 5+ IDs ported from admin; no kiosk-save-as-new-btn; iOS font-size:1rem on inputs | VERIFIED | grep count = 6; kiosk-save-as-new-btn count = 0; font-size:1rem at line 117 |
| `js/kiosk.js` | _kioskModifiedIngredients, kioskFetchRecipeQuote with modified_ingredients, no kioskSaveAsNewRecipe export | VERIFIED | Lines 741, 796-797; save-as-new intentionally not exported (kiosk.js line 4741 comment) |
| `tests/frontend/kiosk-recipe-modify.test.js` | 15 tests for volume pre-fill, quote URL, (Modified) label, immutability, XSS | VERIFIED | 15/15 pass |
| `brewpad.html` | 5 IDs: bp-recipe-volume-wrap, bp-target-volume, bp-modify-tbody, bp-recipe-stock-advisory, bp-save-as-new-btn; no price preview | VERIFIED | grep count = 5; kiosk-recipe-price-preview count = 0; bp-input class on target-volume |
| `js/brewpad.js` | _bpTargetVolumeL, bpScaleIngredients, bpSaveAsNewRecipe; no quote/charge on attach | VERIFIED | Lines 660-697 (bpScaleIngredients top-level), 1243-1291 (state + snapshot), 1428-1446 (bpSaveAsNewRecipe), D-10 comment + T6 test |
| `tests/frontend/brewpad-recipe-attach-modify.test.js` | 31 tests for snapshot structure, parity literals, advisory, no-charge, save-as-new | VERIFIED | 31/31 pass; literal values 7.5 and 2 at lines 169, 175 |
| `js/admin.min.js` | kioskSaveAsNewRecipe in bundle | VERIFIED | Bundle rebuilt; kioskSaveAsNewRecipe present (grep confirms) |
| `js/kiosk.min.js` | modified_ingredients in bundle | VERIFIED | grep count = 1 |
| `js/brewpad.min.js` | bpSaveAsNewRecipe in bundle | VERIFIED | grep count = 1 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `zoho-middleware/routes/pos-recipe.js` | `recipe-scaling.computeModifiedRecipeTotal` | import + call in computeRecipeQuote + confirm | WIRED | Lines 120, 490; used in both the shared helper and the inline confirm block |
| `GET /api/kiosk/recipe-quote` | client price preview (admin/kiosk) | modified_ingredients JSON query param | WIRED | pos-recipe.js lines 266-278; admin.js line 11027; kiosk.js line 796 |
| `js/admin.js kioskFetchRecipeQuote` | `GET /api/kiosk/recipe-quote?modified_ingredients=...` | `_kioskModifiedIngredients` JSON-encoded query param | WIRED | admin.js line 11027 + encodeURIComponent |
| `js/admin.js kioskSaveAsNewRecipe` | `POST /api/recipes` | `pricing_mode:'dynamic', status:'draft', ingredients:modifiedBaseIngredients` | WIRED | admin.js lines 11491-11494 |
| `js/kiosk.js kioskFetchRecipeQuote` | `GET /api/kiosk/recipe-quote` | `target_volume_l + modified_ingredients params` | WIRED | kiosk.js lines 795-797 |
| `js/brewpad.js bpAttachRecipe` | `adminApiPost('update_batch', { recipe_snapshot })` | `scaled+modified snapshot, no pricing` | WIRED | brewpad.js line 1428 + bpAttachRecipe; no recipe-quote/recipe-sale/Helcim call asserted by T6 |
| `js/brewpad.js bpSaveAsNewRecipe` | `POST /api/recipes` | modified base list, dynamic, draft | WIRED | brewpad.js line 1446; /api/recipes POST at line 1460 |
| `zoho-middleware/lib/brewpad-integration.js detectRecipeSale` | Apps Script create_batch | `batchPayload.target_volume_l + scale_factor` | PARTIAL | Middleware side WIRED (lines 394-395). Apps Script persistence side UNCONFIRMED (human-action blocked per STATE.md line 70) |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `admin.js #kiosk-recipe-price-preview` | `_kioskQuote.total` | `GET /api/kiosk/recipe-quote` response | Yes — server computes from catalogMap | FLOWING |
| `kiosk.js #kiosk-recipe-price-preview` | `_kioskQuote.total` | `GET /api/kiosk/recipe-quote` with modified_ingredients | Yes — same server path | FLOWING |
| `pos-recipe.js recipe_snapshot` | `modified_base_ingredients, is_modified` | `body.modified_ingredients` from client, frozen at confirm time | Yes — priced via computeModifiedRecipeTotal from catalogMap | FLOWING |
| `brewpad.js recipe_snapshot (via update_batch)` | `scaledIngredients, target_volume_l, scale_factor` | `_bpModifiedIngredients` deep-copy + bpScaleIngredients | Yes — scaled inline (parity tested) | FLOWING |
| `brewpad-integration.js batchPayload.target_volume_l` | `recipeSnapshot.target_volume_l` | pos-recipe.js confirm handler (server-computed) | Yes — from server snapshot | FLOWING to middleware; UNKNOWN to Apps Script sheet |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| computeModifiedRecipeTotal exported and all tests pass | `cd zoho-middleware && npx jest recipe-scaling.test.js` | 153 tests passed | PASS |
| modified_ingredients wired in pos-recipe.js routes | `cd zoho-middleware && npx jest pos-recipe.test.js` | 64+ tests passed, M-Q1..M-Q7, M-C1..M-C7 green | PASS |
| brewpad-integration target_volume_l forwarded | `cd zoho-middleware && npx jest brewpad-integration.test.js` | 36 tests passed | PASS |
| Admin modify panel tests | `npx jest tests/frontend/admin-recipe-modify.test.js` | 9 tests passed | PASS |
| Kiosk modify panel tests | `npx jest tests/frontend/kiosk-recipe-modify.test.js` | 15 tests passed | PASS |
| BrewPad attach+modify tests | `npx jest tests/frontend/brewpad-recipe-attach-modify.test.js` | 31 tests passed | PASS |
| Full frontend suite | `npm test` | 823 tests, 41 suites, all passed | PASS |
| Full middleware suite | `cd zoho-middleware && npm test` | 897 tests, 39 suites, all passed | PASS |

---

### Probe Execution

Step 7c: SKIPPED — no `scripts/*/tests/probe-*.sh` files declared in PLAN files or found in repo for this phase.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SEL-01 | 36-04, 36-05, 36-06 | Batch size control on admin + kiosk + BrewPad attach, consistent visual control | SATISFIED (code) / HUMAN NEEDED (UAT) | All 3 surfaces have the volume control IDs in HTML + JS; human UAT in 36-07 required to confirm identical behaviour |
| SEL-02 | 36-02, 36-03, 36-05, 36-06 | Chosen batch size persists through flow into cart/invoice/snapshot/batch record | PARTIALLY SATISFIED | Middleware payload forwarding WIRED; Apps Script persistence BLOCKED (human-action pending per STATE.md line 70) |
| MOD-01 | 36-04, 36-05, 36-06 | Staff can add/remove/substitute at recipe-selection time; saved recipe untouched | SATISFIED (code) / HUMAN NEEDED (UAT) | Modify panel on all 3 surfaces; deep-copy immutability tests pass; UAT in 36-07 required |
| MOD-02 | 36-01, 36-03, 36-04, 36-05 | Modified lists priced server-authoritatively; captured in invoice + snapshot | SATISFIED (code) | computeModifiedRecipeTotal + pos-recipe.js routes + snapshot freeze all wired and tested; displayed==charged test M-C2 passes |
| MOD-03 | 36-04, 36-06 | Save as new recipe via POST /api/recipes; activation guardrails; original untouched | SATISFIED (code) / HUMAN NEEDED (UAT) | kioskSaveAsNewRecipe (admin) and bpSaveAsNewRecipe (BrewPad) both POST dynamic/draft; tests assert no PUT; UAT in 36-07 required to confirm live creation |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `js/kiosk.js` | 643 | `dayLabel = 'TBD'` | INFO | Pre-existing UI string for unscheduled batch task dates; not a Phase 36 change and not a debt marker — renders as display text via `escapeHTML(dayLabel)` at line 646 |

No `FIXME`, `XXX`, or unreferenced debt markers found in any Phase 36-modified files.

---

### Human Verification Required

#### 1. SEL-01 Cross-Surface Control Parity

**Test:** Open admin.html?tab=kiosk, kiosk.html, and a BrewPad batch detail attach panel. Select a recipe on each.
**Expected:** The same "Target volume (L)" control appears with the identical "1.5x base N L" readout and the same no-base disabled message on all three surfaces.
**Why human:** HTML IDs and JS wiring are verified; identical interactive behaviour across three surfaces requires browser inspection.

#### 2. MOD-02 End-to-End: Displayed Price == Charged Amount

**Test:** On admin or kiosk, make a modified recipe sale (add an ingredient). Note the "(Modified)" price preview. Complete the sale through the Helcim terminal.
**Expected:** The terminal-charged amount equals the price preview. The Zoho invoice line items reflect the scaled+modified ingredients.
**Why human:** Code-level M-C2 test asserts parity in unit tests; live terminal payment is required to confirm the full money path.

#### 3. D-07/D-08 Locked-Recipe Asymmetry (Owner Acknowledgement Required)

**Test:** Use a locked-price recipe (create one or set locked_price on an existing recipe). ADD an ingredient — confirm price increases. REMOVE an ingredient — confirm price does NOT decrease.
**Expected:** Adding costs extra; removing gives no refund. Owner explicitly acknowledges this intentional asymmetry (D-08) and records approval.
**Why human:** Requires a live locked-price recipe (only dynamic was available in Phase 35). Owner acknowledgement is a human decision gate, not a code check.

#### 4. SEL-02 Full Carry-Through Chain

**Test:** Complete one modified recipe sale at a non-1x volume. Inspect the Zoho invoice, the created batch record in Google Sheets, and the recipe_snapshot.
**Expected:** Invoice reflects scaled+modified ingredients; batch record shows the chosen target volume without re-entry; recipe_snapshot carries modified_base_ingredients and is_modified.
**Why human:** Requires a live end-to-end sale creating a real Zoho invoice and a batch row.

#### 5. Apps Script create_batch Redeploy (BLOCKING for SEL-02 full closure)

**Test:** Open the Apps Script project (adminApi.gs) bound to the Batches Google Sheet. Add target_volume_l and scale_factor to the create_batch handler's accepted/written field set. Redeploy the Apps Script web app. Run a staging recipe sale at a non-1x volume and confirm the Batches sheet row shows target_volume_l populated.
**Expected:** Batch row shows target_volume_l (e.g. 30) without anyone re-typing it.
**Why human:** Apps Script changes are not in CI; the middleware payload is wired but the Apps Script persistence is explicitly blocked in STATE.md: "36-02 BLOCKED: Apps Script create_batch handler must accept + persist target_volume_l and scale_factor; manual redeploy needed before SEL-02 is fully closed."

#### 6. D-10/D-11 BrewPad Attach — No Charge, Soft Advisory

**Test:** On a BrewPad batch, attach a recipe at a scaled volume with a modification that triggers a stock advisory (scaled quantities exceed catalog stock).
**Expected:** No price is shown and no charge occurs. The stock advisory appears as a soft warning but the Attach button stays enabled. After attach, the batch snapshot in Google Sheets carries the scaled+modified ingredients and target volume.
**Why human:** No-charge enforcement is test-asserted; live BrewPad attach requires manual verification of the actual batch snapshot.

#### 7. MOD-03 Save-as-New Live Verification

**Test:** On admin and BrewPad, tap "Save as new recipe", name it, and Save Draft. Check the recipe catalogue.
**Expected:** A new draft (inactive, dynamic) recipe appears with BASE (pre-scale) quantities. The original recipe is unchanged. The draft cannot be activated until it passes the activation guardrail (locked_price > 0 OR dynamic-recipe guardrail check in routes/recipes.js).
**Why human:** Save-as-new POSTs to /api/recipes; confirmation requires checking the recipe catalogue on staging.

#### 8. iPad Safari — iOS Zoom Guard

**Test:** Open kiosk.html and BrewPad on an iPad running Safari. Tap the target volume input and ingredient quantity inputs.
**Expected:** No auto-zoom triggered. All touch targets are comfortably tappable.
**Why human:** font-size:1rem guard is verified in markup; physical device testing is required.

---

### Gaps Summary

No code-level blockers. All automated must-haves are VERIFIED. The phase has two outstanding human-verification dependencies:

1. **Apps Script create_batch redeploy (SEL-02 full closure)** — The middleware correctly forwards `target_volume_l` and `scale_factor` from the server-built recipe_snapshot onto the `create_batch` payload (VERIFIED). The Apps Script side of this was explicitly left as a human-action checkpoint in Plan 36-02 and is still unresolved per STATE.md. SEL-02 is code-complete on the middleware side but not end-to-end complete until the Apps Script is redeployed.

2. **Plan 36-07 cross-surface human UAT** — This wave-4 plan (staging deploy + 8-point human UAT checklist + owner acknowledgement of D-07/D-08 asymmetry + REQUIREMENTS traceability flip) has not been executed. No 36-07-SUMMARY.md exists. The ROADMAP correctly shows Phase 36 as `[ ]` (incomplete). The REQUIREMENTS.md traceability rows were marked Complete incrementally during code execution, ahead of the 36-07 UAT gate that was supposed to be the authoritative flip point.

**Recommendation:** Execute Plan 36-07. Start with the Apps Script redeploy (item #5 above) before the staging UAT. The code is fully ready for staging deployment.

---

_Verified: 2026-06-20T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
