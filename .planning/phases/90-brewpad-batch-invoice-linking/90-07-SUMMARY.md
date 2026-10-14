---
phase: 90-brewpad-batch-invoice-linking
plan: 07
subsystem: frontend-kiosk
tags: [kiosk, canning-bundle, money-path, es5]
requires: [90-02, 90-04]
provides:
  - KioskCore.CANNING_BUNDLES, addCanningBundle, removeCanningBundle, setBundleCanCount, bundleOverCap
  - standalone-kiosk canning bundle picker modal (showCanningBundleModal env hook)
  - corrected can counts on custom-labels.html
affects: [90-10, 90-11]
key-files:
  created:
    - tests/frontend/kiosk-canning-bundle.test.js
    - tests/frontend/kiosk-canning-bundle-parity.test.js
    - tests/frontend/custom-labels-copy.test.js
  modified:
    - js/kiosk-core.js
    - js/kiosk.js
    - css/kiosk.css
    - custom-labels.html
metrics:
  tasks: 3
  completed: 2026-10-14
---

# Phase 90 Plan 07: Kiosk canning bundle (client) Summary

The standalone kiosk can add a one-tap canning bundle ($40 beer 25 L / $35 cider 23 L, 12% tax) as a fixed-price line plus a $0 can line at the actual count. The client table and display totals are pinned to the server by a parity test against `lib/kiosk-bundles.js` and the shared fixture.

PLAN_BASE: `0c7e91cdd990105527e90d7e6c91e5b9197531c2` (the worktree spawned behind it and was reset to it per the branch check).

## Commits
- `d64c4b8f` Task 1: core lifecycle, cart rendering, payload fields, exports, CSS, bundle + parity tests
- `4ffa95a7` Task 2: picker modal in kiosk.js, modal CSS, modal tests
- `0fd88c2c` Task 3: custom-labels.html copy + copy test

## Key points
- Cart keys are fixed: `bundle-line` and `bundle-can`. Adding rebuilds the cart so these are the FIRST keys. The `kioskCalcTotals` discount code is untouched (the `D-08` custom/gift_cert skip line is byte-identical), so a fixed discount's last-line remainder never lands on the $0 can line: fixture (c) shares are can 0.00, kit 6.15, fee 3.85.
- The can line is a shallow copy of the catalog product with `rate: 0, bundle_can: true`; a test asserts the catalog product keeps its rate and gets no flag.
- `kioskSetQty('bundle-line', n)` is a no-op re-render (qty pinned 1). Can-line qty goes through `kioskSetBundleCanCount` (integer, clamped 1..100). Stepping the can line to 0 removes both lines. Removing either line, or clearing the cart, removes both.
- Over-cap (beer 55/72, cider 50/68) is an inline `.kiosk-bundle-cap-warn` with an "OK, one batch" button; `confirm()` is never called (asserted with a spy). When the modal's tick is used the cart does not re-warn.
- Opener `#kiosk-canning-bundle-btn` renders only when `showCanningBundleModal` is a registered function (kiosk.js yes, js/admin.js untouched, grep = 0) and not in a recipe cart; shows disabled "Bundle added" while a bundle exists.
- Payload: bundle line sends `bundle_key` (rate 40/35 for display only; server re-prices), can line sends `bundle_can: true, rate: 0`. `client_grand_total` for the beer bundle alone is 44.80.
- custom-labels.html used no multiplication character, so plain "x" was used: "a 25 L beer batch is about 70 x 355 mL cans or about 52 x 473 mL cans". Wine wording unchanged.

## Parity result
Client `CANNING_BUNDLES` deep-equals server `BUNDLES`. All 3 fixture carts match the server's literals (44.80, 39.20, 170.34 with discount 10.00). The fixture's `subtotal` is post-discount, so the test compares `subtotal - discount`.

## Deviations from Plan
- **TDD order (acknowledged):** implementation of Task 1 was written before its test files, so no RED run was captured (same deviation as 90-04). Tests pass on first meaningful run after one harness fix (the standard-sale test must click the gift-card panel "Proceed to Terminal" button before `/api/kiosk/sale` is posted). Task 2 modal tests were also written after the code. Task 3 test was written before the edit but not run red.
- **Rule 1 (test bug):** one modal test selected `.kiosk-bundle-cap-warn` globally and matched the modal's own block; scoped to `#kiosk-cart-items`.
- **UI-SPEC copy:** cart can-line name keeps the catalog name with an "Included in bundle" note under it (not a separate "x 52" label) because the existing row layout already shows the qty stepper and line total.
- The bundle line also carries `name` (= description) so the existing cart row and payment-screen item list render it.

## Gate results (Node 24.21.0)
Final run (after Task 3): root 187 suites / 2474 tests pass, lint clean; zoho-middleware 218 suites / 3308 tests pass, lint clean. No sibling-plan new-test failures observed. No existing test edited; no build artifacts, `?v=` stamps, STATE.md or ROADMAP.md touched. The real-PG suites did not time out.

## Known Stubs
None.

## Issues / smells for the owner
- The payment-screen item list (`kiosk-payment-items`) prints `it.name`; custom lines elsewhere have no name there (pre-existing). Bundle line is fine because it carries `name`.
- `kioskCheckStockOverflow` is deliberately not applied to cans (negative inventory is an intentional oversell path).
- Admin-embedded kiosk gets no bundle opener (D-25), which overrides UI-SPEC Q10.

## Threat Flags
None beyond the plan's register (T-90-29..T-90-33): T-90-30 and T-90-31 mitigated and tested; cart labels go through `escapeHTML`, modal labels come from the constant table.

## Self-Check: PASSED
Commits `d64c4b8f`, `4ffa95a7`, `0fd88c2c` and the three new test files verified present.
