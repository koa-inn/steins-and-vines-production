---
phase: 48-kiosk-pos-de-fork-kiosk-core-js
plan: 02
subsystem: frontend-kiosk
tags: [es5, iife, jest, kiosk, de-fork, discount, cart, totals]

# Dependency graph
requires: ["48-01"]
provides:
  - "js/kiosk-core.js populated with cart/catalog/recipe-render/totals + the full 12-function product-type discount subsystem (D-01/D-02/D-04/D-06)"
  - "Extended KioskCore.init(env) seam: auth (mwUrl/buildAuthOptions) PLUS bridged get/set callbacks for the state subset shared with js/kiosk.js's not-yet-migrated payment path"
  - "js/kiosk.js slimmed to consumer wiring for the migrated surface — local aliases + bottom test-export delegation to KioskCore"
affects: [48-03, 48-04, 48-05, 48-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Local function-name aliasing (`var kioskCalcTotals = KioskCore.calcTotals;`) so every existing kiosk.js call site/event-listener keeps working unchanged while genuinely consuming the shared KioskCore implementation"
    - "Env-bridge pattern for state shared with not-yet-migrated code: KioskCore.init(env) accepts get/set callbacks (getCart/setCart, getDiscount/setDiscount, getGiftCard/setGiftCard, getCustomer/setCustomer, getRecipeContext/setRecipeContext, getModifiedIngredients/setModifiedIngredients, getImportedSoId/getImportedSoNumber) plus behavior hooks (proceedToPayment, startCheckout, showCustomItemModal, showGiftCardIssueModal, clearImportedSo) so moved functions can reach state/behavior that still physically lives in kiosk.js without editing the deferred payment path"
    - "_kcMergeAuth(opts) helper in kiosk-core.js shallow-merges _kcEnv.buildAuthOptions() into every outgoing fetch call — single seam for the x-device-token vs credentials:'include' difference"

key-files:
  created: []
  modified:
    - js/kiosk-core.js
    - js/kiosk.js
    - js/kiosk-core.min.js (build artifact)
    - js/kiosk.min.js (build artifact)
    - kiosk.html (cache-bust stamp only)

key-decisions:
  - "D-DEV-01: KioskCore.init(env)'s scope widened beyond pure auth-injection (D-02's literal 'environment only, never behaviour') to include a bridge for cart/discount/gift-card/customer/recipe-context/modified-ingredients/imported-SO state. Necessary because js/kiosk.js's kioskProceedToPayment/kioskShowReceipt/kioskCheckTerminal/the SO-checkout fork (explicitly deferred to 48-03 in the plan's own interfaces list) read/write this exact state directly, and touching those functions now was out of scope and high-risk (money path). The bridge is documented as an intentional interim shape: 48-03 will internalize it once the payment path itself moves into kiosk-core.js."
  - "D-DEV-02: kioskFetchRecipeQuote/kioskScheduleRecipeQuote/kioskLoadIngredientCatalog/renderKioskModifyRows/attachKioskModifyRowListeners/kioskShowIngredientAutocomplete/kioskHideIngredientAutocomplete moved in Task 1 despite being listed 'DEFER to plan 03' in the plan's interfaces section — kioskShowRecipePrompt (explicitly Task 1) has a hard, unqualified call dependency on them; deferring would have left Task 1 non-functional. kioskCheckTerminal/kioskSetTerminalStatus/kioskStartCheckout/kioskProceedToPayment/kioskShowReceipt (the true payment/terminal functions) remain correctly deferred."
  - "D-DEV-03: kioskShowCustomItemModal/kioskSubmitCustomItem/kioskShowGiftCardIssueModal/kioskSubmitGiftCardIssue/kioskClearImportedSo kept in js/kiosk.js (not moved) — they write to the still-kiosk.js-owned _kioskCart/_kioskCustomCounter/_kioskGiftCertCounter/_kioskImportedSo* and call kioskMwUrl/kioskDeviceToken directly; moving them would have required either duplicating the auth seam unnecessarily or expanding the env bridge further for no behavioral benefit. kioskRenderCart (moved) reaches them via three new env hooks (showCustomItemModal/showGiftCardIssueModal/clearImportedSo)."
  - "D-DEV-04: kioskUpdateDiscountDisplay + kioskCalcDiscountAmount moved in Task 1 (not Task 2) because kioskCalcTotals/kioskRenderCart/kioskClearCart (Task 1) call kioskUpdateDiscountDisplay directly and cross-closure calls are impossible once those functions are in kiosk-core.js. Task 2's acceptance criteria are unaffected (checked cumulatively — both functions end up in kiosk-core.js absent from kiosk.js either way)."

requirements-completed: [KIOSK-01]

# Metrics
duration: ~50min
completed: 2026-07-04
---

# Phase 48 Plan 02: Cart/Catalog/Totals + Discount Subsystem → kiosk-core.js Summary

**Moved ~60 functions (cart building, product/recipe catalog rendering, `kioskCalcTotals` incl. its discount branch, and the full 12-function product-type discount subsystem) plus their private module state verbatim from `js/kiosk.js` into `js/kiosk-core.js` behind the `KioskCore` namespace, extending the `KioskCore.init(env)` seam with a bridge for the handful of state/behavior still owned by `js/kiosk.js`'s not-yet-migrated payment path.**

## Performance

- **Duration:** ~50 min
- **Completed:** 2026-07-04
- **Tasks:** 2 completed
- **Files modified:** 5 (2 source + 2 build artifacts + 1 HTML cache-bust), across 2 commits

## Accomplishments

- `js/kiosk-core.js` grew from the 48-01 skeleton (58 lines, no logic) to 2726 lines: all cart/catalog/recipe-render/totals functions, their transitive helpers (item-type classification, kit-fee sync, recipe-quote fetch, ingredient-modify-panel), and the complete 12-function discount subsystem, all behind `KioskCore.*` with D-06 de-prefixed names.
- `js/kiosk.js` shrank from 5544 to 3156 lines (43%): every moved function definition removed, replaced by a single block of local aliases (`var kioskCalcTotals = KioskCore.calcTotals;`, etc.) so every existing call site and DOM event listener keeps working unchanged while genuinely consuming the shared `kiosk-core.js` implementation.
- `KioskCore.init(env)` extended beyond the original auth-only skeleton seam with: (a) `_kcMergeAuth(opts)` — a single fetch-options-merging helper every core fetch call now routes through; (b) bridged get/set callbacks for `_kioskCart`/`_kioskDiscount`/`_kioskGiftCard`/`_kioskCustomer`/`_kioskRecipeContext`/`_kioskModifiedIngredients`/imported-SO-id/number, since these remain physically owned by `js/kiosk.js` (read directly by the deferred payment path); (c) five behavior hooks (`proceedToPayment`, `startCheckout`, `showCustomItemModal`, `showGiftCardIssueModal`, `clearImportedSo`) so moved functions (`kioskShowCustomerStep`, `kioskShowError`, `kioskRenderCart`) can invoke not-yet-migrated kiosk.js functions without kiosk-core.js reaching into kiosk.js's closure directly.
- All other module-scope kiosk state not touched by the deferred payment path (recipe browse/selection, quote, product filters, view mode, ingredient-modify-panel state, discount presets) relocated fully into `kiosk-core.js`'s private closure, with real accessors (`_getFilters`, `_setSelectedRecipe`, `_setProductsLoaded`, etc.) exposed only where `js/kiosk.js`'s remaining bootstrap wiring and one SO-creation helper (`kioskShowCreateSo`) still need them.
- Bottom-of-file `module.exports` test-export block in `js/kiosk.js` rewritten so every accessor (`_kioskGetCart`, `_kioskSetSelectedRecipe`, `_kioskGetModifiedIngredients`, etc.) delegates through `KioskCore`, with EXACT property names preserved — zero test file changes.
- `escapeHTML`/`showToast`/`removeToast`/the fee constants (`MAKERS_FEE`, etc.) duplicated into `kiosk-core.js` as its own standalone-bundle copies, matching the existing project convention (kiosk.js already carries its own `escapeHTML` copy rather than relying on `js/lib/utils.js`'s global).

## Task Commits

Each task was committed atomically:

1. **Task 1: Move cart/catalog/render/totals + module state + init/auth seam into kiosk-core.js; wire kiosk.js** - `5c43dd0` (feat)
2. **Task 2: Move the 12 discount functions + transitive helpers into kiosk-core.js; wire kiosk.js discount UI** - `c1eec17` (feat)

## Files Created/Modified

- `js/kiosk-core.js` — populated from the 48-01 skeleton with ~60 moved functions, ~35 relocated module-scope state vars, the extended `_kcEnv`/`kcInit`/`_kcMergeAuth` seam, and the `KioskCore` namespace object (D-06 de-prefixed method names + underscore-prefixed test-accessor names)
- `js/kiosk.js` — moved function definitions deleted; `KioskCore.init(...)` call + ~65-line local alias block added near the top of the IIFE; bootstrap wiring (`initKioskSaleTab`) and one SO-creation helper (`kioskShowCreateSo`) updated to read/write relocated state via `KioskCore._get*/_set*` accessors instead of bare module vars; bottom test-export block rewritten to delegate
- `js/kiosk-core.min.js`, `js/kiosk.min.js` — regenerated by `npm run build`
- `kiosk.html` — `kiosk-core.min.js`/`kiosk.min.js` cache-bust `?v=` bumped by the build's `stamp:kiosk` step

## Decisions Made

See `key-decisions` in frontmatter (D-DEV-01 through D-DEV-04) — all four are necessary consequences of keeping the explicitly-deferred payment path (`kioskProceedToPayment`, `kioskShowReceipt`, terminal functions, the SO-checkout fork) completely untouched in this plan, while still making the Task-1/Task-2 functions that have hard call/state dependencies on pieces of that path actually work. Each is a bridging mechanism designed to collapse cleanly once 48-03 migrates the payment path itself into `kiosk-core.js`.

## Deviations from Plan

### Auto-fixed / Necessary Scope Adjustments

**1. [Rule 3 - Blocking] `KioskCore.init(env)` scope widened beyond pure auth-injection (D-DEV-01)**
- **Found during:** Task 1, while tracing exactly which module-scope vars the Task-1 function list (`kioskCalcTotals`, `kioskRenderCart`, `kioskClearCart`, `kioskShowCustomerStep`, etc.) actually reference.
- **Issue:** `_kioskCart`, `_kioskDiscount`, `_kioskGiftCard`, `_kioskCustomer`, `_kioskRecipeContext`, `_kioskModifiedIngredients`, and the imported-SO tracking vars are read/written BOTH by the functions moving in this plan AND by `kioskProceedToPayment`/`kioskShowReceipt`/the SO-checkout fork — which the plan's own interfaces section explicitly defers to 48-03. Physically relocating that state into `kiosk-core.js`'s closure (as the plan's literal "expose read/write accessors... both consumers read/write via accessors" instruction implies) would have required editing the deferred, money-path-adjacent functions to use accessors too — directly contradicting the plan's own scope boundary and materially increasing risk to code this project's CLAUDE.md/threat model treat as highest-sensitivity.
- **Fix:** That specific state subset stays physically declared in `js/kiosk.js`, completely unedited. `KioskCore.init(env)` was extended to accept get/set callbacks for it, so `kiosk-core.js`'s moved functions reach it via `_kcEnv.getCart()`/`_kcEnv.setDiscount(v)`/etc. The bottom test-export accessors still delegate through `KioskCore` (round-tripping through the bridge), satisfying the "delegates to KioskCore" must-have even though physical storage hasn't moved yet for this subset.
- **Files modified:** `js/kiosk-core.js`, `js/kiosk.js`
- **Verification:** `npm test` (53/947 kiosk-relevant + full suite green), manual trace confirming `kioskProceedToPayment`/`kioskShowReceipt`/SO functions have ZERO diff in this plan.
- **Committed in:** `5c43dd0`

**2. [Rule 3 - Blocking] Recipe-quote/modify-panel functions moved in Task 1 despite being listed "DEFER to plan 03" (D-DEV-02)**
- **Found during:** Task 1, tracing `kioskShowRecipePrompt`'s (explicitly Task 1) call graph.
- **Issue:** `kioskShowRecipePrompt` calls `kioskScheduleRecipeQuote` → `kioskFetchRecipeQuote` unqualified; these are listed in the plan's own interfaces section under "DEFER to plan 03, payment path" alongside `kioskCheckTerminal`/`kioskProceedToPayment`. Since core functions can't reach back into kiosk.js's closure for a bare function call, leaving these undefined in core would break `kioskShowRecipePrompt` immediately.
- **Fix:** Moved `kioskFetchRecipeQuote`, `kioskScheduleRecipeQuote`, `kioskLoadIngredientCatalog`, `renderKioskModifyRows`, `attachKioskModifyRowListeners`, `kioskShowIngredientAutocomplete`, `kioskHideIngredientAutocomplete` into Task 1 as required transitive dependencies. The true terminal/payment functions (`kioskCheckTerminal`, `kioskSetTerminalStatus`, `kioskStartCheckout`, `kioskProceedToPayment`, `kioskShowReceipt`) remain correctly deferred and untouched.
- **Files modified:** `js/kiosk-core.js`, `js/kiosk.js`
- **Verification:** `npm test` green; `kioskShowRecipePrompt`'s full call graph resolves entirely within `kiosk-core.js`.
- **Committed in:** `5c43dd0`

**3. [Rule 4-adjacent, documented not asked] Custom-item/gift-card-issue modals + `kioskClearImportedSo` kept in kiosk.js, reached via new env hooks (D-DEV-03)**
- **Found during:** Task 1, tracing `kioskRenderCart`'s (Task 1) button-wiring calls.
- **Issue:** `kioskRenderCart` wires "Add custom item"/"Issue Gift Card" buttons to `kioskShowCustomItemModal`/`kioskShowGiftCardIssueModal`, and an SO-detach button to `kioskClearImportedSo` — all three write to state that D-DEV-01 keeps in kiosk.js, and the modals also call `kioskMwUrl()`/`kioskDeviceToken()` directly.
- **Fix:** Rather than moving these substantial (~340-line) UI functions and converting their auth calls, added three behavior hooks (`showCustomItemModal`, `showGiftCardIssueModal`, `clearImportedSo`) to `_kcEnv`/`KioskCore.init`; `kioskRenderCart` (moved) calls `_kcEnv.showCustomItemModal()` etc. instead of the bare function name. Lower risk, smaller diff, avoids duplicating the auth seam for functions this plan doesn't otherwise touch.
- **Files modified:** `js/kiosk-core.js`, `js/kiosk.js`
- **Verification:** `npm test` green.
- **Committed in:** `5c43dd0`

**4. [Rule 3 - Blocking] `kioskUpdateDiscountDisplay`/`kioskCalcDiscountAmount` moved in Task 1, not Task 2 (D-DEV-04)**
- **Found during:** Task 1, tracing `kioskRenderCart`/`kioskClearCart`'s direct calls.
- **Issue:** Both Task-1 functions call `kioskUpdateDiscountDisplay()` directly; once `kioskRenderCart`/`kioskClearCart` move to core, that call must resolve within core's own closure.
- **Fix:** Moved `kioskUpdateDiscountDisplay` + its own `kioskCalcDiscountAmount` dependency into Task 1's commit. Task 2's acceptance criteria (grep-based, checked cumulatively) are unaffected — both functions are absent from `kiosk.js` and present in `kiosk-core.js` regardless of which commit introduced them.
- **Files modified:** `js/kiosk-core.js`, `js/kiosk.js`
- **Verification:** Task 2's own acceptance-criteria greps re-run after Task 2 and confirmed passing.
- **Committed in:** `5c43dd0` (function move), `c1eec17` (remaining 10 discount functions)

**5. [Rule 3 - Blocking, environment-only, matches 48-01 precedent] Symlinked `zoho-middleware/node_modules`**
- **Found during:** Pre-commit middleware test run (CLAUDE.md rule 1).
- **Issue:** This worktree has no `zoho-middleware/node_modules` (same pre-existing environment gap 48-01 documented).
- **Fix:** Symlinked to the main repo's already-installed `zoho-middleware/node_modules` — no packages installed, purely linking.
- **Files modified:** None tracked (gitignored, untracked, never staged).
- **Verification:** `cd zoho-middleware && npm test` → 77 suites / 1250 tests passed, unmodified from the 48-01 baseline.
- **Committed in:** N/A (local worktree convenience only).

**6. [Rule 3 - Blocking, matches 48-01 precedent] Reverted unrelated cache-bust stamps from `npm run build`**
- **Found during:** Both tasks, after running `npm run build`.
- **Issue:** `npm run build` also runs `stamp`/`stamp:admin`/`stamp:brewpad`/`stamp:index`/`stamp:pages`, bumping cache-bust `?v=` on 16+ unrelated pages plus `admin.html`/`js/admin.js`'s `BUILD_TIMESTAMP` — none in this plan's `files_modified` scope.
- **Fix:** `git checkout --` on each unrelated file after every build, keeping only `js/kiosk-core.js`, `js/kiosk.js`, their `.min.js`, and `kiosk.html` staged.
- **Files modified:** Reverted (not committed) both times: `about.html`, `admin.html`, `brewpad.html`, `contact.html`, `custom-labels.html`, `index.html`, `ingredients.html`, `js/admin.js`, `js/admin.min.js`, `products.html`, `products/*.html` (8 files), `reservation.html`.
- **Verification:** `git status --short` after each revert showed only the 5 plan-scoped files staged.
- **Committed in:** N/A (explicitly reverted, not committed).

---

**Total deviations:** 6 (4 architectural/scope-boundary adjustments necessary to keep the deferred payment path untouched, documented above as D-DEV-01..04; 2 auto-fixed environment/build-noise containment matching 48-01's precedent exactly).
**Impact on plan:** No functional scope creep. The core intent — cart/catalog/totals/discount logic single-sourced in `kiosk-core.js`, behavior-preserving, existing tests green — is fully met. The `KioskCore.init(env)` seam is wider than the plan's original "auth only" description, but is explicitly designed as an interim bridge that 48-03 (payment-path migration) will collapse: once `kioskProceedToPayment`/`kioskShowReceipt`/the SO-checkout fork move into `kiosk-core.js`, the bridged get/set callbacks become simple internal closure-var reads and the five behavior hooks become direct in-closure calls — no further redesign needed.

## Issues Encountered

None beyond the deviations documented above. The scope of "which functions/state must move together" turned out to be considerably larger than the plan's literal interface list (which named ~28 Task-1 functions and 12 Task-2 functions) once transitive call/state dependencies were traced exhaustively — this is expected for a first-pass extraction of a ~100-function, deeply cross-referential file, and is the reason 48-03/48-04 exist as separate plans rather than attempting the full de-fork in one pass.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `js/kiosk-core.js` now holds the full non-payment surface (cart, catalog, recipe browse/quote/modify, totals, discount) behind `KioskCore.*`, verified behavior-identical via the full existing Jest suite (947 tests, unmodified) and lint-clean ES5.
- The `KioskCore.init(env)` bridge (get/set callbacks + behavior hooks) is the concrete seam 48-03 (payment/checkout/dual-cart migration) will consume when it moves `kioskProceedToPayment`/`kioskShowReceipt`/`kioskCheckTerminal`/`kioskSetTerminalStatus`/`kioskStartCheckout`/the SO-checkout fork into `kiosk-core.js` — at that point the bridged state (`_kioskCart`, `_kioskDiscount`, `_kioskGiftCard`, `_kioskCustomer`, `_kioskRecipeContext`, `_kioskModifiedIngredients`, imported-SO tracking) can be relocated into `kiosk-core.js`'s private closure outright, and the five behavior hooks (`proceedToPayment`, `startCheckout`, `showCustomItemModal`, `showGiftCardIssueModal`, `clearImportedSo`) can become direct in-closure function calls.
- `js/kiosk.js`'s remaining surface (device-token auth, customer-browse `kioskCb*`, SO/collect-payment functions, the custom-item/gift-card-issue modals, and the full payment path) is exactly what 48-03/48-04 need to work with next.
- No blockers identified for 48-03.

---
*Phase: 48-kiosk-pos-de-fork-kiosk-core-js*
*Completed: 2026-07-04*

## Self-Check: PASSED

- FOUND: js/kiosk-core.js
- FOUND: js/kiosk.js
- FOUND: js/kiosk-core.min.js
- FOUND: js/kiosk.min.js
- FOUND: commit 5c43dd0 (Task 1)
- FOUND: commit c1eec17 (Task 2)
- FOUND: KioskCore.init( in js/kiosk.js (1 occurrence)
- FOUND: kioskCalcTotals absent from js/kiosk.js, present in js/kiosk-core.js
- FOUND: kioskApplyDiscount/kioskCalcDiscountAmount/kioskGetItemType absent from js/kiosk.js
- FOUND: full frontend suite green (53/947 tests), middleware suite green (77/1250 tests, unmodified)
- FOUND: lint clean (eslint js/ --max-warnings 0)
- FOUND: no test file changes (git diff --stat -- tests/ empty across both commits)
