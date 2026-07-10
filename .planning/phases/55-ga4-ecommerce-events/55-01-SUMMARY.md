---
plan: 55-01
phase: 55-ga4-ecommerce-events
requirement: ANALYTICS-01
status: shipped-to-staging-pending-uat
commit: c86b5b3
executed: 2026-07-10
---

# 55-01 Summary — GA4 ecommerce events review + ship

## What was done (T1–T4 push)

**T1 — Review (verdict: clean, money path safe).** Reviewed the uncommitted diff.
- `03-events.js`: all `ga4*` helpers `try/catch`-wrapped (can't throw into checkout, T-55-01);
  `ga4Purchase` dedupes by `transaction_id` via a module-level guard (T-55-02); payload carries
  only order/item fields — no PII (T-55-04); no new dependencies (T-55-SC).
- `12-checkout.js` (money path): `begin_checkout` fires once (inside `if(!_helcimTransactionId)`);
  `purchase` fires only on confirmed Helcim success in BOTH single-cart (after the `!oR.ok` throw
  guard) and dual-cart (success callback) paths, before cart/idempotency state clears, keyed on
  the real `salesorder_number`. **Additive only — no payment/charge/cart logic altered** (T-55-05).
- `11-cart.js` (5) + `07-catalog-kits.js` (1): `ga4AddToCart` beside existing add sites.
- `ga4-ecommerce.test.js`: covers mapping, CAD value, the double-fire dedup, empty-txn, tax-omit.

**T2 — Gates (all green).** Frontend `npm test` 976/57 (incl. the new GA4 test); middleware
`npm test` 1259/77; `npm run lint` clean. `npm run build` is idempotent here — committed bundles
were already in sync with source (GA4 helpers also flow into `admin.js` via shared `03-events.js`).

**T3 — Commit.** One logical change: `c86b5b3` `feat(analytics): add GA4 ecommerce events`.

**T4 (push).** Pushed to staging (`origin/main` @ c86b5b3). Tree clean, sync 0/0.

## Open questions resolved

- **OQ-1 (products.html GTM tag):** NO ACTION — `products.html` already carries the GTM
  container snippet (2 occurrences, identical to index.html). The GA4 plan §3.5 "untagged
  products.html" note is stale.
- **OQ-2 (middleware tests):** Ran both suites — green.
- **OQ-3 (transaction_id):** Uses the real `salesorder_number` (fallback `_checkoutIdempotencyKey`)
  — unique per order and stable across a retry, so GA4 dedup holds.

## Pending (human checkpoint — plan autonomous:false)

- **T4 verify — GA4 DebugView UAT on staging (BLOCKED on Phase 56):** the site events are inert
  until the GTM GA4 event tags exist. Build the 3 event tags in GTM Preview (Phase 56) first,
  then run a staging test order and confirm one `purchase` with populated `ecommerce`
  (`transaction_id`, `value`, `currency:"CAD"`, `items`) + `add_to_cart` + `begin_checkout`, and
  that a success-path replay produces NO second `purchase`. (Or verify via the raw dataLayer now,
  independent of the tags.)
- **T5 — promote to production** after staging approval, per CLAUDE.md deploy flow.

## Review note for the UAT (accuracy, not safety)

Dual-cart **partial failure** (`results.ingredientFailed`): `purchase` fires with
`value: _dualCharge` while excluding the ingredient items. Confirm in DebugView that the reported
`value` matches what was actually charged in that partial-failure case.
