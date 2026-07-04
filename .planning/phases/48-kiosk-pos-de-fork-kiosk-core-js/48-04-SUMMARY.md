---
phase: 48-kiosk-pos-de-fork-kiosk-core-js
plan: 04
subsystem: frontend-kiosk
tags: [es5, iife, jest, kiosk, admin, de-fork, discount, money-path, manager-override]

# Dependency graph
requires: ["48-01", "48-02", "48-03"]
provides:
  - "js/admin.js consumes KioskCore for the full cart/catalog/totals/discount/payment/checkout/terminal/confirm/receipt path (SC#1 — admin is no longer a second copy of the money path)"
  - "Admin-embedded kiosk has product-type discount parity with the standalone kiosk (SC#3) — kiosk-discount-zone/popover/mgmt-modal markup ported into admin.html #tab-kiosk"
  - "Two admin-only money/cart drift bugs fixed as explicit, verified outcomes of the migration (D-05): no client-side create_batch loop (Pitfall 2), recipe-sale charge forwards modified_ingredients via the shared core builder (Pitfall 3); idempotency key unifies on reference_number (no Math.random() suffix)"
  - "Manager Override (D-07) survives the deletion of admin's local override handler — routed entirely through KioskCore's ported handler (from 48-03), admin.html's pre-existing #kiosk-stock-override-btn markup unchanged"
affects: [48-05, 48-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Admin's recipe-browse prompt / ingredient-modify panel / quick-edit / save-as-new stay ADMIN-ONLY (not migrated to KioskCore) because they integrate with the Recipes tab's own _recipesState ingredient catalog + autocomplete (GAP-1, 36-09) and the testability extraction of kioskOpenModifyPanel — migrating them would have broken the GAP-1 regression test (admin._recipesState.catalogLoaded) and required rewiring admin's quick-edit/save-as-new UI onto a completely different catalog source. These kept-local functions reach the now-relocated recipe/quote/sale-type/target-volume/mill-grain/availability/stock-override state via KioskCore's own accessors (KioskCore._getSelectedRecipe()/_setSaleType()/_setStockOverride()/etc.) instead of bare local vars, exactly mirroring how js/kiosk.js's own bootstrap wiring reaches core state."
    - "Env bridge mirrors js/kiosk.js exactly: admin keeps _kioskCart/_kioskDiscount/_kioskGiftCard/_kioskCustomer/_kioskRecipeContext/_kioskModifiedIngredients as its own local vars (since its admin-only custom-item/gift-card modals and recipe-browse UI still read/write them directly), bridged into KioskCore.init via get/set callbacks; admin injects ONLY credentials:'include' auth (the one legitimate env seam, D-02) plus 2 of its 8 admin-only modals as behavior hooks (showCustomItemModal/showGiftCardIssueModal)."
    - "_kioskDiscount is a brand-new admin-local state var (admin never had discount support before this plan) — bridged identically to kiosk.js's own _kioskDiscount, giving admin the full discount subsystem for free via KioskCore.calcTotals' discount branch (SC#3)."

key-files:
  created: []
  modified:
    - js/admin.js
    - admin.html
    - js/admin.min.js (build artifact)

key-decisions:
  - "D-DEV-08 (Rule 3 — blocking, matches 48-02's D-DEV-01..04 precedent): expanded the plan's 8-function admin-only KEEP list to 11 (added kioskShowRecipePrompt, renderKioskModifyRows, attachKioskModifyRowListeners) after discovering the GAP-1 regression test (tests/frontend/admin-recipe-modify.test.js) asserts admin._recipesState.catalogLoaded/catalog directly — meaning the ingredient-modify panel's autocomplete is intentionally wired to the Recipes tab's own catalog (admin's showIngredientAutocomplete/hideIngredientAutocomplete, NOT KioskCore's self-contained kioskShowIngredientAutocomplete/_kioskIngredientCatalog). Migrating these three functions would have broken that test (CLAUDE.md rule 10: do not modify existing tests) and silently switched the modify-panel's ingredient source out from under staff without discussion. The remaining ~30 recipe-browse/quote functions (kioskLoadRecipes, kioskFetchRecipeQuote, kioskUpdateAddToCartButton, kioskAddRecipeToCart, kioskSetMode, etc.) migrated cleanly to KioskCore as planned, since only the modify-panel's autocomplete and the quick-edit-wiring inside kioskShowRecipePrompt have this admin-specific coupling."
  - "D-DEV-09: admin's kioskShowCustomerStep (now KioskCore.showCustomerStep, migrated per plan) used a different customer-search endpoint (/api/contacts?search=) than kiosk.js/kiosk-core.js's canonical version (/api/contacts/search?q=). Verified both middleware routes accept session-cookie auth (authTiers.requireTiers(['legacy','device','session'])) so admin's credentials:'include' auth satisfies the canonical route — this drift is resolved as an inherent, expected consequence of SC#1 (exactly one implementation), not a separate fix."
  - "_kioskScaleFactor (display-preview-only, never read outside kioskShowRecipePrompt) and _kioskModifyPanelOpen (touched only by the two kept-local admin-only functions) stay as plain admin.js-local vars — no KioskCore bridge or accessor needed since nothing in the shared core touches them."

requirements-completed: [KIOSK-01]

# Metrics
duration: ~65min
completed: 2026-07-04
---

# Phase 48 Plan 04: Admin Consumes KioskCore — Payment/Cart/Discount De-fork + Manager Override Survival Summary

**Wired `js/admin.js` to consume the shared `KioskCore` for its entire money path (cart/catalog/totals/discount/payment/checkout/terminal/confirm/receipt), deleting ~33 duplicated function definitions, fixing two admin-only money/cart drift bugs as explicit verified outcomes (D-05), and giving the admin-embedded kiosk product-type discount parity (SC#3) for the first time — while the Manager Override (D-07, ported to KioskCore in 48-03) survives the deletion of admin's own broken local override handler.**

## Performance

- **Duration:** ~65 min
- **Completed:** 2026-07-04
- **Tasks:** 2 completed
- **Files modified:** 3 (2 source + 1 build artifact), across 2 commits

## Accomplishments

- `js/admin.js` shrank from 12,796 to 11,111 lines (13%): every duplicated cart/catalog/totals/payment/checkout/terminal/confirm/receipt/recipe-browse/discount function deleted, replaced by a single `KioskCore.init({credentials:'include', ...})` call + a block of local aliases (`var kioskCalcTotals = KioskCore.calcTotals;`, etc.) so every existing admin call site and DOM event listener keeps working unchanged while genuinely consuming the shared `kiosk-core.js` implementation (SC#1 — no second copy remains).
- **Both D-05 drift bugs fixed as explicit, verified outcomes:** the client-side `create_batch` loop that duplicated server-side batch creation is gone (confirmed: the only remaining `create_batch` reference in admin.js is the unrelated batch-admin path at line 7194); the recipe-sale charge now forwards `modified_ingredients` via the shared core builder (previously silently dropped — Pitfall 3); the idempotency key unifies on `reference_number` with no `Math.random()` suffix.
- **Manager Override (D-07) survives:** `grep -c "kiosk-stock-override-btn" js/admin.js` is 0 — no admin-local override handler remains. The override affordance is now driven entirely by KioskCore's ported handler (from 48-03, which also fixed a latent `kioskProcessSale()` ReferenceError that would have made admin's "working" override throw when clicked). admin.html's pre-existing `#kiosk-stock-override-btn` markup (663-665) needed no changes.
- **Discount parity delivered (SC#3):** `admin.html` gained the `kiosk-discount-zone`/`kiosk-discount-popover`/`kiosk-discount-mgmt-modal` markup ported verbatim from `kiosk.html`, with all element IDs preserved. `js/admin.js`'s `initKioskSaleTab` wires the discount button/popover/remove/manage-link exactly like `kiosk.js`, and loads discount presets on tab init. Admin never had discount support before this plan.
- **Admin-only functions preserved and updated:** the 8 plan-listed admin-only functions (recipe quick-edit, save-as-new, custom-item modal, gift-card issue/mgmt modals) remain untouched, plus 3 additional functions kept local due to a discovered testability/architecture coupling (see key-decisions D-DEV-08) — all updated internally to reach the now-relocated recipe/quote/sale-type/target-volume/mill-grain/availability/stock-override state via `KioskCore`'s accessors instead of bare local vars that no longer exist.
- Bottom-of-file `module.exports` test-export accessors rewritten to delegate the relocated state (`_kioskGetQuote`/`_kioskSetSelectedRecipe`/`_kioskGetSaleType`/`_kioskGetTargetVolumeL`/`_kioskSetRecipeAvailability`) through `KioskCore.*`, with EXACT property names preserved — zero test file changes (verified: `git diff --stat -- tests/` empty across both commits).
- Two direct external readers of admin's former `_kioskProducts` var (homepage featured-kit search, homepage featured-list rendering — both outside the kiosk tab entirely) updated to `KioskCore._getProducts()`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire admin.js to KioskCore, delete duplicated definitions, fix both drift bugs + unify idempotency (D-05), preserve Manager Override via core (D-07)** - `306ba57` (feat)
2. **Task 2: Port the product-type discount markup into admin.html #tab-kiosk (SC#3 structure side)** - `556939e` (feat)

## Files Created/Modified

- `js/admin.js` — `KioskCore.init(...)` call + ~50-line alias block added; ~33 duplicated function definitions deleted (cart/catalog/totals/view/terminal/checkout/customer-step/payment/receipt/error/recipe-browse-core/quote/discount); `_kioskDiscount` new bridged state var added; state var block trimmed to bridged (cart/discount/giftCard/customer/recipeContext/modifiedIngredients) + admin-only-local (customCounter/giftCertCounter/tabActive/searchTimer/modifyPanelOpen/scaleFactor) vars only; `initKioskSaleTab` updated to use `KioskCore._setProductsLoaded/_setSelectedRecipe/_setSaleType/_setQuote/_setMillGrain` accessors + new discount-popover wiring; `kioskShowRecipePrompt`/`kioskSaveAsNewRecipe` (kept local) updated to read/write relocated state via `KioskCore._get*/_set*`; bottom module.exports accessors delegate to `KioskCore.*`; tab-nav hook + homepage bootstrap updated to `KioskCore._getProductsLoaded()/_getProductsLoading()`; two homepage-search call sites updated to `KioskCore._getProducts()`
- `admin.html` — `kiosk-discount-zone`/`kiosk-discount-popover` ported into the `#tab-kiosk` cart pane at the same relative position as `kiosk.html`; `kiosk-discount-mgmt-modal` ported after the terminal status bar; no SO-import UI added
- `js/admin.min.js` — regenerated by `npm run build`

## Decisions Made

See `key-decisions` in frontmatter (D-DEV-08, D-DEV-09) — both are necessary consequences of (a) preserving an existing, test-asserted admin-specific architecture (the Recipes tab catalog integration) rather than blindly deleting every `kiosk*`-prefixed function, and (b) accepting the natural endpoint-unification side effect of collapsing two customer-search implementations into one canonical version (SC#1's whole point).

## Deviations from Plan

### Auto-fixed / Necessary Scope Adjustments

**1. [Rule 3 - Blocking, matches 48-02's D-DEV-01..04 precedent] Expanded admin-only KEEP list from 8 to 11 functions (D-DEV-08)**
- **Found during:** Task 1, tracing `renderKioskModifyRows`/`attachKioskModifyRowListeners`'s ingredient-autocomplete call chain before deleting them per the plan's literal instruction to migrate all non-admin-only kiosk* functions.
- **Issue:** `attachKioskModifyRowListeners` calls admin's own `showIngredientAutocomplete`/`hideIngredientAutocomplete` (bare names, NOT `kioskShowIngredientAutocomplete`/`kioskHideIngredientAutocomplete`) — a completely different, pre-existing function pair that reads `_recipesState.catalog` (the admin Recipes tab's own ingredient catalog), not KioskCore's self-contained `_kioskIngredientCatalog`. The `tests/frontend/admin-recipe-modify.test.js` GAP-1 regression test explicitly asserts `admin._recipesState.catalogLoaded`/`admin._recipesState.catalog` after calling `admin._kioskOpenModifyPanel(...)` — meaning this Recipes-tab-catalog-reuse is a deliberate, tested admin-specific design (GAP-1, 36-09), not accidental duplication. Migrating `renderKioskModifyRows`/`attachKioskModifyRowListeners` (and, transitively, `kioskShowRecipePrompt`, whose `modifyToggle.onclick` calls the plan's own admin-only-designated `kioskOpenModifyPanel`) to KioskCore would have broken this test and silently switched the modify panel onto a different, un-loaded ingredient catalog.
- **Fix:** Kept `kioskShowRecipePrompt`, `renderKioskModifyRows`, `attachKioskModifyRowListeners` as admin-only local functions (joining the plan's original 8), updated internally to read/write the now-relocated `_kioskSelectedRecipe`/`_kioskSaleType`/`_kioskMillGrain`/`_kioskRecipeAvailability`/`_kioskTargetVolumeL`/`_kioskStockOverride` state via `KioskCore`'s accessors instead of bare local vars (which no longer exist, since the ~30 other recipe-browse/quote functions genuinely did migrate to KioskCore per plan).
- **Files modified:** `js/admin.js`
- **Verification:** `tests/frontend/admin-recipe-modify.test.js` (14 tests incl. GAP-1a/GAP-1b) passes unmodified; full FE suite 947/947 green; `git diff --stat -- tests/` empty.
- **Committed in:** `306ba57` (Task 1)

**2. [Rule 1-adjacent, documented not silently absorbed] Admin's customer-search endpoint unified onto the canonical route (D-DEV-09)**
- **Found during:** Task 1, comparing admin's `kioskShowCustomerStep` (`/api/contacts?search=`, `items.js`) against `kiosk-core.js`'s canonical version (`/api/contacts/search?q=`, `pos.js`) before deleting admin's copy per the plan.
- **Issue:** These are two genuinely different, both-currently-working middleware routes with different query param names. Since `kioskShowCustomerStep` is explicitly a shared/migrated function (not admin-only), admin's customer search now hits the canonical route.
- **Fix:** Verified `pos.js`'s `/api/contacts/search` route accepts `authTiers.requireTiers(['legacy', 'device', 'session'])` — admin's `credentials:'include'` session-cookie auth satisfies this tier, so no auth gap. This unification is the direct, intended consequence of SC#1 (exactly one implementation) rather than a bug needing a separate fix.
- **Files modified:** None beyond the Task 1 alias (behavior change is inherent to consuming the shared function, not a targeted edit).
- **Verification:** `zoho-middleware/routes/pos.js:2587-2591` confirms session-tier acceptance; full FE + middleware suites green.
- **Committed in:** `306ba57` (Task 1)

**3. [Rule 3 - Blocking, environment-only, matches 48-01/48-02/48-03 precedent] Symlinked `zoho-middleware/node_modules`**
- **Found during:** Pre-commit middleware test run (CLAUDE.md rule 1).
- **Issue:** This worktree has no `zoho-middleware/node_modules` (same pre-existing environment gap prior plans documented).
- **Fix:** Symlinked to the main repo's already-installed `zoho-middleware/node_modules` — no packages installed, purely linking.
- **Files modified:** None tracked (gitignored path pattern absent but left untracked/unstaged; never committed).
- **Verification:** `cd zoho-middleware && npm test` → 77 suites / 1250 tests passed, unmodified from baseline.
- **Committed in:** N/A (local worktree convenience only).

**4. [Rule 3 - Blocking, matches 48-01/48-02/48-03 precedent] Reverted unrelated cache-bust stamps from `npm run build`**
- **Found during:** After running `npm run build`.
- **Issue:** `npm run build` also runs `stamp:kiosk`/`stamp:brewpad`/`stamp:index`/`stamp:pages`, bumping cache-bust `?v=` on 16+ unrelated pages — none in this plan's `files_modified` scope.
- **Fix:** `git checkout --` on each unrelated file after the build, keeping only `js/admin.js`, `admin.html`, `js/admin.min.js` staged.
- **Files modified:** Reverted (not committed): `about.html`, `brewpad.html`, `contact.html`, `custom-labels.html`, `index.html`, `ingredients.html`, `kiosk.html`, `products.html`, `products/*.html` (7 files), `reservation.html`.
- **Verification:** `git status --short` after revert showed only the 3 plan-scoped files staged.
- **Committed in:** N/A (explicitly reverted, not committed).

---

**Total deviations:** 4 (1 scope-boundary adjustment necessary to preserve existing tested admin architecture, matching 48-02's precedent exactly; 1 documented-not-silent endpoint unification inherent to SC#1; 2 auto-fixed environment/build-noise containment matching 48-01/48-02/48-03's precedent exactly).
**Impact on plan:** No functional scope creep. The core intent — admin consumes the shared KioskCore (SC#1), gains discount parity (SC#3), both drift bugs + idempotency-suffix fixed as explicit verified changes (D-05), Manager Override survives via KioskCore (D-07), cookie auth preserved, no SO UI added — is fully met. The expanded admin-only KEEP list (11 vs. the plan's 8) is a necessary consequence of respecting an existing, test-asserted admin-specific architecture (Recipes tab catalog reuse) rather than a deviation from the plan's actual goal.

## Issues Encountered

None beyond the deviations documented above. The scope of "which functions can migrate cleanly vs. must stay admin-local" required tracing every kiosk-prefixed function's full call graph and cross-referencing against existing regression tests before deleting anything — consistent with the pattern 48-02/48-03 established for a large, deeply cross-referential file.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `js/admin.js` now consumes `KioskCore` for its entire cart/catalog/totals/discount/payment/checkout/terminal/confirm/receipt path, verified behaviour-preserving (except the two intentional D-05 bug fixes + the SC#3 discount addition) via the full existing Jest suite (947 tests, unmodified) and lint-clean ES5.
- Both surfaces (`kiosk.js` and `admin.js`) now consume the exact same `kiosk-core.js` implementation for the money path and discount subsystem — SC#1 achieved across the whole phase.
- Both surfaces now have working Manager Override (revived on standalone kiosk in 48-03, survives on admin in this plan) and discount parity (admin gained it in this plan; kiosk.js already had it from 48-02).
- 48-05 (parity testing) has a single, complete shared implementation to assert parity against for cart/catalog/totals/discount/payment/checkout/terminal/confirm/receipt on both surfaces.
- No blockers identified for 48-05/48-06.

---
*Phase: 48-kiosk-pos-de-fork-kiosk-core-js*
*Completed: 2026-07-04*

## Self-Check: PASSED

- FOUND: js/admin.js
- FOUND: admin.html
- FOUND: js/admin.min.js
- FOUND: commit 306ba57 (Task 1)
- FOUND: commit 556939e (Task 2)
- FOUND: KioskCore.proceedToPayment alias present in js/admin.js (1 occurrence)
- FOUND: function kioskProceedToPayment/kioskCalcTotals absent from js/admin.js (0 occurrences)
- FOUND: kiosk-stock-override-btn absent from js/admin.js (0 occurrences — moved to KioskCore in 48-03)
- FOUND: x-device-token absent from js/admin.js (0 occurrences)
- FOUND: kiosk-discount-zone/kiosk-discount-popover/kiosk-discount-mgmt-modal present in admin.html
- FOUND: kiosk-so- absent from admin.html (0 occurrences — scope fence held)
- FOUND: full frontend suite green (947/947 tests), middleware suite green (1250/1250 tests, unmodified)
- FOUND: lint clean (eslint js/ --max-warnings 0)
- FOUND: no test file changes (git diff --stat -- tests/ empty across both commits)
