---
phase: 73-recipe-dynamic-pricing-unit-conversion-correctness-unit-awar
plan: 03
subsystem: payments
tags: [zoho-invoice, inventory-deduction, unit-conversion, fail-closed, kiosk, recipe-pricing]

# Dependency graph
requires:
  - phase: 73-01
    provides: "scaling.ingredientLineCost(item, line) / classifyUnit(raw) shared helper (fail-closed via RecipeLineUnitError), lib/recipe-scaling.js"
provides:
  - "pos-recipe.js sale-path lineItems build + GET recipe-quote line_total wired to the shared ingredientLineCost helper — the Zoho invoice line quantity (real stock decrement) and the displayed quote total are both unit-converted"
  - "Tiered D-02 fail-closed: PRE-CHARGE 422 (named line) in computeRecipeQuote, shared by GET recipe-quote and POST recipe-sale (initiate); POST-CHARGE void-on-failure safety net in _runRecipeConfirm's lineItems build"
  - "recipe-scaling.js ingredientLineCost error label now reads the real catalog item name field (item.name) instead of always falling back to item_id"
affects: [pos-recipe, kiosk-recipe-sale, brewpad-batch-snapshot, zoho-inventory-deduction]

tech-stack:
  added: []
  patterns:
    - "Pre-charge fail-closed validation pass (mirrors pos.js resolveGstTaxId): resolve/validate every line in a separate loop BEFORE any charge, never inside a downstream .map()"
    - "Post-charge fail-closed defense-in-depth: if a line still turns out unpriceable after the terminal charge succeeded, void via the existing helcimLib.voidTransaction path + release the sale lock — never a bare 400"

key-files:
  created: []
  modified:
    - zoho-middleware/routes/pos-recipe.js
    - zoho-middleware/lib/recipe-scaling.js
    - zoho-middleware/__tests__/pos-recipe.test.js
    - zoho-middleware/__tests__/pos-money-defects.test.js

key-decisions:
  - "Pre-charge fail-closed check runs for ALL pricing modes (not just dynamic) — LOCKED-mode recipes never sum ingredient costs through ingredientLineCost, so without this pass a bad base-ingredient unit would only ever surface post-charge"
  - "Items absent from the catalog (unknown item_id) are NOT fail-closed — only a UNIT MISMATCH on a recognized catalog item fails closed (T-36-07 precedent: unrecognised items are tolerated/skipped elsewhere in this codebase)"
  - "distributeRecipeDiscount's math is unchanged — it inherits correctness automatically once lineItems carry converted quantities"

patterns-established:
  - "Every aggregate qty*rate sum-site in pos-recipe.js must route through scaling.ingredientLineCost — never hand-roll qty*rate against a catalog entry"

requirements-completed: [AC-01, AC-03, D-02]

# Metrics
duration: 14min
completed: 2026-08-25
---

# Phase 73 Plan 03: Sale/Stock Money-Path Unit Conversion Summary

**Wired `pos-recipe.js`'s invoice `lineItems` build and quote `line_total` to the shared `ingredientLineCost` helper so the Zoho invoice quantity (real stock decrement) and the displayed quote total are both unit-converted and tiered fail-closed (pre-charge 422 / post-charge void).**

## Performance

- **Duration:** 14 min
- **Started:** 2026-08-25T12:40:42-07:00 (base commit)
- **Completed:** 2026-08-25T12:54:28-07:00
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- `_runRecipeConfirm`'s invoice `lineItems.quantity` now equals `ingredientLineCost(...).convertedQty` — a 12g line against a per-kg catalog item now sends `0.012` to Zoho instead of `12`, fixing the real inventory draw-down (this was the money/stock bug: the previously-fixed grand total was already correct, but the invoice line quantity that drives Zoho's stock decrement was not).
- `GET /api/kiosk/recipe-quote`'s per-ingredient `line_total` now reads `ingredientLineCost(...).cost` instead of raw `scaledQty * rate`.
- New PRE-CHARGE fail-closed pass inside `computeRecipeQuote` (shared by both `GET recipe-quote` and `POST recipe-sale` initiate) validates every catalog-matched scaled ingredient line and rejects with `422` naming the line, before any terminal push — runs for all pricing modes, closing the gap where LOCKED-mode recipes never previously exercised the conversion check at all.
- New POST-CHARGE fail-closed safety net inside `_runRecipeConfirm`'s `lineItems` build: if a line is still somehow unpriceable after the charge succeeded, the transaction is voided (existing `helcimLib.voidTransaction` path) and the sale lock released — never a bare 400 that would orphan the charge.
- `distributeRecipeDiscount` verified (via test) to distribute proportionally against the now-correct converted line cost.

## Task Commits

Each task was committed atomically:

1. **Task 1: Regression tests first — quote==sale, converted stock draw-down, discount, void-on-unpriceable + completed fixtures** - `4679e298` (test)
2. **Task 2: Wire sale-path lineItems + quote line_total; tiered fail-closed/void** - `94e52bfe` (feat)

**Plan metadata:** committed separately by the orchestrator after merge (worktree mode — STATE.md/ROADMAP.md not touched by this agent).

_TDD Gate Compliance: RED (`4679e298`, 6 new tests fail for the intended reason) → GREEN (`94e52bfe`, all 73 tests in `pos-recipe.test.js` pass, plus the full 1428-test middleware suite and 1114-test frontend suite green, lint clean). No REFACTOR commit was needed._

## Files Created/Modified
- `zoho-middleware/routes/pos-recipe.js` — `computeRecipeQuote` gains a pre-charge `ingredientLineCost` validation pass (422 fail-closed, named line); `GET recipe-quote` `line_total` now converted; `_runRecipeConfirm` lineItems build now uses `convertedQty` for `li.quantity` and voids post-charge on an unpriceable line
- `zoho-middleware/lib/recipe-scaling.js` — `ingredientLineCost`'s fail-closed error label now checks `item.name` (real catalog field) before `item.item_name`/`item_id`
- `zoho-middleware/__tests__/pos-recipe.test.js` — new `Unit conversion — sale/stock money path (73-03, D-01/D-02)` describe block (6 tests: U1-U4c); `KIOSM_DISCOUNT_PRESETS` added to the mocked constants module
- `zoho-middleware/__tests__/pos-money-defects.test.js` — completed its stale `../lib/recipe-scaling` jest mock (added `ingredientLineCost`) and its one catalog fixture's missing `unit` field, both required for its existing (unrelated) CR-01 tests to keep passing under the new code path

## Decisions Made
- Pre-charge fail-closed validation runs regardless of `pricing_mode`, since LOCKED-mode recipes never sum through `ingredientLineCost` for their grand total — the only place a bad base-ingredient unit could otherwise be caught is post-charge.
- Unknown `item_id` (not in catalog) is explicitly NOT fail-closed by this check — only recognized-but-unit-mismatched items are, per the existing T-36-07 "unrecognised items are tolerated" precedent elsewhere in this file (`computeModifiedRecipeTotal`'s LOCKED branch, `checkScaledStock`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `ingredientLineCost` error label fell back to raw `item_id` instead of the catalog item's name**
- **Found during:** Task 1 (writing the U4a/U4b pre-charge 422 regression tests)
- **Issue:** `recipe-scaling.js`'s fail-closed error message built its label from `item.item_name || item.item_id`, but real Zoho-backed catalog entries (`routes/catalog.js`) carry the display name under `.name`, not `.item_name` (`.item_name` only exists on recipe-ingredient LINE objects). Every fail-closed error against a real catalog item silently showed the raw item_id instead of a human-readable name — violating this plan's own threat-model requirement (T-73-03: "Error names only item name + units").
- **Fix:** Label lookup now checks `item.name` first, falling back to `item.item_name` then `item.item_id` (preserves the existing recipe-scaling.test.js regression that expects an item_id fallback when neither name field is present).
- **Files modified:** `zoho-middleware/lib/recipe-scaling.js`
- **Verification:** New U4a/U4b tests assert `res._body.error` contains the catalog item's display name; full `recipe-scaling.test.js` suite (unaffected) still green.
- **Committed in:** `94e52bfe` (Task 2 commit)

**2. [Rule 3 - Blocking] Stale `recipe-scaling` test double in `pos-money-defects.test.js` didn't expose `ingredientLineCost`**
- **Found during:** Task 2, running the full middleware suite (CLAUDE.md rule 7 — shared utility changed)
- **Issue:** `pos-money-defects.test.js` fully mocks `../lib/recipe-scaling` (predating the D-01/D-02 helper). Once `pos-recipe.js`'s lineItems build started calling `scaling.ingredientLineCost`, this mock threw `TypeError: scaling.ingredientLineCost is not a function` inside a promise chain, which was swallowed by `_runRecipeConfirm`'s outer cache-error catch and surfaced as a misleading generic `503` instead of the real error — breaking 2 pre-existing, unrelated CR-01 tests.
- **Fix:** Added a same-unit pass-through `ingredientLineCost` implementation to the mock (this file's fixtures are all `kg`/`kg`, so `convertedQty = qty`, `cost = qty * rate`) and completed its one catalog fixture with the `unit: 'kg'` field it was missing (matching its ingredient line's unit, and the same fixture-completion pattern 73-01 already applied to `pos-recipe.test.js`'s `MOCK_INGREDIENTS_CATALOG`).
- **Files modified:** `zoho-middleware/__tests__/pos-money-defects.test.js`
- **Verification:** `pos-money-defects.test.js` full suite green (13/13); full middleware suite green (1428/1428).
- **Committed in:** `94e52bfe` (Task 2 commit)

**3. [Rule 3 - Blocking] New conversion-test fixture's tight `stock_on_hand` spuriously tripped the (out-of-scope) raw-unit stock check**
- **Found during:** Task 2, first GREEN run of the new U1-U3 tests
- **Issue:** `checkScaledStock` compares `needed` (the recipe line's scaled quantity, in the LINE's raw unit — e.g. grams) against `stock_on_hand` (in the CATALOG item's unit — e.g. kg) with no conversion. This plan's `stock_on_hand: 5` fixture for a 12g line spuriously read as `12 > 5` and 409'd before the code path under test (the pricing/invoice-quantity fix) was ever reached. Unit-aware stock checking is a separate, out-of-scope gap not covered by this plan's tasks/acceptance criteria.
- **Fix:** Raised the test fixture's `stock_on_hand` to 100 (comfortably above the raw pre-conversion quantity) so the conversion tests exercise only the code path this plan actually changes.
- **Files modified:** `zoho-middleware/__tests__/pos-recipe.test.js`
- **Verification:** U1-U3 tests pass for the intended reason (invoice-quantity/quote-total/discount assertions), not incidentally blocked by an unrelated stock conflict.
- **Committed in:** `94e52bfe` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (1 bug fix, 2 blocking test-infra fixes)
**Impact on plan:** All three were necessary to land the D-01/D-02 fix correctly and keep the existing suite green; none expand scope beyond this plan's stated sum-sites. The `checkScaledStock` raw-unit gap (deviation 3's root cause) is flagged here for future-phase awareness but intentionally NOT fixed — it is outside this plan's `<files_modified>` and acceptance criteria.

## Issues Encountered
None beyond the deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The sale-path money/stock bug (invoice quantity = raw, not converted) is closed; quote display, sale total, and the real Zoho stock decrement now agree for unit-converted lines.
- **Flagged for a future phase (not this plan's scope):** `checkScaledStock` (in `lib/recipe-scaling.js`, shared by both the quote-time and confirm-time stock gates) compares `needed` vs `stock_on_hand` without unit conversion — a recipe line in grams against a per-kg catalog item's `stock_on_hand` can under- or over-report stock conflicts. This is a display/gating concern, not a money-path correctness bug (the gate can be bypassed with `override: true` if it ever produces a false conflict), but should be swept into a future D-01/D-02-adjacent cleanup.

---
*Phase: 73-recipe-dynamic-pricing-unit-conversion-correctness-unit-awar*
*Completed: 2026-08-25*

## Self-Check: PASSED

- FOUND: zoho-middleware/routes/pos-recipe.js
- FOUND: zoho-middleware/lib/recipe-scaling.js
- FOUND: zoho-middleware/__tests__/pos-recipe.test.js
- FOUND: zoho-middleware/__tests__/pos-money-defects.test.js
- FOUND: .planning/phases/73-recipe-dynamic-pricing-unit-conversion-correctness-unit-awar/73-03-SUMMARY.md
- FOUND commit: 4679e298 (test — RED)
- FOUND commit: 94e52bfe (feat — GREEN)
