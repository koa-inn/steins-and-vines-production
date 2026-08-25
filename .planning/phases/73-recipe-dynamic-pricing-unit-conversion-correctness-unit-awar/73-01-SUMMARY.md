---
phase: 73-recipe-dynamic-pricing-unit-conversion-correctness-unit-awar
plan: 01
subsystem: api
tags: [recipe-pricing, unit-conversion, zoho, jest]

requires: []
provides:
  - "ingredientLineCost(item, line) + classifyUnit(raw) pure unit-conversion helpers in lib/recipe-scaling.js"
  - "computeScaledRecipeTotal / computeModifiedRecipeTotal wired to the shared helper (fail-closed on non-convertible units)"
affects: [73-02, 73-03, 73-04, 73-05, "pos-recipe.js sale/quote paths", "recipes.js read-path enrichment"]

tech-stack:
  added: []
  patterns:
    - "Discriminated-result pure helper (ok:true/false) mirroring resolveGstTaxId fail-closed precedent (pos.js)"
    - "Typed thrown Error (RecipeLineUnitError) for aggregate-sum fail-closed propagation, callers translate to HTTP in later plans"

key-files:
  created: []
  modified:
    - zoho-middleware/lib/recipe-scaling.js
    - zoho-middleware/__tests__/recipe-scaling.test.js

key-decisions:
  - "D-06 imperial scope: live audit of all 8 recipes (91 ingredient lines) found only kg/g/L/pcs on cost lines, zero imperial units — helper ships mass/volume/count families only; imperial fails closed (named-line error), no imperial factors added"

patterns-established:
  - "ingredientLineCost/classifyUnit: pure, no-I/O helper — callers pass in item/line, rate read only from item.rate (T-36-01)"

requirements-completed: [AC-01, D-06]

duration: 15min
completed: 2026-08-25
---

# Phase 73 Plan 01: Unit-Aware Ingredient Cost Helper Summary

**Added `ingredientLineCost`/`classifyUnit` pure helpers to `lib/recipe-scaling.js` and wired both in-file aggregate sum-sites to them, closing the ~1000x unit-mismatch overcharge bug at its foundation.**

## Task 1: D-06 Imperial-Scope Audit (from live data)

**Method:** Queried the deployed middleware directly (`https://svmiddleware-production.up.railway.app`) — `GET /api/recipes` (all 8 recipes, read-only, no data modified) followed by `GET /api/recipes/:id` for each of `SV-R-000001` through `SV-R-000008`.

**Distinct cost-line units observed across all 91 ingredient lines (8 recipes):**

| Unit | Line count | Example items |
|------|-----------|----------------|
| `kg`  | 48 | Gambrinus Pale Malt, Weyermann Floor-Malted Bohemian Pilsner |
| `g`   | 21 | Magnum Bulk, GR Hallertau Mittelfruh Bulk, Calcium Chloride (Bulk) |
| `L`   | 13 | Lactic Acid 88%, Whirlfloc Tablets (25 pack) |
| `pcs` | 9  | Irish moss 1 oz (unit is `pcs`, not `oz` — the imperial token is only in the item *name*), Fermentis SafAle S-04/SafLager W-34/70 |

**Zero recipe-line units are imperial** (no `oz`/`lb`/`tsp`/`tbsp`/`cup`/`pt`/`qt`/`gal`/`floz` token appears in any `ingredient.unit` field). The one apparent imperial signal — "Irish moss **1 oz**" — is the item's display name; its actual `unit` field is `pcs` (a packet), which needs no conversion.

**D-06 decision:** Per the decision rule ("if NO live recipe uses an imperial unit on a cost line, ship the helper with only mass/volume/count families — imperial then fails closed"), Task 2's conversion table includes **only mass (`g`↔`kg`) and volume (`ml`↔`L`) plus count pass-through**. No imperial→metric factors were added. An imperial recipe-line unit (should one ever be entered) will fail closed with the named-line error, matching D-02's fail-closed spirit — this is documented as intentional, not a gap.

**Read-only confirmation (D-04):** all requests were `GET`; no recipe data was created, updated, or deleted during the audit.

## Performance

- **Duration:** ~15 min
- **Started:** 2026-08-25T19:24:00Z
- **Completed:** 2026-08-25T19:38:29Z
- **Tasks:** 3
- **Files modified:** 3 (`zoho-middleware/lib/recipe-scaling.js`, `zoho-middleware/__tests__/recipe-scaling.test.js`, `zoho-middleware/__tests__/pos-recipe.test.js` — deviation, see below)

## Accomplishments
- Added `classifyUnit(raw)` / `ingredientLineCost(item, line)` pure helpers to `lib/recipe-scaling.js` — mass (kg/g), volume (l/ml), count (pcs/ea/each/unit/pkg/pack) families; fails closed (named-item + both-units error) on cross-family or unrecognised (incl. imperial) units, per D-01/D-02
- Wired both in-file aggregate sum-sites — `computeScaledRecipeTotal`'s dynamic-mode sum and `computeModifiedRecipeTotal`'s LOCKED-mode added-ingredient sub-sum — to the shared helper, replacing the un-converted `qty * rate` multiply that caused the ~1000x Magnum Bulk overcharge (12g charged as 12kg)
- Fail-closed propagation via a typed `RecipeLineUnitError` throw (never NaN/0/silent mispricing) — callers in later Phase 73 plans translate this into the appropriate HTTP response
- Resolved D-06 (imperial scope) from live production data rather than guessing: queried all 8 recipes / 91 ingredient lines, found zero imperial units on any cost line — imperial correctly fails closed with no conversion factors added

## Task Commits

Each task was committed atomically:

1. **Task 1: D-06 imperial-scope audit** — `80474953` (docs) — recorded the live unit audit + decision in this SUMMARY.md
2. **Task 2: ingredientLineCost + classifyUnit helper (TDD)** — `989d23ce` (test, RED) → `aac5d0b0` (feat, GREEN)
3. **Task 3: wire sum-sites + complete fixtures (TDD)** — `ad782c2e` (test, RED) → `eec301fe` (feat, GREEN) → `e195c528` (fix — deviation, see below)

**Plan metadata:** commit follows this SUMMARY (docs: complete plan)

_TDD tasks have multiple commits (test → feat); Task 3 has a third fix commit for an out-of-plan-scope fixture gap directly caused by the Task 3 wiring change._

## Files Created/Modified
- `zoho-middleware/lib/recipe-scaling.js` — added `classifyUnit`/`ingredientLineCost`; wired `computeScaledRecipeTotal` (dynamic-mode sum) and `computeModifiedRecipeTotal` (LOCKED-mode added-ingredient sub-sum) to the helper, throwing `RecipeLineUnitError` on non-convertible units
- `zoho-middleware/__tests__/recipe-scaling.test.js` — new `classifyUnit`/`ingredientLineCost` describe blocks (15 tests); completed 4 catalogMap fixtures missing `unit`; added g-vs-kg conversion + cross-family throw regression tests for both sum-sites
- `zoho-middleware/__tests__/pos-recipe.test.js` — completed `MOCK_INGREDIENTS_CATALOG` (4 entries) and the SCALE-05 `INGREDIENTS_ALL_CATALOG` (gypsum item) with matching `unit` fields (deviation, see below)

## Decisions Made
- **D-06 (imperial unit scope):** Ship the conversion table with mass/volume/count families only. Live audit of all 8 recipes (91 ingredient lines) via the deployed middleware found zero imperial units (`oz`/`lb`/`tsp`/etc.) on any recipe cost line — the one apparent imperial signal ("Irish moss 1 oz") is the item's display *name*, not its `unit` field (which is `pcs`). Imperial fails closed with the named-line error, matching D-02's fail-closed spirit, rather than guessing conversion factors for a case that doesn't exist in production data.
- **Conversion factor design:** `convertedQty = qty * (lineFactor / itemFactor)` where factors are "canonical units per raw unit" (kg=1/g=0.001, l=1/ml=0.001) — a general ratio approach rather than hardcoded per-pair conversions, so adding a future unit to a family only requires one factor entry.
- **4dp intermediate rounding on `ingredientLineCost`'s `cost`/`convertedQty`:** avoids double-rounding/float-drift (e.g. `4.1*54` = `221.39999999999998` in raw JS) before each call site's final 2dp `Math.round(total*100)/100` aggregate rounding.
- **Separate conversion table, not reused `DISCRETE_UNITS`:** per PATTERNS.md's explicit warning, `DISCRETE_UNITS` governs scale-ROUNDING (a different axis) and includes `'ft'` (a length unit, not a cost-count unit) — `classifyUnit` uses its own `MASS_FACTORS`/`VOLUME_FACTORS`/`COUNT_UNITS`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Completed `pos-recipe.test.js` catalog fixtures missing `unit` field**
- **Found during:** Task 3 (full middleware suite run after wiring `computeScaledRecipeTotal`/`computeModifiedRecipeTotal` to fail closed)
- **Issue:** `pos-recipe.test.js`'s `MOCK_INGREDIENTS_CATALOG` (4 entries) and the SCALE-05 regression's `INGREDIENTS_ALL_CATALOG` (gypsum item) never carried a `unit` field, even though their paired recipe-ingredient fixtures in the same file already did (`unit: 'kg'`/`'pcs'`). Once the sum-sites started calling `ingredientLineCost` and failing closed on a missing/unclassifiable unit, 17 previously-passing route tests in this file began failing for a fixture-completeness reason, not a real regression — the exact "Pitfall 2" fixture-gap pattern PATTERNS.md flagged for `recipe-scaling.test.js`, just in a sibling test file this plan's `files_modified` didn't list.
- **Fix:** Added `unit: 'kg'` (ing-malt-1, ing-hops-1, ing-dry-hop-1, gypsum) / `unit: 'pcs'` (ing-yeast-1) to each catalog fixture, matching the unit already used by that item's paired recipe-line fixture elsewhere in the same file. No cross-family case existed among these fixtures, so this is same-unit pass-through completion, not a new conversion behavior.
- **Files modified:** `zoho-middleware/__tests__/pos-recipe.test.js`
- **Verification:** `cd zoho-middleware && npm test` — 93/93 suites, 1422/1422 tests pass (was 92/93, 1407/1422 before the fix); lint clean
- **Committed in:** `e195c528`

**2. [Rule 3 - Blocking] Restored `node_modules` in the worktree via `npm ci` (both `zoho-middleware/` and repo root)**
- **Found during:** Task 3 (attempting `cd zoho-middleware && npm test`)
- **Issue:** Neither the worktree's `zoho-middleware/node_modules` nor its root `node_modules` existed (the worktree was checked out fresh without a dependency install), so `npm test` failed to resolve `express`/`axios`/`@sentry/node`/etc. in ~80 test suites — a pre-existing environment gap, not caused by this plan's code changes, but blocking the CLAUDE.md-mandated full-suite verification.
- **Fix:** Ran `npm ci` in both `zoho-middleware/` and the repo root. This is NOT a new/unverified package install (excluded from Rule 3 auto-fix) — it materializes the exact dependency tree already pinned in the committed `package-lock.json` files, introducing no new package names.
- **Files modified:** none (node_modules is gitignored, not committed)
- **Verification:** `cd zoho-middleware && npm test` — 93/93 suites pass; root `npm test` — 80/80 suites, 1114/1114 tests pass
- **Committed in:** n/a (gitignored, no commit)

---

**Total deviations:** 2 auto-fixed (1 bug/fixture-gap, 1 blocking/environment)
**Impact on plan:** Both necessary to satisfy CLAUDE.md's "never commit with failing tests" / "run the full test suite for shared-utility changes" rules. No scope creep beyond what the Task 3 wiring change itself required to stay green; no plan behavior changed.

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness
- `ingredientLineCost`/`classifyUnit` are exported from `lib/recipe-scaling.js` and ready for the remaining sum-sites (plans 73-02..73-05 per the phase plan: `routes/recipes.js` read-path enrichment, `routes/pos-recipe.js` quote/confirm invoice-line build, D-03 save-time validation)
- `RecipeLineUnitError` (name-discriminated thrown Error) is the propagation contract downstream plans must catch and translate to an HTTP response — not yet wired at any route level (out of this plan's scope by design)
- Full middleware (93/93 suites, 1422/1422 tests) and frontend (80/80 suites, 1114/1114 tests) suites green; lint clean on both
- No blockers for the next wave

## Self-Check: PASSED

All created/modified files exist on disk; all 6 task commit hashes (`80474953`, `989d23ce`, `aac5d0b0`, `ad782c2e`, `eec301fe`, `e195c528`) verified present in `git log --oneline --all`. No missing items.
