---
phase: 48-kiosk-pos-de-fork-kiosk-core-js
plan: 05
subsystem: testing
tags: [es5, jest, kiosk, admin, de-fork, parity, manager-override, ci-gate]

# Dependency graph
requires: ["48-01", "48-02", "48-03", "48-04"]
provides:
  - "tests/frontend/kiosk-core-parity.test.js — the machine-checkable SC#2/D-03 guard proving the standalone kiosk and admin-embedded kiosk produce identical fetch URL + body (modulo reference_number/idempotency_key) for the same cart, on both a plain product sale and a recipe sale"
  - "D-07 Manager Override parity locked as a regression test: both surfaces send an `override` key (default false) on recipe-sale bodies, and on a mocked 409 `conflicts` response both wire #kiosk-stock-override-btn -> override=true -> identical resubmit"
  - "Full build/lint/test gate green (SC#4): npm test (950 tests), cd zoho-middleware && npm test (1250 tests), npm run lint (ES5, --max-warnings 0), npm run build (all 4 bundles regenerated)"
affects: [48-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-surface module isolation for parity testing: since js/kiosk.js and js/admin.js each call the shared KioskCore.init(env) exactly once at require-time, and KioskCore is a window-level singleton, requiring both files in the same test run leaves the LAST-required surface's env active for both. The test drives each surface in full isolation via jest.resetModules() + `delete window.KioskCore` before each require, forcing a brand-new kiosk-core.js closure (and thus a fresh env pointer) per surface."
    - "Microtask-chain flushing without setImmediate: this jsdom test environment does not expose Node's setImmediate, so the test's flushPromises() helper chains 6 native `Promise.resolve().then()` hops instead — enough to drain any fetch().then(r => r.json().then(...)).then(...) chain (max 3 hops deep anywhere in the exercised code) before the next assertion runs."
    - "Bypassing full UI-driven cart construction: rather than replaying kiosk.js's/admin.js's own click-driven flows, the test seeds cart/recipe state directly through KioskCore's own public API (KioskCore.addToCart(product), KioskCore._setSelectedRecipe/_setSaleType, KioskCore.addRecipeToCart()) — all of which are shared, context-agnostic KioskCore methods identical on both surfaces post-de-fork, making this the correct level to assert parity at."

key-files:
  created:
    - tests/frontend/kiosk-core-parity.test.js
  modified:
    - js/admin.js (BUILD_TIMESTAMP stamp only, from npm run build)
    - js/admin.min.js (build artifact)
    - admin.html (cache-bust ?v= stamp only)
    - kiosk.html (cache-bust ?v= stamp only)

key-decisions:
  - "D-DEV-10 (Rule 3 — blocking, matches 48-01/02/03/04 precedent): symlinked zoho-middleware/node_modules to the main repo's already-installed copy — this worktree has no middleware node_modules of its own. No packages installed, purely linking; left untracked/unstaged, never committed."
  - "D-DEV-11 (Rule 3 — blocking, matches 48-01/02/03/04 precedent): reverted 16 unrelated cache-bust-only HTML pages (about.html, brewpad.html, contact.html, custom-labels.html, index.html, ingredients.html, products.html, reservation.html, products/*.html x8) touched incidentally by `npm run build`'s stamp chain — none in this plan's files_modified scope. Kept only admin.html/kiosk.html (both load the regenerated kiosk-core.min.js/admin.min.js/kiosk.min.js bundles under new cache-bust versions) plus js/admin.js/js/admin.min.js (BUILD_TIMESTAMP forces a new admin.min.js byte output every build)."
  - "js/kiosk-core.min.js, js/kiosk.min.js, and js/main.min.js all regenerated with newer mtimes but byte-IDENTICAL content to what 48-04 already committed — expected, since their source files (js/kiosk-core.js, js/kiosk.js, the js/modules/* concat inputs) were untouched by this plan; terser's minification is deterministic given unchanged input. Only js/admin.min.js differs, because js/admin.js's BUILD_TIMESTAMP comment changes on every build."

requirements-completed: [KIOSK-01]

# Metrics
duration: ~55min
completed: 2026-07-04
---

# Phase 48 Plan 05: Parity Test (SC#2/D-03/D-07) + Final Build/Lint/Test Gate Summary

**Added `tests/frontend/kiosk-core-parity.test.js` — a per-surface-isolated Jest suite that drives an identical cart through both the standalone kiosk's and the admin-embedded kiosk's own wiring and asserts identical fetch URL/body/auth/override behaviour — then ran the full build/lint/test gate (954 FE tests, 1250 middleware tests, ES5 lint, all 4 bundles regenerated) clean, closing out SC#2 and SC#4.**

## Performance

- **Duration:** ~55 min
- **Completed:** 2026-07-04
- **Tasks:** 2 completed
- **Files modified:** 5 (1 new test file + 4 build/cache-bust artifacts), across 2 commits

## Accomplishments

- **SC#2/D-03 parity proven, machine-checkable:** `tests/frontend/kiosk-core-parity.test.js` (3 tests) asserts, for an identical cart built via each surface's own wiring: (1) a plain product sale hits the same `mwUrl + '/api/kiosk/sale'` URL with a deep-equal body (modulo `reference_number`/`idempotency_key`) and correct per-surface auth (kiosk `x-device-token` header, admin `credentials:'include'` with no `x-device-token` key); (2) a recipe sale hits `mwUrl + '/api/kiosk/recipe-sale'` identically, including the `modified_ingredients` field (Pitfall 3) and the D-07 `override:false` default; (3) D-05's idempotency-key unification (`idempotency_key === reference_number`, no `Math.random()` suffix) holds on both surfaces in every case.
- **D-07 Manager Override parity locked as a regression test:** the third test mocks a 409 `{conflicts}` response on the recipe-sale push, asserts both surfaces render `#kiosk-stock-conflict` and wire `#kiosk-stock-override-btn`, then simulates the click and asserts BOTH resubmit with `override:true`, the same URL, and an otherwise-identical body — the automated half of D-07's mandated stock-insufficient verification (T-48-14O). This is a genuine regression guard: if a future edit re-forks the override handling on either surface, this test fails loudly.
- **Solved a real architecture nuance to make the parity test possible at all:** `js/kiosk.js` and `js/admin.js` each call the shared `KioskCore.init(env)` exactly once, synchronously, at require-time — and `KioskCore` is a `window`-level singleton (set once per Node module-cache lifetime via the existing Pitfall-4 guard). Naively `require`-ing both files in one test (as the plan's interfaces note literally suggested) would leave whichever surface was required LAST silently "owning" the env pointer for both — the first surface's calls would run against the SECOND surface's cart/auth without erroring. The test solves this by loading each surface in full isolation (`jest.resetModules()` + `delete window.KioskCore` before each `require`), forcing a brand-new `kiosk-core.js` closure per surface. Documented as a deviation below (Rule 3 — blocking issue, auto-fixed) since it changes the plan's literal test-setup mechanics (not its intent).
- **Full gate green (SC#4):** `npm run build` regenerated all 4 bundles (`js/kiosk-core.min.js`, `js/kiosk.min.js`, `js/main.min.js` byte-identical to 48-04's output since their sources are untouched; `js/admin.min.js` regenerated fresh due to the `BUILD_TIMESTAMP` bump) and re-stamped `admin.html`/`kiosk.html`'s `?v=` cache-busts. `npm test`: 54 suites / 950 tests green (947 pre-existing + the new file's 3). `cd zoho-middleware && npm test`: 77 suites / 1250 tests green, unmodified. `npm run lint`: `eslint js/ --max-warnings 0` clean.
- **No behaviour-changing logic introduced beyond what 48-02/48-03/48-04 already shipped:** confirmed via `git diff --stat` across this plan's commits — only the new test file plus build/cache-bust artifacts changed; `js/kiosk-core.js`, `js/kiosk.js`, and `js/admin.js`'s actual logic are untouched (the only `js/admin.js` diff line is the `BUILD_TIMESTAMP` stamp).

## KIOSK-01 Traceability (SC#1–SC#5)

| Success Criterion | Delivered by | Status |
|---|---|---|
| SC#1 — exactly one implementation of cart/catalog/payment/checkout/terminal/confirm/receipt/dual-cart, consumed by both surfaces | Plans 02 (cart/catalog/totals/discount), 03 (payment/checkout/terminal/confirm/receipt/dual-cart), 04 (admin wired to consume it) | ✅ Done |
| SC#2 — money path unchanged in behaviour, proven via existing tests + a new admin-vs-standalone parity check | This plan (48-05) — `tests/frontend/kiosk-core-parity.test.js` | ✅ Done |
| SC#3 — kiosk product-type discount identical on both surfaces | Plans 02 (kiosk.js discount subsystem in core) + 04 (admin.html markup port + wiring) | ✅ Done |
| SC#4 — `npm test`/`npm run lint`/`npm run build` clean, no behaviour-changing logic beyond the discount-parity fix | This plan (48-05) — full gate run, `git diff` reviewed | ✅ Done |
| SC#5 — verified on staging on iPad Safari, standalone + admin-embedded, discount + terminal/void/dual-cart intact | Plan 06 (checkpoint:human-verify — not yet run) | ⏳ Pending |
| D-07 Manager Override (the phase's one intentional behaviour change — revives the dead standalone-kiosk override button) | Ported to KioskCore in 03 (fixing a latent admin.js `kioskProcessSale()` ReferenceError in the process); survives admin's local-handler deletion in 04; parity-tested (both the default-false send and the 409→resubmit cycle) in this plan; live-verified in plan 06 | ✅ Automated half done; live half pending 06 |

## Task Commits

Each task was committed atomically:

1. **Task 1: Write tests/frontend/kiosk-core-parity.test.js (SC#2/D-03/D-07)** - `6b96c58` (test)
2. **Task 2: Final full gate — build, lint, both suites, KIOSK-01 traceability** - `11ec8a8` (chore)

## Files Created/Modified

- `tests/frontend/kiosk-core-parity.test.js` — new file, 3 tests: plain-product-sale parity, recipe-sale parity (incl. `modified_ingredients` + `override:false`), and the D-07 409→override→resubmit cycle. Per-surface isolation via `jest.resetModules()` + `window.KioskCore` reset; seeds cart/recipe state through `KioskCore`'s own shared public API (`addToCart`, `_setSelectedRecipe`/`_setSaleType`, `addRecipeToCart`) rather than replaying UI clicks.
- `js/admin.js` — `BUILD_TIMESTAMP` stamp only (from `npm run build`); no logic change.
- `js/admin.min.js` — regenerated by `npm run build` (byte-different due to the timestamp bump).
- `admin.html` / `kiosk.html` — cache-bust `?v=` stamps bumped (CSS + `kiosk-core.min.js`/`kiosk.min.js`/`admin.min.js` script tags).

## Decisions Made

See `key-decisions` in frontmatter (D-DEV-10, D-DEV-11) plus the per-surface-isolation testing pattern described above (not a numbered decision since it's test-infrastructure-only, not a product/behaviour decision).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Per-surface module isolation required for the parity test to be correct at all**
- **Found during:** Task 1, while designing the test setup per the plan's interfaces note ("require both `js/kiosk.js` and `js/admin.js`... each internally require('./kiosk-core.js')").
- **Issue:** `js/kiosk.js` and `js/admin.js` each call `KioskCore.init(env)` exactly once, synchronously, at require-time. `KioskCore` itself is a `window`-level singleton — the existing Pitfall-4 guard (`if (typeof window !== 'undefined' && !window.KioskCore ...) require('./kiosk-core.js');`) means the SECOND file required (in the same Jest module-cache lifetime) reuses the FIRST file's already-instantiated `KioskCore` object, and its own `KioskCore.init(env)` call overwrites the shared `_kcEnv` pointer. A test that requires both files once, at the top, and then calls "kiosk's" trigger function followed by "admin's" trigger function would actually run BOTH triggers against whichever surface was required last — silently, with no error, producing a false-positive "parity" (both would be identical because they're the same env) or subtly wrong behaviour, not a real cross-surface comparison.
- **Fix:** Each surface is now loaded via a `loadSurface(path)` helper that calls `jest.resetModules()` and `delete window.KioskCore` immediately before `require`-ing that surface's file — forcing a brand-new `kiosk-core.js` closure (and thus a correctly-pointed, surface-exclusive `_kcEnv`) for every surface load. This preserves the plan's actual intent (assert both surfaces produce identical requests for an identical cart) while fixing the mechanics of how "both surfaces" are driven in the same test file.
- **Files modified:** `tests/frontend/kiosk-core-parity.test.js` (this is the file being authored in Task 1 — the fix is baked into the initial implementation, not a later patch).
- **Verification:** All 3 tests pass; each asserts on `global.fetch.mock.calls` captured immediately after each surface's isolated `require` + trigger, with `global.fetch.mockClear()` between surfaces confirming no call-count bleed-through.
- **Committed in:** `6b96c58` (Task 1)

**2. [Rule 3 - Blocking, environment-only, matches 48-01/02/03/04 precedent] Symlinked `zoho-middleware/node_modules`**
- **Found during:** Pre-Task-2 middleware test run (CLAUDE.md rule 1).
- **Issue:** This worktree has no `zoho-middleware/node_modules` (same pre-existing environment gap every prior 48-0x plan documented).
- **Fix:** Symlinked to the main repo's already-installed `zoho-middleware/node_modules` — no packages installed, purely linking.
- **Files modified:** None tracked (untracked, never staged/committed).
- **Verification:** `cd zoho-middleware && npm test` → 77 suites / 1250 tests passed, unmodified from baseline.
- **Committed in:** N/A (local worktree convenience only).

**3. [Rule 3 - Blocking, matches 48-01/02/03/04 precedent] Reverted unrelated cache-bust stamps from `npm run build`**
- **Found during:** Task 2, after running `npm run build`.
- **Issue:** `npm run build` also runs `stamp:brewpad`/`stamp:index`/`stamp:pages`, bumping cache-bust `?v=` on 16 unrelated pages — none in this plan's `files_modified` scope.
- **Fix:** `git checkout --` on each unrelated file after the build, keeping only `admin.html`, `kiosk.html`, `js/admin.js`, `js/admin.min.js` staged (the only files this plan's build run legitimately touches — `js/kiosk-core.min.js`/`js/kiosk.min.js`/`js/main.min.js` regenerated byte-identical, so `git status` never listed them as modified in the first place).
- **Files modified:** Reverted (not committed): `about.html`, `brewpad.html`, `contact.html`, `custom-labels.html`, `index.html`, `ingredients.html`, `products.html`, `reservation.html`, `products/*.html` (8 files).
- **Verification:** `git status --short` after revert showed only the 4 plan-scoped files staged.
- **Committed in:** N/A (explicitly reverted, not committed).

---

**Total deviations:** 3 (1 test-infrastructure fix necessary for the parity test to actually test anything meaningful — not a scope change to the plan's goal; 2 auto-fixed environment/build-noise containment matching 48-01/02/03/04's precedent exactly).
**Impact on plan:** No functional scope creep and no behaviour-changing logic introduced. The core intent — prove SC#2 (parity) and D-07 (Manager Override) hold, machine-checkably, and confirm the full build/lint/test gate (SC#4) is clean — is fully met. The per-surface-isolation fix was necessary for the test to be a real cross-surface comparison rather than an accidental same-surface no-op; without it the test would have silently passed for the wrong reason.

## Issues Encountered

`setImmediate` is not available in this project's jsdom Jest test environment (used in an early draft of the microtask-flushing helper). Resolved by chaining 6 native `Promise.resolve().then()` hops instead — sufficient to drain the deepest `.then()` chain exercised by the code under test (`fetch(...).then(r => r.json().then(...)).then(...)`, 3 hops). No production code affected; test-only.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- SC#2 (parity) and SC#4 (build/lint/test gate) are both closed, machine-verified. SC#1 and SC#3 were already closed by plans 02/04.
- Only SC#5 (the live iPad Safari manual verification) remains, plus the D-07 override's live half — both scoped to plan 06 (`checkpoint:human-verify`, `autonomous: false`).
- No blockers identified for 48-06. The parity test in this plan gives 48-06's manual verification a strong automated backstop: if the live iPad session finds any divergence, it is very unlikely to be a payload/auth/override-shape bug (those are now regression-tested) — more likely a genuine hardware/network/UX issue specific to the physical terminal.

---
*Phase: 48-kiosk-pos-de-fork-kiosk-core-js*
*Completed: 2026-07-04*

## Self-Check: PASSED

- FOUND: tests/frontend/kiosk-core-parity.test.js
- FOUND: commit 6b96c58 (Task 1)
- FOUND: commit 11ec8a8 (Task 2)
- FOUND: full frontend suite green (950/950 tests, incl. 3 new parity tests)
- FOUND: middleware suite green (1250/1250 tests, unmodified)
- FOUND: lint clean (eslint js/ --max-warnings 0)
- FOUND: no pre-existing test file modified (git diff --stat -- tests/ shows only the new file added)
- FOUND: `reference_number` present in the parity test (5 occurrences)
- FOUND: `override` assertions present in the parity test (22 occurrences)
