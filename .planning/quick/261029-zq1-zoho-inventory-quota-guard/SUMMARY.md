---
quick: 261029-zq1
title: Zoho Inventory daily-quota guard
completed: 2026-10-29
status: code complete — staging deploy + flag + prod push pending
---

# Summary

All five planned fixes landed (plus one extra) with regression tests. Frontend 3,304 and middleware 3,949 tests
green on Node 24; root lint clean. No existing tests edited.

| Commit | Change |
|---|---|
| 7b7ae96a | `ZOHO_SCHEDULED_JOBS=off` disables boot pre-warm, 05/13 UTC warm-ups and the 10-min kiosk cron (moved to `lib/catalog-schedule.js`) |
| 073073d3 | Kiosk last-good copy `kiosk:products:lastgood` (+`:at`); `/api/kiosk/products` serves it as `source:'stale'` when the cache is empty and the rebuild fails |
| 8ffb67bc | Website `/api/products` + `/api/ingredients` last-good copies, served before the July repo snapshot |
| 74cb4f5f | Kiosk UI notice for `source:'stale'` ("Showing saved catalogue — stock may be a few minutes old") |
| 415b3bc5 | 6 h per-item `/itemdetails` cache (`zoho:itemdetail:<id>`); `{force:true}` for `?bust=1` / admin clear |
| 73f06377 | `lib/zoho-quota.js`: captures `x-rate-limit-*` headers; code-45 429 or remaining 0 blocks Inventory calls until reset; never retried |
| 9feaf781 | Background refreshes skip below `ZOHO_QUOTA_RESERVE` (250); `/health` exposes quota |
| 34c27e9b | `lib/zoho-quota-alert.js` + `mailer.sendZohoQuotaAlert`: one email/WARN/Sentry per env per quota day below `ZOHO_QUOTA_ALERT` (300) and on exhaustion |
| 3393a1dd | Extra: `?bust=1` restores the previous kiosk cache if the rebuild fails (otherwise a Refresh tap during exhaustion breaks every sale until reset) |

## Deviations
- Last-good copies use a 30-day TTL (the shared `cache.set` always sets one); every successful rebuild rewrites them.
- Website checks last-good before the repo snapshot (snapshot is dated 2026-07-08).

## Open decision (owner)
Kiosk sales (`pos.js` processSale, `pos-recipe.js` getFeeCatalogMap) read prices from the 30-min `zoho:kiosk-products`
cache and do not use last-good. If Inventory is unavailable > 30 min after the last good rebuild, the kiosk shows the
saved catalogue but catalogue-item sales return 400 "Item not found in current catalog".

## Ungated Inventory callers (interactive/manual)
`routes/taxes.js` bulk tax run (one PUT per item — can cost hundreds of calls), `routes/purchaseorders.js`,
`routes/items.js`, `/api/services`, `/api/snapshot` (GitHub workflow 06:00 UTC), admin cache-clear, sale-time rebuilds;
scripts `tag-subcategories.js` and `backfill/batch-type-backfill.js` bypass the guard entirely.

## Calls/day estimate
Before ≈ 1,300+ across both envs. After: production ≈ 250–450, staging ≈ tens (tester-driven only). Background work
stops at 250 remaining.

## Deploy
`ZOHO_SCHEDULED_JOBS=off` on staging only. Optional `ZOHO_QUOTA_RESERVE`, `ZOHO_QUOTA_ALERT`. Alerts go to
`CONTACT_TO` via Resend. No CSP changes.

## Incident mitigation already applied (2026-10-29 ~18:00 PT)
Extended prod Redis TTL on `zoho:products`, `zoho:products:ts`, `zoho:ingredients` to 8 h so the website kept serving
the current catalogue past the midnight quota reset instead of falling back to the July snapshot.

## Follow-up: sale path uses last-good (owner-approved)
Resolves the "Open decision (owner)" above (approved 2026-10-29). Commit `8a381d33`.

- New `lib/kiosk-sale-catalog.js` `getKioskCatalogForSale()` is the single source for sale pricing:
  live `zoho:kiosk-products` → one rebuild → `kiosk:products:lastgood` **only when the rebuild fails**
  (quota exhausted / 429 / cooldown / outage). No last-good copy → the rebuild error is rethrown and the
  existing responses are unchanged.
- `pos.js` processSale (sale-time 57-04 auto-reconcile), `runConfirm` (no rebuild, as before — post-charge
  path; it now uses last-good when the live cache cannot price the cart, so a sale priced stale on `/sale`
  cannot then bare-400 on confirm after the card is charged) and `pos-recipe.js` getFeeCatalogMap use it.
- Stale sales log one WARN with the last-good timestamp on `/sale` (confirm logs info) and add
  `catalog_source: 'stale'` to `kiosk.sale_stage_timing` (catalog_read), `kiosk.sale_completed` and
  `kiosk.recipe_sale_completed`. The recipe path warns from getFeeCatalogMap, i.e. once per leg (quote/sale and confirm).
- Unchanged: price maths, tax (CR-02 null tax still fails closed), stock, idempotency, void-on-failure.
  An item absent from both live and last-good still returns 400 "Item not found in current catalog".
  Minor: when the rebuild fails with no last-good copy, the 400 names the first catalog line rather than the first line missing from the cache.
- Tests: `__tests__/kiosk-sale-catalog-lastgood.test.js` (12), `__tests__/pos-recipe-fee-lastgood.test.js` (6);
  6 fail on the old code. Frontend 3304/3304, middleware 3967/3967 (Node 24.21), lint clean.
- Not pushed or deployed.
