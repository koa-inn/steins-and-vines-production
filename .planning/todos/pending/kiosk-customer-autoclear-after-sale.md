---
title: Kiosk — auto-clear selected customer after a completed sale
status: pending
created: 2026-07-08
source: owner (during v4.5 auth cutover, Task 2)
area: kiosk POS
priority: medium
---

## What

On the shared kiosk, the selected customer persists after a sale completes — the
next sale starts with the previous customer still attached instead of resetting to
walk-in. On a shared iPad this risks attributing a sale to the wrong customer.

## Desired behaviour

After a sale is confirmed/booked (and the cart resets for the next customer), also
reset the selected customer back to walk-in — clear `_kioskCustomer` and update the
"Customer: …" label to "Walk-in".

## Where

- **Deployed now (production = origin/main):** `js/kiosk.js` — the post-sale reset
  path (where the cart clears after `confirmSale` success). `_kioskCustomer` and the
  cart-customer label (`kiosk-cart-customer-search` / "Customer: Walk-in") are not
  reset there.
- **Current codebase (local main, post Phase 48):** logic now lives in
  `js/kiosk-core.js`. There is a `_kcEnv.setCustomer(null)` at ~line 2015, but confirm
  it is NOT the post-sale success path — the reset must fire after a completed sale
  (the `saleCompleted`/receipt path), on BOTH surfaces (kiosk + admin) via KioskCore.

## Notes

- Add a regression test (parity test can assert customer resets to null after a
  completed sale on both surfaces).
- Deploys to production only with the next kiosk deploy (Phase 48 / Stage 3 of the
  cutover), unless cherry-picked onto origin/main for an earlier standalone deploy.
