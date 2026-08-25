---
phase: 73-recipe-dynamic-pricing-unit-conversion-correctness-unit-awar
verified: 2026-08-25T20:28:10Z
status: human_needed
score: 19/19 committed must-haves verified
overrides_applied: 0
human_verification:
  - test: "Decide disposition of 73-REVIEW.md CR-01 (checkScaledStock stock-conflict gate compares scaled ingredient quantity to catalog stock_on_hand with NO unit conversion — same bug class this phase exists to fix, on the same computeRecipeQuote/_runRecipeConfirm request path 73-03 modified)"
    expected: "Either (a) accept as tracked follow-on work and open a gap-closure plan / new phase per this project's own precedent for Critical review findings (Phases 27-04, 29-04, 29.2-04), or (b) require it be fixed before Phase 73 / the v4.5 milestone is considered closed."
    why_human: "Not a failure of any plan-declared must-have (RESEARCH.md's AC-03 scoping explicitly enumerates only the 5 cost-SUM sites, not the stock-availability gate) but the ROADMAP goal text and 73-CONTEXT.md both use the phrase 'stock draw-down can never diverge', which a reasonable reading could extend to this gate. Concrete risk: a per-kg item stocked as e.g. 400 g on hand vs a recipe line needing 0.5 kg reads '0.5 > 400 == false' (no conflict reported) — a sale can proceed that oversells physical inventory, or the reverse magnitude produces false stock-blocks on valid sales. This is a scope/severity judgment call for the owner, not something code inspection alone can resolve."
  - test: "Decide disposition of 73-REVIEW.md CR-02 (js/brewpad.js recipe editor's Cost/Retail per-row columns and Totals footer — renderIngredientRows ~L2387-2388, attachIngredientRowListeners ~L2456-2457, selectIngredientFromAutocompleteBp ~L2548-2549 — still compute qty * rate / qty * purchase_rate with NO unit conversion, the exact SV-R-000004 bug class, feeding the number staff use to set locked_price)"
    expected: "Either accept as follow-on UI work (server-side computed_price, which staff also see, IS correctly unit-aware after this phase) or require a client-side bpIngredientLineCost mirror before closing."
    why_human: "Does not corrupt the server-authoritative dynamic computed_price (verified correct), but directly undermines the LOCKED-price-setting workflow staff use, which is squarely the class of bug (~20x-off totals) this phase was commissioned to eliminate. Confirmed still present in current code (js/brewpad.js:2387-2388, 2456-2457, 2548-2549)."
---

# Phase 73: Recipe dynamic pricing unit-conversion correctness — Verification Report

**Phase Goal:** Fix the recipe dynamic-pricing money-path so ingredient cost is computed unit-aware (rate×quantity WITH unit conversion), eliminating the ~20× overcharge. Wire the ONE shared unit-aware helper into every in-scope cost-sum site (recipe read-path, POS sale/stock confirm, save-time validation), fail closed on un-convertible units, and harden the BrewPad editor save path so a failed save never orphans a recipe.
**Verified:** 2026-08-25T20:28:10Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

Every requirement/decision ID declared across the 5 plans (AC-01, AC-02, AC-03, AC-04, AC-05, D-01, D-02, D-03, D-04, D-05/D-05a/D-05b/D-05c/D-05d, D-06) was cross-referenced against the actual codebase — not SUMMARY.md prose — by reading the modified source files directly and independently re-running the test suites (not trusting the SUMMARYs' reported pass counts). All are implemented and covered by passing, non-vacuous regression tests. See "Requirements Coverage" below for the per-ID trace.

Independently of the plan-declared scope, 73-REVIEW.md (run as part of this phase's own QA process) found 2 Critical, same-bug-class gaps that are NOT covered by any plan's must_haves but sit on the exact code paths this phase modified. These are surfaced as human-decision items (see frontmatter) rather than FAILED truths, because RESEARCH.md's own AC-03 scoping document explicitly enumerates only 5 cost-SUM sites (all wired) as in-scope — the stock-conflict gate and the BrewPad client-side totals were never a committed deliverable of any of the 5 plans. See "Known Follow-On Risk" section below for full reasoning.

### Observable Truths (merged from ROADMAP goal + all 5 PLAN.md frontmatter must_haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A per-kg item consumed in grams is priced by the converted quantity, not the raw gram count (73-01) | VERIFIED | `ingredientLineCost({unit:'kg',rate:54},{unit:'g',quantity:12})` → `{ok:true, convertedQty:0.012, cost:0.648}`; `recipe-scaling.js:364-401`; 8/8 `ingredientLineCost` jest tests pass (independently re-run) |
| 2 | A recipe line whose unit cannot convert refuses to price with a named error, never a silent product (D-02) | VERIFIED | `ingredientLineCost` returns `{ok:false, error:'Cannot price "<item>"...'}` on cross-family; `recipe-scaling.js:372-383` |
| 3 | Dynamic-mode and locked-mode-added aggregate totals in recipe-scaling.js compute via the one shared helper | VERIFIED | `computeScaledRecipeTotal` L146, `computeModifiedRecipeTotal` L278 both call `ingredientLineCost` and throw `RecipeLineUnitError` on `!ok` |
| 4 | D-06 imperial-unit scope decided from live recipe data, not a guess | VERIFIED | 73-01-SUMMARY.md records a live `GET /api/recipes`+`GET /api/recipes/:id` audit of all 8 recipes / 91 ingredient lines against the deployed middleware; zero imperial units found on cost lines; decision recorded in code comment `recipe-scaling.js:312-318` |
| 5 | Recipe DETAIL `computed_price` is unit-converted (73-02) | VERIFIED | `enrichWithComputedPrice` calls `scaling.ingredientLineCost(entry, ing)` at `recipes.js:123` |
| 6 | Recipe LIST `computed_price` is unit-converted (73-02) | VERIFIED | `enrichListPrices` calls `scaling.ingredientLineCost(entry, ing)` at `recipes.js:219` |
| 7 | SV-R-000004 (corrected Whirlfloc line) recomputes to ~$88-95, not $1,896.98, via fixture-only regression (D-04) | VERIFIED | `recipes.test.js:891-907` asserts `price` in `[88,95]` and `not.toBeCloseTo(1896.98,1)`; test independently re-run, passes; no live recipe data touched (git log shows no data-mutation commits) |
| 8 | A single un-priceable line marks that recipe's price as errored without aborting the whole list response | VERIFIED | `recipes.js:227-244` sets `computed_price=null`+`pricing_error` per-recipe inside a `Promise.all` map with a `.catch()` guard (T-73-04) |
| 9 | Kiosk recipe-quote per-line total is unit-converted (73-03) | VERIFIED | `pos-recipe.js:493` `line_total = scaling.ingredientLineCost(catalogEntry, scaled).cost` |
| 10 | pos-recipe sale invoice line quantity is the converted quantity (stock draw-down uses converted qty) | VERIFIED | `pos-recipe.js:692` `quantity: ingResult.convertedQty` — this is what Zoho decrements (no unit override in the invoice payload) |
| 11 | Kiosk quote total equals the invoice-line total the sale produces for the same recipe/scale | VERIFIED | `pos-recipe.test.js` test "U2. quote total equals summed invoice line totals" passes (independently re-run) |
| 12 | Non-convertible line refuses BEFORE any charge (422); if it reaches post-charge, transaction is voided (tiered D-02) | VERIFIED | Pre-charge: `pos-recipe.js:229-237` loop rejects `{status:422}` inside `computeRecipeQuote`, called before `terminalPurchase`/lock acquire; post-charge: `pos-recipe.js:712-728` routes an unpriceable line through `helcimLib.voidTransaction`; tests U4a (422, charge not attempted) and U4c (void called) both pass |
| 13 | Discount distribution over a converted-quantity line still caps/distributes correctly | VERIFIED | `pos-recipe.test.js` test "U3. discount... proportional to CONVERTED line cost" passes |
| 14 | Un-convertible unit/rate mismatch rejected at save with 422 naming the line, BEFORE any Apps Script write (D-03/AC-05) | VERIFIED | `validateIngredientUnits` (`recipes.js:435-480`) runs inside the `.then()` chain preceding `callAppsScriptPost` on both POST (`:489`) and PUT (`:533`); tests assert `mocks.axios.post).not.toHaveBeenCalled()` on reject (7 lines in `recipes.test.js`, all passing) |
| 15 | Save error bodies carry machine-readable `code`+`cause` alongside the human string (D-05c contract) | VERIFIED | `recipes.js:466-471` returns `{error, code:'unit_mismatch', cause}`; activation guardrails (`:522`,`:528`) and save-failure bodies (`:495`,`:503`,`:539`,`:547`) all carry `code` too |
| 16 | Invalid 'L' unit on Whirlfloc (count item) is caught by the D-03 validator (D-01 code side, AC-04) | VERIFIED | Test "PUT: Whirlfloc (pcs) line saved with unit 'L' is rejected 422 with unit_mismatch code (D-01)" passes |
| 17 | A failed recipe save preserves the in-progress editor form and restores it via sessionStorage round-trip, even on reload (D-05a) | VERIFIED | `js/brewpad.js:2789-2791` `saveRecipeDraftNow()` called from `submitRecipeSave`'s `.catch()`; `_formSavers` registration at `:9035-9048`; 12/12 `brewpad-recipe-save-resilience.test.js` tests pass (independently re-run) incl. draft round-trip and restore-repopulates-form |
| 18 | saveRecipe treats any non-2xx response as failure (422/502 can't be misread as success) (D-05b) | VERIFIED | `js/brewpad.js:2761-2776` checks `r.ok`/`result.httpOk` before trusting body shape; tests "422/502 with empty body is still a failure" pass |
| 19 | Transient/network (502) failures offer a retry without re-entering the form (D-05d) | VERIFIED | `js/brewpad.js:2809-2813` `isTransient` gate + `onAction: submitRecipeSave(endpoint, method, formData, recipeId)` reuses the already-built payload; retry tests pass |

**Score:** 19/19 plan-committed truths verified. Full middleware suite (93/93 suites, 1436/1436 tests), full frontend suite (81/81 suites, 1126/1126 tests), and both lint configs (`js/` and `zoho-middleware/`) were independently re-run during this verification and pass cleanly — not taken from SUMMARY.md claims.

### Known Follow-On Risk (Not a Failure of Phase 73's Committed Scope — Escalated for Owner Decision)

`73-REVIEW.md` (standard-depth review, run as part of this phase) found **2 Critical** issues. Both were independently re-confirmed present in the current codebase during this verification (not taken on the review's word):

**CR-01 — `checkScaledStock` (recipe-scaling.js:181-206) compares unconverted quantities against catalog `stock_on_hand`.** Confirmed still unconverted (`needed = Number(ing.quantity) || 0` vs `entry.stock_on_hand`, no `ingredientLineCost`/`classifyUnit` call). Used by both `pos-recipe.js:240` (quote-time gate) and `pos-recipe.js:665` (confirm-time belt-and-suspenders gate) — the SAME request paths 73-03 modified. 73-03-SUMMARY.md's own "Deviations" section documents the executor discovering this exact landmine (a test fixture spuriously tripped the false-conflict gate) and choosing to route around it rather than fix it, explicitly flagging it "for a future phase (not this plan's scope)."

**CR-02 — `js/brewpad.js` recipe editor Cost/Retail columns + Totals footer (~L2387-2388, 2456-2457, 2548-2549) still compute `qty * rate` with no conversion.** Confirmed still present. Server-side `computed_price` (what the recipe list/detail actually charges) IS correctly unit-aware after this phase — this gap is isolated to the editor's staff-facing preview used to decide `locked_price`.

**Why these are not scored as FAILED must-haves:** No plan's `must_haves.artifacts`/`key_links` names `checkScaledStock` or the BrewPad totals/cost columns. `73-RESEARCH.md`'s own AC-03 scoping document explicitly enumerates "5 sum-sites" (all cost-summing, i.e. `Σ rate×qty` sites) as the in-scope surface for "quote == displayed == sale invoice == stock draw-down" — `checkScaledStock` is a quantity-vs-quantity availability gate, not a cost-sum site, and was never one of the 5. All 5 declared sum-sites ARE wired and verified above (truths 1, 3, 5, 6, 9, 10).

**Why this still needs a human decision:** The ROADMAP.md phase-goal text and 73-CONTEXT.md both use language ("stock draw-down... can never diverge") broad enough that a reasonable reader — including this phase's own code reviewer — read it as covering the stock-conflict gate too. The practical risk is real (false "stock OK" enabling overselling on unit-mismatched lines, or false stock-blocks on valid sales) and sits on money-adjacent inventory-integrity code this phase directly touched. This project has an established precedent (Phase 27 → 27-04, Phase 29 → 29-04/29-05, Phase 29.2 → 29.2-04/29.2-05) of opening an explicit gap-closure plan for Critical review findings before considering a phase closed — no such plan or tracked follow-up phase exists yet for CR-01/CR-02, and ROADMAP.md's Phase 73 entry does not reference 73-REVIEW.md's findings at all.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `zoho-middleware/lib/recipe-scaling.js` | `ingredientLineCost`+`classifyUnit` exported, wired into both in-file sums | VERIFIED | Exports at L407-417; wired L146, L278 |
| `zoho-middleware/__tests__/recipe-scaling.test.js` | Unit-cost regression cases | VERIFIED | 8 `ingredientLineCost`-scoped tests pass |
| `zoho-middleware/routes/recipes.js` | Detail+list `computed_price` + D-03 pre-flight wired | VERIFIED | `ingredientLineCost` at L123/L219; `validateIngredientUnits` at L435-480, called L489/L533 |
| `zoho-middleware/__tests__/recipes.test.js` | SV-R-000004 + fail-closed + D-03 reject tests | VERIFIED | All relevant tests independently re-run, pass |
| `zoho-middleware/routes/pos-recipe.js` | Sale lineItems + quote line_total wired; tiered fail-closed/void | VERIFIED | L493, L692, L234 (422), L728 (void) |
| `zoho-middleware/__tests__/pos-recipe.test.js` | quote==sale, converted stock draw-down, discount, void tests | VERIFIED | U1-U4c tests independently re-run, pass |
| `js/brewpad.js` | Draft registration + r.ok check + code/cause + retry | VERIFIED | `RECIPE_DRAFT_KEY` L773, `_formSavers` push L9035, `submitRecipeSave` L2751-2820 |
| `js/brewpad.min.js` | Rebuilt bundle | VERIFIED | Same commit (`08bc23af`) as `js/brewpad.js`; `sv-brewpad-recipe-draft` string present in minified output |
| `tests/frontend/brewpad-recipe-save-resilience.test.js` | Draft/non-2xx/retry regression tests | VERIFIED | 12/12 tests independently re-run, pass |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `computeScaledRecipeTotal` | `ingredientLineCost` | per-line call in sum loop | WIRED | `recipe-scaling.js:146` |
| `computeModifiedRecipeTotal` | `ingredientLineCost` | per-added-line call | WIRED | `recipe-scaling.js:278` |
| `enrichWithComputedPrice` | `scaling.ingredientLineCost` | replaces L119 multiply | WIRED | `recipes.js:123` |
| `enrichListPrices` | `scaling.ingredientLineCost` | replaces L197 multiply | WIRED | `recipes.js:219` |
| `_runRecipeConfirm` lineItems build | `scaling.ingredientLineCost` | `convertedQty` → invoice `quantity` | WIRED | `pos-recipe.js:684-692` |
| `computeRecipeQuote` ingredientList | `scaling.ingredientLineCost` | `line_total` from `.cost` | WIRED | `pos-recipe.js:493` |
| POST/PUT `/api/recipes` | `scaling.classifyUnit`/`ingredientLineCost` | async pre-flight before `callAppsScriptPost` | WIRED | `recipes.js:462`, called from `:489`/`:533` before `:493`/`:537` |
| `js/brewpad.js saveRecipe` | `response.ok` check | non-2xx treated as failure | WIRED | `:2770` |
| `js/brewpad.js` recipe editor form | `_formSavers` draft system | registration + failure-path snapshot | WIRED | `:9035`, invoked from `:2791` |
| **Not wired (flagged, see above):** `checkScaledStock` | `ingredientLineCost`/`classifyUnit` | — | **NOT WIRED** | `recipe-scaling.js:181-206` still compares raw `ing.quantity` to `stock_on_hand` (CR-01) |
| **Not wired (flagged, see above):** BrewPad `renderIngredientRows`/totals | client-side unit-aware cost helper | — | **NOT WIRED** | `js/brewpad.js:2387-2388,2456-2457,2548-2549` still `qty * rate` (CR-02) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| AC-01 | 73-01, 73-02, 73-03 | Dynamic pricing multiplies each ingredient by unit-converted quantity | SATISFIED | Truths 1, 5, 6, 9, 10 |
| AC-02 | 73-02 | SV-R-000004 recomputes to ~$88-95 | SATISFIED | Truth 7 |
| AC-03 | 73-02, 73-03 | Kiosk quote, computed_price, actual sale invoice + stock draw-down (as scoped to the 5 cost-sum sites per RESEARCH.md) agree | SATISFIED (narrow/plan scope); see Known Follow-On Risk for the broader-reading caveat (CR-01) | Truths 9, 10, 11 |
| AC-04 | 73-04 | Multi-unit pack items (Whirlfloc) handled correctly — invalid 'L' unit rejected at save | SATISFIED | Truth 16 |
| AC-05 | 73-04 | Recipes can't be saved with an un-convertible unit/rate mismatch | SATISFIED | Truths 14, 15 |
| D-01 | 73-04 | Code side: reject invalid `L` unit on count item; Zoho item redefinition explicitly out of code scope (owner data action) | SATISFIED | Truth 16 |
| D-02 | 73-01, 73-02, 73-03 | Fail closed, name the offending line, on every money/pricing path | SATISFIED (see CR-01 caveat for the stock-availability gate specifically) | Truths 2, 8, 12 |
| D-03 | 73-04 | Save-time unit validation before Apps Script write | SATISFIED | Truths 14, 15 |
| D-04 | 73-02 | No live recipe data edited; fixture-driven regression only | SATISFIED | Truth 7; git log shows no data-mutation commits |
| D-05/D-05a-d | 73-05 | Editor save resilience: draft-preserve, non-2xx detection, code/cause, retry | SATISFIED | Truths 17, 18, 19 |
| D-06 | 73-01 | Imperial scope decided from live data | SATISFIED | Truth 4 |

No orphaned requirements: every AC-*/D-* ID declared across all 5 plans' frontmatter was traced to implementation evidence above.

### Anti-Patterns Found

None blocking. Grepped all phase-touched files (`recipe-scaling.js`, `routes/recipes.js`, `routes/pos-recipe.js`, `js/brewpad.js`) for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER`. The only hits in `js/brewpad.js` are pre-existing, unrelated UI strings for batch/task scheduling ("Bottling date TBD", "Packaging Step... date TBD") — not in any code path touched by this phase.

### Behavioral Spot-Checks / Test Suite Re-Run (independently executed, not from SUMMARY.md)

| Check | Command | Result | Status |
|-------|---------|--------|--------|
| Full middleware suite | `cd zoho-middleware && npm test` | 93/93 suites, 1436/1436 tests pass | PASS |
| Full frontend suite | `npm test` | 81/81 suites, 1126/1126 tests pass | PASS |
| Frontend lint | `npm run lint` | clean | PASS |
| Middleware lint | `cd zoho-middleware && npm run lint` | clean | PASS |
| `ingredientLineCost` unit tests | `npx jest recipe-scaling.test.js -t ingredientLineCost` | 8/8 pass | PASS |
| SV-R-000004 + unit_mismatch tests | `npx jest recipes.test.js -t "SV-R-000004\|unit_mismatch\|88"` | 4/4 pass | PASS |
| D-03/Whirlfloc/activation tests | `npx jest recipes.test.js -t "D-03\|Whirlfloc\|tablet\|activation"` | 7/7 pass | PASS |
| pos-recipe conversion/discount/void tests | `npx jest pos-recipe.test.js -t "convert\|Convert\|Discount\|void\|Void"` | 7/7 pass (66 unrelated skipped by filter) | PASS |
| BrewPad save-resilience frontend tests | `npx jest brewpad-recipe-save-resilience.test.js` | 12/12 pass | PASS |

### Human Verification Required

See frontmatter `human_verification` — 2 items (CR-01, CR-02 disposition). Both require an owner/developer scope decision, not further code inspection.

### Gaps Summary

No plan-declared must-have failed. All 19 observable truths derived from the ROADMAP goal + all 5 plans' frontmatter `must_haves` are VERIFIED against actual code and passing tests (independently re-run, not SUMMARY-trusted). Every AC-*/D-* ID declared across the phase's 5 plans is accounted for and implemented.

The phase is NOT marked `passed` because 73-REVIEW.md's own Critical findings (CR-01, CR-02) — confirmed still present in the current codebase during this verification — sit on the exact code paths this phase modified, are the same bug class this phase was commissioned to eliminate, and are referenced by broad phrasing in the phase's own goal/context documents that a reasonable reader (including the phase's own reviewer) could interpret as in-scope. Neither is tracked in a gap-closure plan or a future ROADMAP phase, unlike this project's own established practice for Critical review findings (Phases 27, 29, 29.2). This is an escalation, not a failure: the owner should decide whether to (a) open a gap-closure plan now, (b) explicitly accept via a VERIFICATION.md override + track as a new phase, or (c) accept as-is with documented rationale.

---

*Verified: 2026-08-25T20:28:10Z*
*Verifier: Claude (gsd-verifier)*
