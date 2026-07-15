---
phase: 57-kiosk-sale-blocking-recovery
artifact: DIAGNOSIS
status: confirmed
captured: 2026-07-15
capture_method: owner reproduced live at the shop + photographed the error (NOT the 57-01 beacon — see "Beacon findings")
confirmed_cause: h5-stale-catalog (NONE of the 4 planned hypotheses — h1-auth / h2-wake / h3-surface / h4-server)
---

# 57-DIAGNOSIS — the "refresh to sell" kiosk error

## The actual error (owner photo, 2026-07-15)

```
Terminal Error
Item not found in current catalog: 1099000000000109115.
Refresh the product list and try again.
[Try Again]  [Back to Cart]
```

## Confirmed root cause — stale/phantom client catalog, hard-rejected server-side

Traced end to end against source + live Zoho:

1. **Where it throws:** `zoho-middleware/routes/pos.js:325-332`. On every kiosk sale
   the middleware builds an `item_id → entry` map from the server's cached catalog
   (`KIOSK_PRODUCTS_CACHE_KEY`) to **anchor the price server-side** (it deliberately
   will NOT trust client-supplied rates). If a requested `item_id` is absent from
   that cache, it hard-rejects: `400 { error: "Item not found in current catalog:
   <id>. Refresh the product list and try again." }`.

2. **Where it displays:** `js/kiosk-core.js:2745` — `kioskShowError('Terminal Error',
   result.data.error, true)`. This is the **`.then(result)` server-error branch**,
   handling a non-ok HTTP response.

3. **Why the item is missing:** the offending `item_id` **1099000000000109115 does
   not exist in Zoho** — `get_item` returns `1002 "the item you are looking for is
   not available"`. (It is also 19 digits; valid Zoho item IDs are ~18.) So the
   kiosk CLIENT presented a catalog entry that no longer maps to a real item, staff
   added it to the cart, and both the server cache and Zoho correctly reject it at
   checkout.

4. **Why "Refresh the product list" fixes it:** the refresh re-fetches
   `/api/kiosk/products` (rebuilding the catalog), replacing the stale/phantom entry
   with the current catalog — after which the sale completes.

**In one line:** the kiosk client holds a STALE catalog containing an item that no
longer exists server-side/in Zoho; the server's price-anchoring guard hard-rejects
the sale; the only recovery today is a manual product-list refresh.

This is **not** any of the four planned hypotheses. They all assumed the catalog
*failed to load* (auth/wake/network/server). In reality the catalog loads fine — the
client's catalog is simply **stale**, and the *sale* is rejected, not the load.

## Beacon findings — TWO things to feed back into 57-03 / a beacon fix

The 57-01 beacon did **not** capture this, for two independent reasons. Both are
real and worth fixing:

1. **Wrong code path.** This error is a server 400 handled in the `.then` branch
   (`kiosk-core.js:2745` → `handleSaleResult`), NOT the network-`.catch` the beacon
   was wired into (2570/2596). 57-01 explicitly deferred the non-ok-HTTP-on-sale
   case. To auto-capture this class in future, the beacon must also fire from the
   server-error branch of the sale result handler.

2. **PAN-redaction would have destroyed the evidence.** The beacon redacts any 13-19
   digit run as `[REDACTED]` (T-57-01, anti-PAN). The item id here is **19 digits**,
   so had the beacon captured this message it would have logged *"Item not found in
   current catalog: [REDACTED]"* — losing the one field that made the diagnosis
   possible. Zoho item IDs (18-19 digits) collide with the card-number heuristic.
   The redaction needs narrowing (e.g. only redact when preceded by card-ish
   context, or exempt the known `item_id:` shape), or the beacon should send the
   item_id as a structured, non-redacted field.

The owner's photo is what actually delivered the diagnosis. That's a good outcome,
but the beacon should be able to do it unattended next time.

## Recommended fix direction for 57-03 (branch: h5-stale-catalog)

The goal is to remove the manual-refresh workaround so a sale self-heals. Options,
best first — 57-03 should pick one, RED-first, and verify on the live iPad:

- **(A) Server-side auto-reconcile (preferred).** On a catalog-miss in
  `pos.js:325-332`, force ONE catalog refresh (the same `?bust` rebuild the manual
  refresh triggers) and re-check before rejecting. A genuinely-current item then
  succeeds without staff action; a genuinely-invalid item still rejects (correctly).
  Keeps price-anchoring intact. Bounded to one refresh per sale to avoid a hot loop.
- **(B) Client freshness at checkout.** Have the kiosk refresh its catalog (or send
  a catalog version the server can validate) before submitting a sale, so a
  long-open iPad never checks out against a stale grid.
- **(C) Both** — (A) as the safety net, (B) to reduce how often it's hit.

Also (independent, small): extend the beacon to the sale server-error branch and
fix the item-id redaction collision (see Beacon findings) so this is observable.

**Do NOT** simply shorten the server catalog cache TTL and call it fixed — that
narrows the window but does not make the sale self-heal, and the root divergence
(client showing items the server won't accept) remains.

## Next

57-03 is now unblocked. Its Task 0 decision gate selects **branch h5-stale-catalog**
(a fifth branch beyond the four the plan drafted — the plan anticipated the fix
would be keyed to the diagnosis; this is that key). Recommend re-running
`/gsd:plan-phase 57` to collapse 57-03 to a clean single-branch fix plan around
option (A), OR execute (A) directly with a regression test.
