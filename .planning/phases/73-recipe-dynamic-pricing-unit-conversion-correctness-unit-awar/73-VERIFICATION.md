---
phase: 73-recipe-dynamic-pricing-unit-conversion-correctness-unit-awar
verified: 2026-08-25T22:10:00Z
status: passed
score: 21/21 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 19/19 committed must-haves (plus 2 escalated Critical findings, unresolved)
  gaps_closed:
    - "CR-01: checkScaledStock (recipe-scaling.js) compared raw unconverted recipe-line quantity against catalog stock_on_hand — closed by 73-06, now converts via ingredientLineCost.convertedQty and fails CLOSED (reports conflict, never a raw-quantity fallback) on non-convertible units"
    - "WR-01: GET /api/recipes/:id/availability computed batches_possible from raw unconverted quantity — closed by 73-06, now retains the full catalog entry and converts via ingredientLineCost before dividing"
    - "CR-02: js/brewpad.js recipe editor Cost/Retail columns + Totals footer computed qty*rate with no unit conversion — closed by 73-07, now routed through a new bpIngredientLineCost ES5 mirror of the server helper at all three sites (renderIngredientRows, attachIngredientRowListeners, selectIngredientFromAutocompleteBp), with a distinct ing.catalog_unit field captured separately from the recipe-line ing.unit so the conversion is not a no-op"
  gaps_remaining: []
  regressions: []
---

# Phase 73: Recipe dynamic pricing unit-conversion correctness — Re-Verification Report

**Phase Goal:** Fix the recipe dynamic-pricing money-path so ingredient cost is computed unit-aware (rate×quantity WITH unit conversion), eliminating the ~20× overcharge; wire the shared unit-aware helper into every cost-sum AND stock-comparison site, fail closed on un-convertible units, and harden the BrewPad editor (save resilience + unit-aware price preview).
**Verified:** 2026-08-25T22:10:00Z
**Status:** passed
**Re-verification:** Yes — after gap-closure plans 73-06 (CR-01/WR-01) and 73-07 (CR-02) landed

## Goal Achievement

This is a re-verification of the 2026-08-25T20:28:10Z report, which scored all 19 plan-committed
must-haves VERIFIED but withheld a `passed` status pending an owner decision on two Critical
findings from `73-REVIEW.md` (CR-01, CR-02) that sat on the exact code paths this phase modified.
The owner routed both to gap-closure plans (73-06, 73-07). This report independently re-confirms,
by reading the current source (not SUMMARY.md prose) and independently re-running every test
suite and lint, that both gaps are genuinely closed, fail closed correctly, introduce no
regression, and do not reopen any previously-verified truth.

### Observable Truths — Gap-Closure Items (CR-01/WR-01/CR-02)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 20 | `checkScaledStock` compares the unit-CONVERTED quantity (not raw `ing.quantity`) against `stock_on_hand`, in both directions of unit magnitude | VERIFIED | `recipe-scaling.js:188-229`: `var lineCost = ingredientLineCost(entry, ing); ... var needed = lineCost.convertedQty;`. Test `"CR-01: mixed-unit oversell inverse direction (g-stocked item, 400g on hand, 0.5kg line) IS reported as a conflict"` — the exact silent-oversell scenario named in `73-REVIEW.md` CR-01 (`0.5 > 400 == false` pre-fix) — passes, independently re-run |
| 21 | Non-convertible unit pair at the stock gate fails CLOSED (reported as a conflict), not a raw-quantity fallback | VERIFIED | `recipe-scaling.js:198-210`: on `!lineCost.ok`, pushes a conflict unconditionally — no `Number(ing.quantity)` fallback path exists (this explicitly rejects the fallback snippet `73-REVIEW.md` itself suggested). Test `"CR-01: non-convertible unit (pcs item, g line) fails CLOSED — reported as a conflict, never a silent pass"` passes |
| 22 | Both `pos-recipe.js` stock-gate call sites (quote-time `computeRecipeQuote`, confirm-time `_runRecipeConfirm`) consume the fixed `checkScaledStock` unchanged | VERIFIED | `pos-recipe.js:240` (quote gate), `:761` (confirm gate) both call `scaling.checkScaledStock(scaledIngredients, catalogMap)` — same call signature, no caller-side change needed |
| 23 | The `pos-recipe.js` confirm handler's POST-CHARGE unpriceable-line void safety net runs BEFORE the (now stricter, fail-closed) stock re-check, so a non-convertible line at confirm time still voids the charge instead of returning a bare 409 | VERIFIED | `pos-recipe.js:668-761`: unpriceable-line detection loop (`:676-707`) and its `voidTransaction`/502 response (`:709-755`) precede `checkScaledStock` (`:761`) in source order. Test `"U4c. POST recipe-sale/confirm (post-charge safety net) voids the transaction instead of a bare 400"` uses a genuinely cross-family fixture (catalog `unit:'kg'` vs recipe line `unit:'pcs'`, item `ing-badunit-1`) that would ALSO trip the fail-closed stock gate if reached first — asserts `res._status` is `502` with `payment_voided:true`, not `400`/`409`; passes, independently re-run |
| 24 | `GET /api/recipes/:id/availability` computes `batches_possible`/`status` from the unit-converted needed quantity, retaining the catalog entry's `unit` | VERIFIED | `recipes.js:380-406`: `entryMap` retains the full catalog entry (was a stock-only map pre-fix); `needed = scaling.ingredientLineCost(entry, ing).convertedQty`. Test `"WR-01: mixed-unit availability converts before computing batches_possible (per-kg item, 500g line -> 2 batches, low)"` reproduces the exact pre-fix bug numbers (`floor(1/500)=0` buggy vs `floor(1/0.5)=2` fixed) and passes |
| 25 | Non-convertible availability line fails CLOSED (conservative `0`/`out` badge), not a raw division | VERIFIED | `recipes.js:395-401`: `else { needed = -1; }` on `!lineCost.ok`, then `batches = needed < 0 ? 0 : ...`. Test `"WR-01: non-convertible unit fails CLOSED (pcs item, g line) — reported unavailable, not a raw unconverted division"` passes |
| 26 | BrewPad recipe-editor Cost/Retail columns and Totals footer compute unit-aware cost matching server `ingredientLineCost`, at all three sites (`renderIngredientRows`, `attachIngredientRowListeners`, `selectIngredientFromAutocompleteBp`) | VERIFIED | `js/brewpad.js:2466-2468` (render), `:2542-2544` (qty-change recompute), `:2643-2645` (selection recompute) — all three call `bpIngredientLineCost({unit:catalogUnit,rate:...},{unit:ing.unit,quantity:qty})`. `grep -c bpIngredientLineCost js/brewpad.js` shows the definition (`:802`), 3 wiring call-site pairs (6 calls), and the export — no remaining raw `qty * costEach`/`qty * retailEach` at these sites |
| 27 | A gram-quantity line against a per-kg catalog item shows the converted cost ($0.65 for 12g@$54/kg), not the raw product ($648) | VERIFIED | `tests/frontend/brewpad-recipe-editor-cost.test.js` test `"mass conversion: 12 g line against a $54/kg catalog item -> $0.65 (not $648)"` passes (independently re-run); test also asserts numeric parity against the real server `zoho-middleware/lib/recipe-scaling.js` module via cross-require (not copied literals) |
| 28 | The catalog item's unit is captured on a field DISTINCT from the recipe-line unit, so the conversion is not a silent no-op | VERIFIED | `js/brewpad.js:247` (`enrichIngredientsWithCatalogRates`: `if (match.unit) ing.catalog_unit = match.unit;` — set unconditionally, alongside the pre-existing blank-only `ing.unit` backfill at `:248`, so an existing recipe's differing line unit is preserved) and `:2621` (`selectIngredientFromAutocompleteBp`: `ing.catalog_unit = item.unit`) |
| 29 | A non-convertible editor line renders a visible indicator, excluded from the Totals sum, instead of a silently-wrong number | VERIFIED | `js/brewpad.js:2480-2481`: `costResult.ok ? '$'+lineCost.toFixed(2) : '<span class="bp-ing-cost-unconvertible" title="...">N/A</span>'`; totals accumulation at `:2471-2472` gated on `costResult.ok`/`retailResult.ok` |
| 30 | `js/brewpad.min.js` is regenerated from source (not hand-edited) and committed together with `js/brewpad.js` | VERIFIED | `git log -1 -- js/brewpad.js` and `git log -1 -- js/brewpad.min.js` both resolve to the same commit `1aa49065`; `grep -o bpIngredientLineCost js/brewpad.min.js` finds 9 hits including the unmangled `module.exports` property name, matching the 3 wiring sites + definition + export in the source |

**Score:** 11/11 gap-closure truths verified (21/21 combined with the 19 already-verified plan-committed truths from the initial report — none regressed).

### Regression Check on Previously-Verified Truths (1–19)

Full independent re-run of both test suites and both lints (below) confirms all 19 previously
VERIFIED truths still hold — no test that covered truths 1–19 was modified in a way that weakens
its assertions, and no previously-passing test now fails. Test counts increased by exactly the
number of new gap-closure regression tests added (middleware: 1436→1445, +9 = 6 new
`checkScaledStock` CR-01 tests + 3 new availability WR-01 tests; frontend: 1126→1134, +8 = new
`brewpad-recipe-editor-cost.test.js` suite), with zero net deletions or skips of prior assertions.

### Required Artifacts (Gap-Closure)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `zoho-middleware/lib/recipe-scaling.js` | `checkScaledStock` converts via `ingredientLineCost`, fails closed | VERIFIED | `:188-229`, calls `ingredientLineCost` at `:196`, fail-closed branch `:198-210` |
| `zoho-middleware/__tests__/recipe-scaling.test.js` | Mixed-unit `checkScaledStock` regression (both oversell directions + non-convertible + same-unit regressions) | VERIFIED | 6 new `CR-01:`-prefixed tests, all pass |
| `zoho-middleware/routes/recipes.js` | Availability handler unit-converts before `batches_possible` | VERIFIED | `:380-406`, `entryMap` retains `unit`, `ingredientLineCost` call at `:392` |
| `zoho-middleware/__tests__/recipes.test.js` | WR-01 mixed-unit/non-convertible/same-unit availability regressions | VERIFIED | 3 new `WR-01:`-prefixed tests, all pass |
| `zoho-middleware/routes/pos-recipe.js` | Confirm-handler reorder: unpriceable-line void safety net before stock re-check | VERIFIED | Source order `:668-761`; `U4c` regression test (cross-family fixture) asserts 502/void, not 409 |
| `js/brewpad.js` | `bpIngredientLineCost`/`bpClassifyUnit` module-scope mirror, exported, wired into 3 sites; distinct `catalog_unit` field | VERIFIED | Definition `:784-829`ish, export `:9322-9323`, 3 call-site pairs at `:2467-2468`/`:2543-2544`/`:2644-2645`, `catalog_unit` set at `:247` and `:2621` |
| `js/brewpad.min.js` | Rebuilt bundle containing the new helper, same commit as `js/brewpad.js` | VERIFIED | Same commit `1aa49065`; `bpIngredientLineCost` present unmangled in the exports object |
| `tests/frontend/brewpad-recipe-editor-cost.test.js` | Parity + fail-closed + mixed-list-sum regression, cross-requiring the real server module | VERIFIED | 8/8 tests pass, cross-requires `zoho-middleware/lib/recipe-scaling` for genuine parity assertions |

### Key Link Verification (Gap-Closure)

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `checkScaledStock` | `ingredientLineCost` | per-line `.convertedQty` vs `stock_on_hand`, fail closed on `!ok` | WIRED | `recipe-scaling.js:196-210` |
| `routes/recipes.js` availability handler | `scaling.ingredientLineCost` | converted `needed` for `batches_possible` | WIRED | `recipes.js:392-401` |
| `pos-recipe.js` `/confirm` handler | unpriceable-line check → `checkScaledStock` | source-order precedence (void safety net first) | WIRED (reordered) | `pos-recipe.js:668` (unpriceable loop) precedes `:761` (`checkScaledStock` call) |
| `renderIngredientRows` / `attachIngredientRowListeners` / `selectIngredientFromAutocompleteBp` | `bpIngredientLineCost` | replaces raw `qty * costEach`/`qty * retailEach` | WIRED | `js/brewpad.js:2467-2468`, `:2543-2544`, `:2644-2645` |
| `enrichIngredientsWithCatalogRates` / `selectIngredientFromAutocompleteBp` | distinct `ing.catalog_unit` field | separate from `ing.unit` (recipe-line unit) | WIRED | `js/brewpad.js:247`, `:2621` — confirmed NOT the same field as `ing.unit` (line 248's blank-only backfill for `ing.unit` is untouched, preserving a genuinely differing existing recipe-line unit) |

**Previously flagged "NOT WIRED" entries from the initial VERIFICATION.md are now resolved:**
`checkScaledStock` → `ingredientLineCost`/`classifyUnit` is now WIRED (was NOT WIRED, CR-01).
BrewPad `renderIngredientRows`/totals → client-side unit-aware cost helper is now WIRED (was NOT WIRED, CR-02).

### Behavioral Spot-Checks / Test Suite Re-Run (independently executed, not from SUMMARY.md)

| Check | Command | Result | Status |
|-------|---------|--------|--------|
| Full middleware suite | `cd zoho-middleware && npm test` | 93/93 suites, 1445/1445 tests pass | PASS |
| Full frontend suite | `npm test` | 82/82 suites, 1134/1134 tests pass | PASS |
| Frontend lint | `npm run lint` | clean (0 warnings, `--max-warnings 0`) | PASS |
| Middleware lint | `cd zoho-middleware && npm run lint` | clean (0 warnings, `--max-warnings 0`) | PASS |
| `checkScaledStock` regression (recipe-scaling.test.js) | `npx jest recipe-scaling.test.js -t checkScaledStock` | 13/13 pass | PASS |
| Availability regression (recipes.test.js) | `npx jest recipes.test.js -t availability` | 7/7 pass | PASS |
| BrewPad editor-cost regression | `npx jest tests/frontend/brewpad-recipe-editor-cost.test.js` | 8/8 pass | PASS |
| Confirm-handler reorder regression | `npx jest pos-recipe.test.js -t U4c` | 1/1 pass | PASS |
| All three gap-closure suites together | `npx jest recipe-scaling.test.js recipes.test.js pos-recipe.test.js` | 191/191 pass (0 failed) | PASS |
| Commit provenance | `git log --oneline --all \| grep -E "763c2172\|686757f6\|6389e744\|e1ae3e0b\|08639616\|23d5ece4\|1aa49065"` | all 7 claimed commits found in git log | PASS |

### Anti-Patterns Found

None blocking. Re-grepped all phase-touched files (`recipe-scaling.js`, `routes/recipes.js`,
`routes/pos-recipe.js`, `js/brewpad.js`) for `TBD|FIXME|XXX`. The only hits in `js/brewpad.js` are
pre-existing, unrelated UI strings for batch/task scheduling ("Bottling date TBD", "Packaging
Step... date TBD", `INV-XXXXXX`/`SO-XXXXXX` placeholder-format comments) — none in any code path
touched by 73-06 or 73-07.

### Requirements Coverage (Gap-Closure)

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CR-01 | 73-06 | `checkScaledStock` unit-converts before comparing to `stock_on_hand`, fails closed | SATISFIED | Truths 20, 21, 22 |
| WR-01 | 73-06 | Availability endpoint unit-converts `needed` before `batches_possible` | SATISFIED | Truths 24, 25 |
| (reorder fix) | 73-06 | Confirm-handler void safety net runs before stricter stock gate | SATISFIED | Truth 23 |
| CR-02 | 73-07 | BrewPad editor Cost/Retail + Totals unit-aware, matching server helper | SATISFIED | Truths 26, 27, 29 |
| (catalog_unit fix) | 73-07 | Catalog unit captured distinctly from recipe-line unit | SATISFIED | Truth 28 |
| (build artifact) | 73-07 | `js/brewpad.min.js` regenerated, not hand-edited | SATISFIED | Truth 30 |

Combined with the 11 AC-*/D-* requirements from the initial verification (all still SATISFIED,
confirmed via regression), no orphaned requirements remain for Phase 73.

### Human Verification Required

None. Both previously-escalated human-decision items (CR-01, CR-02 disposition) are resolved —
the owner's decision (open gap-closure plans) was executed, and this re-verification independently
confirms the code now does what the gap-closure plans claim, with passing non-vacuous regression
tests reproducing the exact bug scenarios named in `73-REVIEW.md`.

### Gaps Summary

No gaps remain. Both Critical findings from `73-REVIEW.md` (CR-01, CR-02) and the related Warning
(WR-01) are closed:

- **CR-01/WR-01** (`zoho-middleware/lib/recipe-scaling.js` `checkScaledStock`, `zoho-middleware/routes/recipes.js` availability handler): now route through the existing `ingredientLineCost`/`classifyUnit` helper, fail CLOSED on non-convertible units (explicitly rejecting the review's own suggested raw-quantity-fallback snippet), and a real ordering regression in `pos-recipe.js`'s confirm handler (discovered during 73-06, not pre-existing) was found and fixed in the same plan — the POST-CHARGE void safety net now runs before the now-stricter stock gate, verified by a targeted regression test using a genuinely cross-family fixture.
- **CR-02** (`js/brewpad.js` recipe editor): a new ES5 `bpIngredientLineCost` module-scope mirror of the server helper is wired into all three totals sites (per-row render, quantity-change recompute, ingredient-selection recompute), the root-cause landmine (catalog unit and recipe-line unit collapsing into one field, which would have made the conversion a silent no-op) was identified and fixed by capturing `ing.catalog_unit` as a distinct field, and non-convertible lines render a visible "N/A" indicator excluded from the Totals sum rather than a silently-wrong number.

All fixes were verified by reading the current source directly (not SUMMARY.md prose), confirming
fail-closed behavior with no raw-quantity/no-conversion fallback paths, and independently
re-running both full test suites (93/93 + 82/82 suites, 1445 + 1134 tests, zero failures) and both
lint configs (both clean). No regression was introduced in any of the 19 previously-verified
truths. Phase 73's goal — unit-aware pricing across every cost-sum AND stock-comparison site, plus
a hardened BrewPad editor covering both save resilience and unit-aware price preview — is fully
achieved.

---

*Verified: 2026-08-25T22:10:00Z*
*Verifier: Claude (gsd-verifier)*
