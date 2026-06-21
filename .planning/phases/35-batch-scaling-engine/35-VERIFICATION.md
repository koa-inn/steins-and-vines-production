---
phase: 35-batch-scaling-engine
verified: 2026-06-20T00:00:00Z
status: human_needed
score: 14/14
overrides_applied: 0
human_verification:
  - test: "Run a real kiosk sale on a LOCKED-price recipe at 1.0x and confirm the total shown equals locked_price + service_fee + materials_fee (the D-06 fee-inclusive change that did not have a live locked recipe to test against)"
    expected: "Total = locked_price * 1.0 + service_fee + materials_fee (higher than the old flat locked_price with no fees)"
    why_human: "The only live recipe (Dangerous Bunny) is dynamic-priced. D-06 changes the global pricing formula for locked recipes at any scale factor; cannot be exercised without a live locked recipe."
  - test: "Run a full end-to-end recipe sale (real Helcim terminal charge -> receipt) and verify the Zoho invoice line items reflect scaled quantities and the recipe_snapshot stored in brewpad-integration includes target_volume_l, scale_factor, and scaled ingredients."
    expected: "Invoice line items in Zoho match scaled quantities (not base). recipe_snapshot.target_volume_l and .scale_factor are set; .ingredients is the scaled array."
    why_human: "UAT confirmed display behavior but a live completed sale was not pushed through the terminal. Server behavior is unit-tested in pos-recipe.test.js but live Zoho invoice inspection was not done."
  - test: "Trigger a 6x scale on a recipe with a low-stock ingredient to produce a 409, then click 'Manager Override — Proceed Anyway' and confirm the sale proceeds to a completed invoice."
    expected: "Override=true re-submits, sale completes, invoice created, override state is cleared."
    why_human: "Server 409 was confirmed live but the owner did not exercise the override-to-completion flow. Unit tests cover the path but live exercise was not recorded."
---

# Phase 35: Batch Scaling Engine — Verification Report

**Phase Goal:** Staff can enter a target batch volume; the system scales ingredient quantities (linear for weight, round-up for pcs), prices scaled recipes server-authoritatively, and captures scaled quantities in the Zoho invoice and frozen recipe_snapshot.
**Verified:** 2026-06-20
**Status:** human_needed (14/14 automated truths verified; 3 human items remain)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Weight ingredients (kg/g) scale linearly: 5 kg at 1.5x → 7.5 kg (SCALE-02) | VERIFIED | `scaleIngredient` in recipe-scaling.js uses `Math.round(rawQty * 10000) / 10000` for continuous units. Test suite: `recipe-scaling.test.js` asserts `.toBe(7.5)` and `.toBe(150)` for kg/g. |
| 2 | Discrete ingredients (pcs) round up, floor of 1: 2.3→3, 0.5x of 1 pcs stays 1 (SCALE-02) | VERIFIED | `Math.max(1, Math.ceil(rawQty))` on line 72 of recipe-scaling.js. Test: "floor-of-1: 0.5x of 1 pcs yeast stays 1" asserts `.toBe(1)`. |
| 3 | Blank/unknown unit scales linearly (SCALE-02, D-03) | VERIFIED | `if (!unitLower) { isContinuous = true; }` in recipe-scaling.js. Test: "blank unit defaults to linear scaling" asserts `.toBe(6)` for 4 * 1.5. |
| 4 | Staff can set a target batch volume; scale factor derived and displayed live (SCALE-01) | VERIFIED | admin.html has `#kiosk-recipe-volume-wrap`, `#kiosk-target-volume` (step=0.5, min=0.5), `#kiosk-scale-factor-readout`. admin.js `kioskShowRecipePrompt` sets readout to `'1.0×  base N L'` and `volInput.oninput` updates it live. 17-test frontend suite passes. |
| 5 | Recipe with no batch_size_l disables scaling with a prompt (SCALE-01, D-11) | VERIFIED | admin.js lines 11166-11170: `volInput.disabled = true` + readout set to "Scaling disabled — set base batch size in recipe editor first." Server also returns 400 when `baseVol <= 0`. |
| 6 | target_volume_l (and override) sent in BOTH recipeSaleBody and confirmBody (SCALE-01, SCALE-05) | VERIFIED | admin.js line 10429: `target_volume_l: _kioskTargetVolumeL || ...` in recipeSaleBody. Line 10480: `target_volume_l: saleBody.target_volume_l` in confirmBody. Confirmed by grep: 6 occurrences in admin.js. |
| 7 | Scale factor computed server-side from target_volume_l / batch_size_l; client scale_factor never trusted (SCALE-01, SCALE-03) | VERIFIED | `computeRecipeQuote` helper: `var scaleFactor = targetVolumeL / baseVol` (pos-recipe.js line 84). `grep body.scale_factor pos-recipe.js` returns nothing — client field is never read. |
| 8 | Server prices locked recipes as locked_price * scale_factor + service_fee + materials_fee for in-store (SCALE-03, D-04/D-05/D-06) | VERIFIED | `computeScaledRecipeTotal` in recipe-scaling.js: locked branch `total = Number(recipe.locked_price) * factor`; then `total += service_fee + materials_fee` when saleType='in-store'. Test fixture: 45*1.5+45+5=117.50 passes. pos-recipe.test.js asserts 342.50 for locked 195 at 1.5x in-store. |
| 9 | Dynamic recipe prices from sum(scaled_qty * catalog_rate) + fixed fees (SCALE-03, D-07) | VERIFIED | `computeScaledRecipeTotal` dynamic branch iterates scaledIngredients, summing `ing.quantity * catalogMap[ing.item_id].rate`. Tests cover this path. |
| 10 | Zoho invoice line items use scaled ingredient quantities; recipe_snapshot includes target_volume_l and scale_factor (SCALE-04) | VERIFIED | pos-recipe.js confirm handler: `lineItems` loop iterates `scaledIngredients` (line 394). Snapshot at lines 507-517: `target_volume_l: targetVolumeLConfirm`, `scale_factor: scaleFactorConfirm`, `ingredients: scaledIngredients`. pos-recipe.test.js C3 asserts snapshot includes both fields. |
| 11 | Scaled quantity exceeding stock returns 409 with conflicts list; override=true bypasses (SCALE-05, D-08) | VERIFIED | pos-recipe.js lines 176-181: `if (!quote.stockCheck.ok && !body.override) return res.status(409).json(...)`. Same in confirm handler (lines 385-390). Tests S8/S9 assert 409+conflicts and 202 with override. |
| 12 | 409 stock conflict surfaced in UI with manager-override button that re-submits (SCALE-05, D-08) | VERIFIED | admin.js lines 10445-10466: 409 branch populates `#kiosk-stock-conflict`, sets override button onclick to `_kioskStockOverride = true; kioskProcessSale()`. |
| 13 | Recipe stock checks read INGREDIENTS_ALL so internal-only ingredients report real stock (SCALE-05, 35-05 gap-closure) | VERIFIED | pos-recipe.js: `cache.get(C.CACHE_KEYS.INGREDIENTS_ALL)` at lines 91 and 369. recipes.js availability at line 323. Post-sale bust includes `cache.del(C.CACHE_KEYS.INGREDIENTS_ALL)` at line 499. Regression tests in pos-recipe.test.js and recipes.test.js pass. |
| 14 | GET /api/kiosk/recipe-quote returns same server-authoritative total as recipe-sale for identical inputs; no terminal/lock/invoice (SCALE-01, 35-06 gap-closure) | VERIFIED | `computeRecipeQuote` shared helper (pos-recipe.js lines 53-139) is called by both POST /api/kiosk/recipe-sale AND GET /api/kiosk/recipe-quote. Quote endpoint has no `helcimLib.terminalPurchase`, no `cache.acquireLock`, no `zohoPost`. Test Q2 asserts `quoteTotal === 342.50` matching recipe-sale total. Client wires quote into Add-to-Cart price and cart quantities. |

**Score:** 14/14 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `zoho-middleware/lib/recipe-scaling.js` | Pure helpers: scaleIngredient, scaleIngredients, computeScaledRecipeTotal, checkScaledStock + CONTINUOUS_UNITS/DISCRETE_UNITS | VERIFIED | 199 lines, 0 `require()` calls, all 6 exports present, `Math.max(1, Math.ceil` appears 3 times. |
| `zoho-middleware/__tests__/recipe-scaling.test.js` | Tests covering all 4 exports incl. worked locked fixture (95.00 / 117.50), floor-of-1, blank-unit linear | VERIFIED | Assertions for 7.5 kg, 150 g, pcs ceil, floor-of-1, blank→linear, 95.00 at 1x, 117.50 at 1.5x, dynamic sum, stock conflict — all passing. |
| `zoho-middleware/routes/pos-recipe.js` | Both quote and confirm handlers with scaling: validation, factor, scaleIngredients, computeScaledRecipeTotal, stock gate, enriched snapshot | VERIFIED | `require('../lib/recipe-scaling')` on line 13. `computeScaledRecipeTotal` called 2 times (lines 109, 447). `scaleIngredients` called 2 times. `target_volume_l` appears 36 times. Snapshot includes `target_volume_l`, `scale_factor`, `scaledIngredients`. |
| `zoho-middleware/__tests__/pos-recipe.test.js` | Route-level tests for scaling validation, locked/dynamic repricing, default-1x backward compat, invoice/snapshot scaled qty, stock 409 + override, recipe-quote endpoint | VERIFIED | Tests S1-S9, C1-C5, Q1-Q12, and INGREDIENTS_ALL regression describe block all pass (867 total middleware tests pass). |
| `admin.html` | Target-volume input + scale-factor readout + stock-conflict/override block inside #kiosk-recipe-prompt | VERIFIED | `#kiosk-recipe-volume-wrap`, `#kiosk-target-volume` (type=number, step=0.5, min=0.5, inputmode=decimal), `#kiosk-scale-factor-readout`, `#kiosk-stock-conflict`, `#kiosk-stock-override-btn` all confirmed in admin.html. |
| `js/admin.js` | Volume input wiring, factor readout, _kioskRecipeContext extension, target_volume_l/override in recipeSaleBody+confirmBody, 409 conflict handling + override re-submit, recipe-quote fetch | VERIFIED | All wiring confirmed: `_kioskTargetVolumeL`, `_kioskScaleFactor`, `_kioskStockOverride`, `_kioskQuote`, `kioskFetchRecipeQuote`, `kioskScheduleRecipeQuote`. 17-test frontend suite `kiosk-recipe-quote.test.js` passes. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `zoho-middleware/routes/pos-recipe.js` | `zoho-middleware/lib/recipe-scaling.js` | `require('../lib/recipe-scaling')` | WIRED | Confirmed on line 13 of pos-recipe.js |
| `pos-recipe.js` (both handlers) | `scaling.computeScaledRecipeTotal(...)` | shared `computeRecipeQuote` helper | WIRED | Called at lines 109 (quote) and 447 (confirm). Both paths invoke the same tested helper. |
| `pos-recipe.js confirm handler` | `recipe_snapshot.target_volume_l + scaledIngredients` | snapshot object passed to `detectRecipeSale` | WIRED | Lines 507-517 set `target_volume_l: targetVolumeLConfirm`, `scale_factor: scaleFactorConfirm`, `ingredients: scaledIngredients`. |
| `pos-recipe.js` | `scale_factor = target_volume_l / recipe.batch_size_l` | server-side factor computation | WIRED | Line 84: `var scaleFactor = targetVolumeL / baseVol`. Client `scale_factor` field is never read. |
| `admin.html #kiosk-target-volume` | `js/admin.js volInput.oninput -> factor readout` | `oninput` handler recomputes target/base | WIRED | Lines 11172-11186: oninput updates `_kioskTargetVolumeL`, `_kioskScaleFactor`, readout text, and schedules debounced quote. |
| `js/admin.js recipeSaleBody + confirmBody` | `POST /api/kiosk/recipe-sale(/confirm) target_volume_l` | request body fields | WIRED | Lines 10429 (recipeSaleBody) and 10480 (confirmBody) both include `target_volume_l`. |
| `js/admin.js 409 handler` | `manager override re-submit` | `_kioskStockOverride = true -> kioskProcessSale()` | WIRED | Lines 10459-10463: override button onclick sets flag and calls sale. |
| `admin.js kioskFetchRecipeQuote` | `GET /api/kiosk/recipe-quote` | debounced fetch with x-api-key | WIRED | Lines 10965-10997: `kioskFetchRecipeQuote` GETs `/api/kiosk/recipe-quote`, stores `_kioskQuote`, updates Add-to-Cart button. Called from `kioskShowRecipePrompt` and `volInput.oninput`. |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `pos-recipe.js` quote handler | `grandTotal` | `scaling.computeScaledRecipeTotal(recipe, scaledIngredients, catalogMap, saleType)` — recipe from Apps Script, catalog from `INGREDIENTS_ALL` Redis cache | Yes — live Apps Script + Redis, not hardcoded | FLOWING |
| `pos-recipe.js` confirm handler | `lineItems` + `grandTotal` | `scaledIngredients` (from `scaling.scaleIngredients(ingredients, scaleFactorConfirm)`) + `catalogMap` from `INGREDIENTS_ALL` | Yes — re-fetched server-side at confirm, never trusts client | FLOWING |
| `pos-recipe.js recipe-quote` | `total` + `ingredients[].quantity` | Same `computeRecipeQuote` helper as recipe-sale — same Apps Script + INGREDIENTS_ALL source | Yes — guaranteed to equal recipe-sale total for same inputs (Q2 test asserts equality) | FLOWING |
| `admin.js` Add-to-Cart button + cart | `_kioskQuote.total` + `_kioskQuote.ingredients` | `GET /api/kiosk/recipe-quote` server response | Yes — server-authoritative; client falls back to base price if quote unavailable | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| recipe-scaling.js exports pure functions (no require) | `grep -c 'require(' zoho-middleware/lib/recipe-scaling.js` | 0 | PASS |
| Discrete rounding formula present | `grep -c 'Math.max(1, Math.ceil' zoho-middleware/lib/recipe-scaling.js` | 3 | PASS |
| computeScaledRecipeTotal called in both route handlers | `grep -c 'computeScaledRecipeTotal' zoho-middleware/routes/pos-recipe.js` | 2 | PASS |
| scaleIngredients called in both route handlers | `grep -c 'scaleIngredients' zoho-middleware/routes/pos-recipe.js` | 2 (quote + confirm via shared helper + confirm direct) | PASS |
| Client-supplied scale_factor never read | `grep 'body.scale_factor' zoho-middleware/routes/pos-recipe.js` | (no output) | PASS |
| INGREDIENTS_ALL used for stock (not purchasable-only INGREDIENTS) | `grep -c 'CACHE_KEYS.INGREDIENTS_ALL' zoho-middleware/routes/pos-recipe.js` | 3 (get×2 + del×1) | PASS |
| Middleware test suite green | `cd zoho-middleware && npm test` | 867 passed, 39 suites, exit 0 | PASS |
| Frontend test suite green | `npm test` | 768 passed, 38 suites, exit 0 | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SCALE-01 | 35-03, 35-04, 35-06 | Staff can set target batch volume; system derives and displays scale factor | SATISFIED | admin.html input + readout wired; target_volume_l in both request bodies; server computes factor from target/base |
| SCALE-02 | 35-02 | Linear weight scaling, round-up discrete quantities | SATISFIED | recipe-scaling.js CONTINUOUS/DISCRETE_UNITS + Math.max(1,Math.ceil); all test cases pass |
| SCALE-03 | 35-02, 35-03 | Server-authoritative pricing (dynamic: sum scaled costs + fees; locked: scale ingredient portion) | SATISFIED | computeScaledRecipeTotal called in both route handlers; unit tests + route tests pass |
| SCALE-04 | 35-03 | Zoho invoice line items and recipe_snapshot reflect scaled quantities + target volume | SATISFIED | Confirm handler iterates scaledIngredients for lineItems; snapshot includes target_volume_l, scale_factor, scaledIngredients |
| SCALE-05 | 35-02, 35-03, 35-04, 35-05 | Scaled stock checks surface before sale; 409 conflict before sale with override path | SATISFIED | checkScaledStock called in both handlers; 409 returned + surfaced in UI; INGREDIENTS_ALL fix removes false positives for internal-only items |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `js/admin.js` | 6388, 7166, 7338, 7484, 7565, 7923, 8251 | Literal `'TBD'` string values | Info | User-facing display labels in pre-existing batch scheduling code (Phase 31); not debt markers. These strings are displayed as-is to represent an unscheduled packaging step. No issue with Phase 35. |

No blockers. No FIXME, XXX, or unresolved TBD debt markers introduced by Phase 35.

---

### Human Verification Required

#### 1. D-06 Locked-Price Increase (Live)

**Test:** Create or reconfigure a recipe with locked pricing. Open the admin Kiosk Sale tab, select that recipe at 1.0x scale. Confirm the total = locked_price + service_fee + materials_fee (not the old flat locked_price).
**Expected:** At 1x, total is HIGHER than the pre-phase locked_price alone. At 1.5x, total = locked_price * 1.5 + service_fee + materials_fee.
**Why human:** The only live recipe (Dangerous Bunny) is dynamic-priced. There is no locked-price recipe to exercise this path live. D-06 applies the fee-inclusive formula globally — this is an owner-visible price change on every locked recipe. Unit tests confirm the math (95.00 at 1x, 117.50 at 1.5x for the fixture). Live confirmation is needed to close the owner-awareness loop.

#### 2. Full End-to-End Recipe Sale (Real Terminal)

**Test:** Complete an actual kiosk recipe sale through the Helcim terminal — select a recipe, set a target volume, add to cart, confirm payment, receive receipt. Then check the Zoho invoice in the Books dashboard to verify line items match scaled quantities and the invoice total matches the scaled price.
**Expected:** Invoice line items reflect scaled ingredient quantities (not base). Invoice total = scaled total (matching the server-authoritative total, not the pre-scale price). The recipe batch record in brewpad includes target_volume_l and scale_factor in the recipe_snapshot.
**Why human:** UAT confirmed the display (price preview, cart quantities), but a live terminal charge was not completed. Server behavior is covered by pos-recipe.test.js mock tests (scaled invoice qty, enriched snapshot). Live Zoho inspection is needed to confirm SCALE-04 end-to-end.

#### 3. Manager Override to Completion (Live)

**Test:** Enter a target volume large enough to exceed an ingredient's stock_on_hand. Confirm the 409 conflict panel appears listing the short ingredient. Click "Manager Override — Proceed Anyway". Confirm the sale proceeds to a completed invoice.
**Expected:** Conflict panel shows item_name, needed qty, stock qty. Override button sets override=true, re-submits sale, terminal charges, invoice created successfully.
**Why human:** Server 409 was confirmed live (6x Gambrinus). Override button wiring is unit-tested. The full override-to-completion live flow was not exercised during UAT. D-08 is a staff safety feature that must be confirmed to work end-to-end in the actual kiosk environment.

---

### Gaps Summary

No gaps. All 14 must-have truths are VERIFIED by code inspection, grep evidence, and passing test suites (middleware: 867 tests; frontend: 768 tests, both exit 0). The 3 human verification items above are explicitly documented in the phase SUMMARY as known follow-ups — they are not codebase failures.

**Automated verification is fully satisfied.** Proceeding requires completing the 3 human UAT items (particularly the live D-06 locked-price confirmation, since it is owner-visible behavior).

---

_Verified: 2026-06-20_
_Verifier: Claude (gsd-verifier)_
