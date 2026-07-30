---
status: diagnosed
created: 2026-07-30
source: owner handoff (INV-000160, kiosk ref KIOSK-1785367461820, Helcim txn 52320110)
severity: high
area: kiosk money-path (quote vs charge)
---

# Kiosk under-quotes tax on some items (quote ≠ charge)

## Symptom
Kiosk-displayed total (~$300.30) was $15.12 lower than the card charge / Zoho invoice ($315.42).
Delta = exactly 7% PST on the $216 champagne-bottle line: kiosk taxed it 5%, Zoho/Helcim 12%.

## Investigation results (2026-07-30)

1. **Live catalog payload is CORRECT today.** `GET /api/kiosk/products` (public cached read,
   `svmiddleware-production.up.railway.app`) returns for SKU `750-champ-fl`:
   `tax_percentage: 12`, `tax_name: "GST + PST"`, `tax_id: 109900000000029101`,
   `sales_tax_rule_id: 109900000000033423` (standard rule → 12 via `_TAX_RULE_PCT`).
   Same values as reference item `375-bor-br`. Enrichment resolves this item correctly now.

2. **Enrichment path** (`rebuildKioskCatalog`, catalog.js ~802-872): runs for ALL items —
   `fetchItemDetailsBulk` covers every sellable item in chunks of 100, no cap. Resolution
   order: `detail.tax_percentage` → `item.tax_percentage` → 0; compound-sum of
   `detail.taxes` only when pct is falsy; then `_TAX_RULE_PCT[sales_tax_rule_id]`
   OVERRIDES everything (033423→12, 033417→5 "GST Only - Services", 033411→0, 033429→15).
   NOTE: the `/api/products` path (l.186-197) sums `detail.taxes` unconditionally;
   the kiosk path only when `!pct` — inconsistent but both land on 12 here.

3. **Cache invalidation:** Redis `KIOSK_PRODUCTS_CACHE_TTL = 1800s` (30 min), TTL-only —
   no Zoho webhook busting. Manual `?bust=1` (auth: legacy/session/device). Server-side
   sale-time auto-reconcile (57-04) rebuilds once when a cart item is MISSING from the
   server cache. **The bigger staleness locus is the CLIENT: the kiosk page's in-memory
   `_kioskProducts` refreshes only on page load, "New Sale" tap, manual refresh button,
   and post-sale — no periodic refresh. An idle/parked kiosk quotes from an arbitrarily
   old catalog.**

4. **Quote vs charge are computed independently, no guard.** Server (`/api/kiosk/sale`)
   ignores client `rate`/`tax_total`, anchors prices+tax to the CURRENT Redis catalog
   (`computeTax`, pos.js) and charges `grandTotal` on Helcim. The kiosk displays its own
   client-side math from its in-memory catalog. Nothing asserts the two match — the body
   already carries `tax_total` but it is documented-ignored rather than compared.

## Root-cause assessment

The middleware/Zoho side was RIGHT at sale time (charge == invoice == 12%). The wrong 5%
lived in the kiosk device's in-memory catalog. Two mechanisms produce exactly 5% client-side:

- **A (most likely): stale in-memory snapshot carrying 5.** The item (created 2026-07-23)
  plausibly spent a window with GST-only/default tax before the compound rule was set;
  any payload built in that window carries `tax_percentage: 5`, and a kiosk page that
  loaded it keeps quoting 5% until one of the four refresh triggers fires.
- **B: NaN→null→5% fallback chain.** Server-side pct can be `NaN` (`parseFloat` of a
  non-numeric detail value with empty `detail.taxes` and no rule); `JSON.stringify(NaN)`
  → `null` in the cached payload; client `parseFloat(null)` → NaN → silent
  `KIOSK_TAX_RATE_DEFAULT` 5% (kiosk-core.js:768).

Both are enabled by the same design gaps:
- Client silent 5% fallback (kiosk-core.js:767-768) — and inconsistent with line 605
  (`|| 0`) and with server `computeTax` (`!pct && !tax_id` → 5%).
- No pre-charge assertion client total == server grandTotal.
- No client catalog freshness guarantee at cart/checkout time.

## Proposed fixes (not yet implemented)
1. Remove silent 5% fallbacks (client NaN→5, server `!pct&&!tax_id`→5): treat missing
   tax as a data error — flag the item, block or warn, never guess.
2. Pre-charge assertion: server compares client-displayed total (already sent as
   `tax_total`/derivable) with its `grandTotal`; on mismatch reject with a
   "totals changed — refresh and re-ring" error instead of charging.
3. Client freshness: re-fetch catalog when starting a cart / before checkout (or a
   30-min interval matching the server TTL).
4. Optional hardening: webhook/`?bust=1` on Zoho item create/update; unify the
   compound-tax sum behavior across catalog.js paths.
5. Tests per handoff: compound-tax item resolves 12; missing tax_percentage does not
   silently 5%; integration kiosk total == server total.

## Open questions
- Zoho item audit history for `750-champ-fl` (was tax GST-only between 07-23 and the
  fix?) — visible in Zoho UI item history; would confirm mechanism A over B.
- Whether server `grandTotal` (computeTax) can diverge from the Zoho invoice total
  (Zoho applies its own tax rules at invoice creation) — same class of seam, worth the
  same assertion server-side.
