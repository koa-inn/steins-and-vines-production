---
phase: 48-kiosk-pos-de-fork-kiosk-core-js
plan: 03
subsystem: frontend-kiosk
tags: [es5, iife, jest, kiosk, de-fork, money-path, terminal, manager-override, sales-order]

# Dependency graph
requires: ["48-01", "48-02"]
provides:
  - "js/kiosk-core.js owns the full payment/checkout/terminal/confirm/receipt path (kioskProceedToPayment, _kioskPushToTerminal, terminal check/poll/status, sale + recipe-sale confirm) and the full dual-cart/sales-order-import subsystem (SC#1: exactly one place)"
  - "Canonical sale-body baked in (D-05): modified_ingredients forwarded, idempotency_key: refNumber (no Math.random() suffix)"
  - "Manager Override (stock-conflict) single-sourced in KioskCore and working on BOTH surfaces for the first time (D-07): override field on recipe-sale/confirm bodies, 409/conflicts rendering, #kiosk-stock-override-btn wiring that resubmits — revives the previously-dead override button on the standalone kiosk"
  - "js/kiosk.js slims to consumer wiring: local aliases for every relocated function/state accessor it still calls, SO-browse UI event wiring, customer-browse/custom-item/gift-card-issue modals unchanged"
affects: [48-04, 48-05, 48-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "D-07 reverse-drift port: admin.js was canonical for the Manager Override function ONLY (kiosk.js's copy was dead — declared/reset, never wired, never sent) — ported admin's override field + 409/conflicts handler + button wiring into the unified core rather than treating kiosk.js as canonical for this one function"
    - "Override-value freshness: recipeSaleBody.override is recomputed at the top of every _kioskPushToTerminal() invocation (not captured once at construction) so the override-button resubmit always sends the CURRENT _kioskStockOverride value, not a stale snapshot"
    - "Bug fix while porting D-07: admin.js's own override-button handler called a non-existent kioskProcessSale() (a latent ReferenceError bug in the 'working' half) — the ported handler correctly re-invokes _kioskPushToTerminal(), the actual push/poll/confirm routine, instead"
    - "Intra-plan bridge-then-internalize: Task 1 bridged the imported-SO checkout fork's dependency on the not-yet-migrated SO subsystem via 5 new _kcEnv hooks (mirroring the 48-02 D-DEV-01/03 precedent); Task 2 moved the SO subsystem itself and collapsed the bridge to direct in-closure calls in the same plan"
    - "Transitive-dependency folding (mirrors 48-02 D-DEV-02): generateBatchQR/buildBatchLabelHTML/LABEL_CSS/AGREEMENT_TEXT (Task 1) and kioskShowCollect (Task 2) moved alongside their sole caller even though not itemized in the plan's interfaces list, because leaving them in kiosk.js would break the moved caller immediately"

key-files:
  created: []
  modified:
    - js/kiosk-core.js
    - js/kiosk.js
    - js/kiosk-core.min.js (build artifact)
    - js/kiosk.min.js (build artifact)
    - kiosk.html (cache-bust stamp only)

key-decisions:
  - "D-DEV-05: kioskShowCollect (a 3-line view-show helper, not in the plan's Task 2 interfaces list) folded into Task 2's move — it's called from kioskCollectPayment's cancel handler, kioskShowSoError's back/retry handlers, and kioskShowCreateSo's back button, all of which moved to core in the same task; leaving it in kiosk.js would have required yet another bridge hook for a 3-line function with no other purpose."
  - "D-DEV-06: kioskSetTerminalStatus/kioskCheckTerminal's 5 hard-coded 'x-device-token' fetch calls and the imported-SO/SO-subsystem fetches all genericized through _kcMergeAuth(_kcEnv.buildAuthOptions()) — the established 48-01/48-02 auth seam — rather than left hard-coded, since D-02 requires the money/SO path to be truly context-agnostic (both kiosk.js's x-device-token and admin.js's future credentials:'include' consumption)."
  - "D-DEV-07: Task 1's temporary SO-checkout-fork bridge (getImportedSoUpdated/setImportedSoUpdated/syncSalesOrderBalance/collectPayment/showSoError, plus reuse of the existing getImportedSoId/getImportedSoNumber/clearImportedSo hooks) was fully removed once Task 2 internalized the SO subsystem in the same plan — no bridge remnants left for a future plan to clean up, unlike the payment-path bridge 48-02 left for 48-03 to resolve (that pattern was appropriate across plan boundaries; within a single plan, immediate internalization was cheaper and lower-risk)."

requirements-completed: [KIOSK-01]

# Metrics
duration: ~70min
completed: 2026-07-04
---

# Phase 48 Plan 03: Payment/Checkout/Terminal/Receipt + Dual-Cart/SO Logic → kiosk-core.js (D-07 Manager Override) Summary

**Moved the entire kiosk money path (terminal push/poll, sale + recipe-sale confirm, receipt) and the dual-cart/sales-order-import subsystem verbatim from `js/kiosk.js` into `js/kiosk-core.js`, and revived the standalone kiosk's previously-dead Manager Override stock-conflict button by porting admin.js's working implementation (fixing a latent `kioskProcessSale()` ReferenceError bug in the process).**

## Performance

- **Duration:** ~70 min
- **Completed:** 2026-07-04
- **Tasks:** 2 completed
- **Files modified:** 5 (2 source + 2 build artifacts + 1 HTML cache-bust), across 2 commits

## Accomplishments

- `js/kiosk-core.js` grew to 4533 lines: the full payment/checkout/terminal/confirm/receipt path (`kioskProceedToPayment` incl. the nested `_kioskPushToTerminal` closure and the imported-SO checkout fork, `kioskStartCheckout`, `kioskCheckTerminal`/`kioskSetTerminalStatus`, `kioskShowReceipt` + its batch-label transitive dependencies) and the complete dual-cart/sales-order-import subsystem (15 functions) now live behind `KioskCore.*` (D-06 de-prefixed names), all reachable from a single source (SC#1).
- `js/kiosk.js` shrank to 1458 lines (54% from the 48-02 baseline of 3156): every moved function definition removed, replaced by local aliases for the handful with remaining bootstrap call sites; the rest resolve entirely inside `KioskCore`'s own closure with zero kiosk.js call site.
- **Canonical sale-body preserved exactly (D-05):** `modified_ingredients` forwarded, `idempotency_key: refNumber` (no `Math.random()` suffix) — verified via `grep -c "Math.random" js/kiosk-core.js` on the sale path == 0.
- **Manager Override revived (D-07 — the phase's one intentional behaviour change):** ported admin.js's `override` field, 409/`conflicts` rendering, and `#kiosk-stock-override-btn` wiring into the unified core. The recipe-sale and recipe-sale/confirm bodies now send `override` (refreshed on every `_kioskPushToTerminal()` invocation, including the override-button resubmit, so a stale `false` is never sent after staff click Override); a 409 response renders the conflict list into `#kiosk-stock-conflict .kiosk-stock-conflict-msg` and wires the override button to set the flag and resubmit. **This makes the standalone kiosk's previously-dead `#kiosk-stock-override-btn` functional for the first time** — kiosk.js's own copy of `_kioskStockOverride` was declared/reset but never wired or sent.
- **Bug caught while porting D-07:** admin.js's own override-button handler calls a function, `kioskProcessSale()`, that is never defined anywhere in `js/admin.js` — meaning admin's "working" override half actually throws a `ReferenceError` when clicked and never resubmits. The ported handler in `kiosk-core.js` correctly re-invokes `_kioskPushToTerminal()` (the real push/poll/confirm routine) instead of reproducing this latent bug.
- Every hard-coded `x-device-token` fetch call in the moved code (terminal status, sale push/poll/confirm, SO update/pay/create/search) is genericized through `_kcMergeAuth(_kcEnv.buildAuthOptions())`, the established 48-01/48-02 auth seam — no auth logic hard-coded in the money/SO path.
- `_kioskTerminalReady`/`_kioskSaleData` (Task 1) and the full SO state (`_kioskSalesOrders`, `_kioskSoItems`, `_kioskSoCustomer`, `_kioskSoPayingId`, `_kioskSoActiveChips`, `_kioskImportedSoId`/`Number`/`Updated`) (Task 2) relocated fully into `kiosk-core.js`'s private closure — no lingering bridge for either subsystem after this plan (Task 1's temporary SO-fork bridge, added because the fork depends on functions Task 2 hadn't moved yet, was fully removed once Task 2 landed in the same plan).
- Dual-cart/SO logic verified single-sourced (SC#1): `kioskCollectPayment`/`kioskCreateSalesOrder`/`kioskImportSoToCart` absent from `kiosk.js`, present only in `kiosk-core.js`; scope fence held — `grep -c "kiosk-so-\|kiosk-view-browse-customer" admin.html` == 0 (no SO UI added to admin, per Pitfall 5).

## Task Commits

Each task was committed atomically:

1. **Task 1: Move the payment/checkout/terminal/confirm path into kiosk-core.js with canonical sale-body + Manager Override (D-07); wire kiosk.js** - `991a50f` (feat)
2. **Task 2: Move the dual-cart / sales-order-import logic into kiosk-core.js; keep SO-browse UI in kiosk.js (scope fence)** - `5c2f789` (feat)

## Files Created/Modified

- `js/kiosk-core.js` — populated with the full payment/terminal/receipt path (Task 1) + the full SO subsystem (Task 2); new closure state (`_kioskTerminalReady`, `_kioskSaleData`, `_kioskSalesOrders`, `_kioskSoItems`, `_kioskSoCustomer`, `_kioskSoPayingId`, `_kioskSoActiveChips`, `_kioskImportedSoId/Number/Updated`); `_kioskStockOverride` (already present from 48-02) now actively used in the sale-body + 409/resubmit flow; new `KioskCore` public methods (`setTerminalStatus`, `checkTerminal`, `startCheckout`, `proceedToPayment`, `showReceipt`, `showCollect`, `loadSalesOrders`, `renderSoList`, `renderSoChips`, `wireSoChips`, `importSoToCart`, `reorderSo`, `clearImportedSo`, `collectPayment`, `showSoError`, `showCreateSo`, `renderSoCustomerInfo`, `addSoItem`, `removeSoItem`, `renderSoItems`, `createSalesOrder`) and accessors (`_getTerminalReady`, `_getSaleData`, `_getStockOverride`, `_setStockOverride`)
- `js/kiosk.js` — moved function/state definitions deleted; local aliases added for every relocated symbol with a remaining call site (`kioskCheckTerminal`, `kioskStartCheckout`, `kioskProceedToPayment`, `kioskShowReceipt`, `kioskShowCollect`, `kioskLoadSalesOrders`, `kioskRenderSoList`, `kioskWireSoChips`, `kioskShowCreateSo`); `KioskCore.init(...)` call slimmed — `proceedToPayment`/`startCheckout` behavior hooks and the temporary Task-1 SO-fork bridge (5 hooks) removed entirely, since the functions they bridged to now live fully in core; 2 remaining Task-2-adjacent `_kioskTerminalReady` reads (inside `kioskCollectPayment`/`kioskCreateSalesOrder`, mid-move at the Task 1 boundary) updated to `KioskCore._getTerminalReady()`
- `js/kiosk-core.min.js`, `js/kiosk.min.js` — regenerated by `npm run build`
- `kiosk.html` — `kiosk-core.min.js?v=`/`kiosk.min.js?v=` cache-bust bumped by the build's `stamp:kiosk` step (both files' content changed)

## Decisions Made

See `key-decisions` in frontmatter (D-DEV-05 through D-DEV-07) — all three are necessary consequences of (a) folding tiny transitive dependencies into the task that needs them (matches 48-02's D-DEV-02 precedent), (b) fully genericizing auth on every fetch touched by this plan (D-02 requirement), and (c) resolving Task 1's intentionally-temporary SO bridge within this same plan rather than leaving it for 48-04.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected admin.js's `kioskProcessSale()` ReferenceError when porting the Manager Override resubmit handler (D-07)**
- **Found during:** Task 1, while reading `js/admin.js:11066-11095` (the plan's cited source-of-truth range for the 409/override handler) to port it verbatim.
- **Issue:** admin.js's `#kiosk-stock-override-btn` `onclick` handler ends with `kioskProcessSale();` — a function that does not exist anywhere in `js/admin.js` (confirmed via full-file grep: the only occurrence of the string `kioskProcessSale` in the entire file is this one call site). Clicking the override button on the admin-embedded kiosk today would throw an uncaught `ReferenceError` and never resubmit the sale — meaning admin.js's override is not actually the fully working reference implementation the phase's CONTEXT.md/RESEARCH.md describe it as.
- **Fix:** The ported handler in `kiosk-core.js` calls `_kioskPushToTerminal()` — the real, in-scope push/poll/confirm routine — instead of reproducing the broken call. This is the only behaviorally-correct choice: `_kioskPushToTerminal` is exactly "the same core sale routine" the plan's action text asks the resubmit to re-invoke.
- **Files modified:** `js/kiosk-core.js`
- **Verification:** `grep -n "kioskProcessSale" js/kiosk-core.js` returns nothing (not reproduced); `#kiosk-stock-override-btn` handler resolves to a real in-scope function; `npm test` green.
- **Committed in:** `991a50f` (Task 1)

**2. [Rule 3 - Blocking, transitive dependency, mirrors 48-02 D-DEV-02] Moved `generateBatchQR`/`buildBatchLabelHTML`/`LABEL_CSS`/`AGREEMENT_TEXT` in Task 1**
- **Found during:** Task 1, tracing `kioskShowReceipt`'s "Save Label" button handler.
- **Issue:** These four batch-label-printing utilities are used ONLY by `kioskShowReceipt`'s "Save Label" click handler (confirmed via whole-file grep — no other caller). `kioskShowReceipt` is an explicit Task 1 function; leaving its only dependencies behind in kiosk.js would break it immediately.
- **Fix:** Moved verbatim into `kiosk-core.js` alongside `kioskShowReceipt`.
- **Files modified:** `js/kiosk-core.js`, `js/kiosk.js`
- **Verification:** `npm test` green; `kioskShowReceipt`'s full call graph resolves entirely within `kiosk-core.js`.
- **Committed in:** `991a50f` (Task 1)

**3. [Rule 3 - Blocking, transitive dependency, mirrors 48-02 D-DEV-02] Moved `kioskShowCollect` in Task 2**
- **Found during:** Task 2, tracing `kioskCollectPayment`/`kioskShowSoError`/`kioskShowCreateSo`'s cancel/back/retry handlers.
- **Issue:** `kioskShowCollect` (a 3-line `kioskShowView('collect'); kioskLoadSalesOrders();` helper) is not itemized in the plan's Task 2 interfaces list, but is called from within several of the explicitly-listed moved functions' UI-recovery paths.
- **Fix:** Moved into `kiosk-core.js` as `KioskCore.showCollect`; kiosk.js's bootstrap wiring (`soBtn` click) now calls it via a local alias.
- **Files modified:** `js/kiosk-core.js`, `js/kiosk.js`
- **Verification:** `npm test` green; no remaining bare `kioskShowCollect` definition in kiosk.js.
- **Committed in:** `5c2f789` (Task 2)

**4. [Rule 3 - Blocking, environment-only, matches 48-01/48-02 precedent] Symlinked `zoho-middleware/node_modules`**
- **Found during:** Pre-commit middleware test run (CLAUDE.md rule 1).
- **Issue:** This worktree has no `zoho-middleware/node_modules` (same pre-existing environment gap 48-01/48-02 documented).
- **Fix:** Symlinked to the main repo's already-installed `zoho-middleware/node_modules` — no packages installed, purely linking.
- **Files modified:** None tracked (gitignored, untracked, never staged).
- **Verification:** `cd zoho-middleware && npm test` → 77 suites / 1250 tests passed, unmodified from baseline.
- **Committed in:** N/A (local worktree convenience only).

**5. [Rule 3 - Blocking, matches 48-01/48-02 precedent] Reverted unrelated cache-bust stamps + admin.js/admin.min.js from `npm run build`**
- **Found during:** Both tasks, after running `npm run build`.
- **Issue:** `npm run build` also runs `stamp`/`stamp:admin`/`stamp:brewpad`/`stamp:index`/`stamp:pages`, bumping cache-bust `?v=` on 16+ unrelated pages plus `admin.html` and `js/admin.js`'s `BUILD_TIMESTAMP` (admin.js's own build-timestamp comment, not a functional change) — none in this plan's `files_modified` scope.
- **Fix:** `git checkout --` on each unrelated file after every build, keeping only `js/kiosk-core.js`, `js/kiosk.js`, their `.min.js`, and `kiosk.html` staged.
- **Files modified:** Reverted (not committed), both times: `about.html`, `admin.html`, `brewpad.html`, `contact.html`, `custom-labels.html`, `index.html`, `ingredients.html`, `js/admin.js`, `js/admin.min.js`, `products.html`, `products/*.html` (8 files), `reservation.html`.
- **Verification:** `git status --short` after each revert showed only the 5 plan-scoped files staged.
- **Committed in:** N/A (explicitly reverted, not committed).

---

**Total deviations:** 5 (1 latent bug fixed while porting D-07 — the money-path-critical one; 2 transitive-dependency-move deviations matching established precedent; 2 auto-fixed environment/build-noise containment matching 48-01/48-02's precedent exactly).
**Impact on plan:** No functional scope creep. The core intent — payment/checkout/terminal/confirm/receipt path AND dual-cart/SO logic single-sourced in `kiosk-core.js`, behaviour-preserving except the one intentional D-07 Manager Override revival, existing tests green — is fully met. The D-07 bug fix (correcting admin.js's broken resubmit call) is squarely within Rule 1 (auto-fix bugs): reproducing a known-broken call site in the "canonical" source would have shipped a dead override button on BOTH surfaces instead of reviving it on one, directly contradicting the plan's own must-have.

## Issues Encountered

None beyond the deviations documented above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `js/kiosk-core.js` now owns the entire kiosk money path (cart → catalog → totals → discount → payment/checkout/terminal → confirm → receipt) plus the dual-cart/SO subsystem, all verified behaviour-identical via the full existing Jest suite (947 tests, unmodified) and lint-clean ES5. The Manager Override now works identically (and, on the standalone kiosk, for the first time) on both surfaces.
- No bridge remnants: `KioskCore.init(env)`'s seam is back down to its intended scope — auth injection + the state kiosk.js's own custom-item/gift-card-issue modals and customer-browse UI still physically own (cart, discount, gift card, customer, recipe context, modified ingredients).
- 48-04 (admin consumption) can now wire `js/admin.js` to `KioskCore.*` directly for the full money/SO surface — no partially-migrated functions or dangling bridges to work around.
- 48-05 (parity testing) has a single, complete implementation to assert parity against for both the payment path and the dual-cart/SO-import path, including the newly-functional Manager Override.
- No blockers identified for 48-04.

---
*Phase: 48-kiosk-pos-de-fork-kiosk-core-js*
*Completed: 2026-07-04*

## Self-Check: PASSED

- FOUND: js/kiosk-core.js
- FOUND: js/kiosk.js
- FOUND: js/kiosk-core.min.js
- FOUND: js/kiosk.min.js
- FOUND: commit 991a50f (Task 1)
- FOUND: commit 5c2f789 (Task 2)
- FOUND: KioskCore.proceedToPayment export present in js/kiosk-core.js
- FOUND: kioskProceedToPayment absent from js/kiosk.js (0 occurrences)
- FOUND: kioskCollectPayment absent from js/kiosk.js (0 occurrences)
- FOUND: full frontend suite green (947/947 tests), middleware suite green (1250/1250 tests, unmodified)
- FOUND: lint clean (eslint js/ --max-warnings 0)
- FOUND: no test file changes (git diff --stat -- tests/ empty across both commits)
