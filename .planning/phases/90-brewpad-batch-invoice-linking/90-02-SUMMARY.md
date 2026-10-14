---
phase: 90-brewpad-batch-invoice-linking
plan: 02
subsystem: payments
tags: [kiosk, canning-bundle, zoho-tax, money-path, express]
requires: []
provides:
  - zoho-middleware/lib/kiosk-bundles.js (BUNDLES, CAN_SKUS, validateBundleCart, buildBundleLine, buildBundleCanLine, resolveStandardTaxId, isBundleLine, isBundleCanLine)
  - server-priced bundle + $0 can lines at /api/kiosk/sale and /api/kiosk/sale/confirm
  - __tests__/fixtures/canning-bundle-carts.js (shared cart fixtures with expected totals for Plan 90-07)
affects: [90-07, 90-10]
tech-stack:
  added: []
  patterns: [shared bundle helper at both rebuild sites, tagged __bundleInvalid error on confirm]
key-files:
  created:
    - zoho-middleware/lib/kiosk-bundles.js
    - zoho-middleware/__tests__/kiosk-bundles.test.js
    - zoho-middleware/__tests__/pos-canning-bundle.test.js
    - zoho-middleware/__tests__/fixtures/canning-bundle-carts.js
  modified:
    - zoho-middleware/routes/pos.js
key-decisions:
  - "Shared pos.js helper prepareBundleContext (validate + standard tax) so sale and confirm cannot drift; each site only differs in how it reports the error (plain 400 vs tagged throw)"
  - "Bundle line stays custom:true with tax_percentage 12 and the standard tax_id; resolveDiscount and computeTax needed no change"
  - "A bundle_can flag on a custom or gift_cert line is rejected (can lines must be catalog items)"
requirements-completed: [D-11, D-12, D-13, D-14, D-15, D-16, D-22]
duration: ~35min
completed: 2026-10-14
---

# Phase 90 Plan 02: Server-owned canning bundle Summary

The server now prices and taxes the canning bundle ($40 beer-25, $35 cider-23, always 12% with the standard tax_id) plus a $0 can line restricted to the can-473/can-355 SKUs, identically at `/api/kiosk/sale` and `/api/kiosk/sale/confirm`, with client rate, taxable and description ignored.

PLAN_BASE: `821461110d853dc4153ace10df944a3df6ae4443` (the worktree spawned on a different base and was reset to it per the branch check).

## Commits

- `5b1f18a9` Task 1: lib/kiosk-bundles.js, kiosk-bundles.test.js (37 tests), shared fixture
- `a67bd248` Task 2: pos.js wiring at both rebuild sites, pos-canning-bundle.test.js (39 tests)

## RED evidence

- Task 1: with lib/kiosk-bundles.js moved aside the suite failed to load (module not found, 0 tests ran); with it restored, 37/37 pass.
- Task 2: with the pre-change pos.js, `pos-canning-bundle.test.js` ran 39 tests: 32 failed, 7 passed (the 7 are cases where unchanged code already errors for another reason, e.g. qty 101 and the `40.32` client total). After the change: 39/39 pass.

## Results

- Beer bundle alone: subtotal 40.00, tax 4.80, total 44.80 on both routes, even with client rate 0.01 / taxable:false. Cider: 39.20. 60 cans on beer/can-473: still 44.80 (D-12).
- Fixture (c) (bundle, 52 x can-473, 0% kit 80, 12% fee 50, fixed $10 cart discount) matched my hand-computed literals on the first server run: subtotal 160.00, tax 10.34, total 170.34, discount 10.00.
- Pitfall 11: no remainder lands on the $0 can line. Allocation was can 0.00, kit 6.15, fee 3.85 (last matched line absorbs the remainder); the bundle gets no discount (custom, D-14). Nothing looked wrong, so no owner escalation was needed.
- Phase 67 invariant: on confirm, an invalid bundle cart or unresolvable standard tax without `transaction_id` returns 400 and calls `cache.releaseLock('test:idem:confirm:<key>')`; with `transaction_id` the void-on-failure path runs (`voidTransaction('txn-1')`, `payment_voided: true`, no Zoho invoice, no 400).
- `client_grand_total` assertion exists on `/sale` only (44.80 passes, 40.32 gives 400 with no terminal call); none was added to confirm.
- Gate on Node 24.21.0: root `npm test` (178 suites / 2371 tests) and lint pass; middleware `npm test` (217 suites / 3290 tests) and lint pass. No sibling-plan new-test failures were seen. No existing test file was edited; `pos-custom-line` and `pos-tax-rounding-entity-level` pass unedited.

## Deviations from Plan

None - plan executed as written. Notes:

- The helper `prepareBundleContext` lives in pos.js (not lib) because it combines catalog validation with the standard-tax lookup for both routes; the lib exports match the plan.
- The `/sale` handler does not expose its built line items, so cross-route identity is asserted via the terminal-charged total (sale) and the captured-amount verification plus invoice line items (confirm), and via the shared lib builders (unit-tested).

## Known Stubs

None.

## Issues / smells for the owner

- Pre-existing, left alone as instructed: the `gstTaxIdConfirm` bare 400 in `/sale/confirm` (and the bare "Item not found in catalog" 400 just above it) can still reject after a charge exists. A bundle can item missing from the catalog on confirm hits that older bare 400, not the tagged path.
- Bundle lines carry extra fields (`bundle_key`, `bundle_can`) through to the Zoho invoice payload like the existing `custom:true` flag already does; Zoho tolerated that before, but it is worth confirming on the first staging bundle invoice.
- Jest prints "did not exit one second after the test run" for the new pos test (void timeout timer in the real money-path lib); harmless.

## Threat Flags

None beyond the plan's register (T-90-05, T-90-06, T-90-07, T-90-07b mitigated and tested).

## Self-Check: PASSED

Created files and both commits (`5b1f18a9`, `a67bd248`) verified present.
