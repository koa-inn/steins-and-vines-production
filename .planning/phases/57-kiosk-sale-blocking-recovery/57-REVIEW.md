---
phase: 57-kiosk-sale-blocking-recovery
reviewed: 2026-07-15T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - js/kiosk-core.js
  - zoho-middleware/routes/pos.js
  - zoho-middleware/routes/catalog.js
  - tests/frontend/kiosk-catalog-freshness.test.js
  - tests/frontend/kiosk-sale-beacon-servererror.test.js
  - zoho-middleware/__tests__/pos-sale-autoreconcile.test.js
  - zoho-middleware/__tests__/pos-client-error-itemid.test.js
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 57: Code Review Report

**Reviewed:** 2026-07-15
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Phase 57 hardens the kiosk money-path against the confirmed stale-catalog sale-blocker
(57-DIAGNOSIS.md). Three mechanisms were reviewed against the adversarial focus areas:

1. **Server bounded auto-reconcile (57-04, `pos.js` `processSale`)** — VERIFIED CLEAN on
   the primary concerns. The "one rebuild per sale" bound is genuinely enforced:
   `findMissingCatalogItem` returns the *first* missing id, `rebuildKioskCatalog()` is called
   exactly once regardless of how many lines miss, and the re-check runs against the rebuilt
   map with no loop. There is no unbounded rebuild loop and no per-miss rebuild (confirmed by
   Test C). Price-anchoring survives the reconcile: `continueSaleWithCatalog(rebuiltMap)` reads
   `catalogItem.rate` from the rebuilt catalog and never falls back to `item.rate`, and a
   genuinely-phantom item still 400s after the single rebuild (Tests B and D confirm). The
   rebuild-rejection path is handled inline via `.then(onFulfilled, onRejected)` so a rebuild
   failure falls back to the original 400 without a double `res` send.

2. **`item_id` un-redaction (57-04, `pos.js` `/api/kiosk/client-error`)** — The free-text
   `message` field keeps its full 13-19-digit PAN redaction unchanged (Test C confirms). The
   new `item_id` field is a *separate*, strictly-shaped exemption (`/^\d{17,19}$/`) so a
   15/16-digit card cannot be smuggled as a fake item_id. One residual asymmetry remains
   (WR-01): 17-19 digit values — a valid PAN length range — bypass the item_id shape check
   un-redacted.

3. **Client self-heal (57-03, `kiosk-core.js`)** — The wake/staleness refresh cannot recurse
   or stampede: `kioskLoadProducts` early-returns on `_kioskProductsLoading`, the staleness
   branch re-checks `!_kioskProductsLoading`, and a successful load resets
   `_kioskProductsLoadedAt`, closing the 10-minute window. `pageshow` + `visibilitychange`
   double-fire is absorbed by the loading guard. The pre-checkout phantom guard is correctly
   scoped and not bypassable beyond its documented scope (empty/never-loaded catalog and
   recipe/imported-SO carts intentionally defer to the server backstop). ES5 compliance holds:
   no arrow functions, `let`/`const`, template literals, or ES6 array methods were introduced
   by the phase-57 hunks (the only `Object.assign` is pre-existing module-48 code, out of
   scope).

Net: no BLOCKER-class defects found. Two WARNING-level hardening gaps and three INFO items,
detailed below. Given this ships to a prod kiosk with no staging middleware, WR-02 (Zoho
quota amplification) is worth an explicit decision before deploy.

## Warnings

### WR-01: `item_id` beacon field leaves 17-19 digit PANs un-redacted (redaction asymmetry)

**File:** `zoho-middleware/routes/pos.js:780-791`
**Issue:** `scrubClientErrorText` redacts any 13-19 digit run in `message` as a PAN-shape
heuristic, but the new `item_id` field is stored un-redacted whenever it matches
`/^\d{17,19}$/`. Valid card PANs run 13-19 digits (ISO/IEC 7812; 19-digit Visa/Maestro
formats exist), so a 17-, 18-, or 19-digit card number submitted in `item_id` by a hostile —
but authenticated (device-token) — client is written un-redacted into Sentry tags
(`tags.item_id`) and the `log.warn` line. The inline comment justifies narrowing to exclude
15/16-digit cards but does not acknowledge that 17-19 digit PANs still pass. No legitimate
flow ever places a card number here (the extracted id always originates from the server's
`"...catalog: <zoho-id>"` message, and card PANs never enter kiosk JS), so this is a
defense-in-depth gap rather than an active leak — hence WARNING, not BLOCKER. But the
protection is strictly weaker than the `message` field it sits beside, on a PCI-sensitive path.
**Fix:** Reuse the same PAN scrub on the validated value, or narrow the accepted shape so it
cannot overlap a full PAN length, e.g. only accept ids that begin with the known Zoho prefix:
```js
// Zoho Books/Inventory item_ids in this org are 18-19 digits starting "109" / "1099".
var validatedItemId = /^\d{17,19}$/.test(rawItemId) && scrubClientErrorText(rawItemId, 40) === rawItemId
  ? rawItemId : null;
// or, tighter: /^109\d{15,16}$/.test(rawItemId)
```
If the residual is intentionally accepted, state the 17-19-digit PAN carve-out explicitly in
the comment so the next reader does not assume item_id is PAN-safe.

### WR-02: Catalog-miss now triggers an uncached `fetchItemDetailsBulk` per sale attempt (Zoho quota amplification)

**File:** `zoho-middleware/routes/pos.js:354-378` → `zoho-middleware/routes/catalog.js:802-872`
**Issue:** Before 57-04 a catalog-miss returned 400 with zero Zoho calls. Now each miss calls
`rebuildKioskCatalog()`, which runs `fetchItemDetailsBulk(itemIds)` (~3 Zoho detail calls for
~250 items) on *every* attempt. The 60s `fetchAllItemsCached()` layer only dedups the *list*
call — the bulk detail fetch is not cache-guarded, so a cart that keeps a genuinely-phantom
line re-pays the full ~3-call detail fetch on each retry. `/api/kiosk/sale` is bounded to
10 req/min/IP by `paymentLimiter` (server.js:500-508, 541), which caps this at ~30 detail
calls/min/IP — but on a single-IP prod kiosk with no staging, a stuck phantom line (or a
staff member repeatedly tapping through a 400) can still burn Zoho quota and trip the
`_productsCooldownUntil` / `_rawItemsCooldownUntil` 429 cooldown, which then blocks *legitimate*
catalog refreshes for 90s. The team's commit message accepts "cross-request residual," but the
review flags that the residual is more expensive than the raw-list cache implies.
**Fix:** Short-circuit repeated rebuilds for a known-missing id, e.g. cache a small
"recently-rebuilt" timestamp and skip the rebuild if one ran in the last N seconds:
```js
if (missingItemId !== null) {
  var sinceRebuild = Date.now() - _lastKioskRebuildAt;
  if (sinceRebuild < REBUILD_MIN_INTERVAL_MS) {
    return res.status(400).json({ error: 'Item not found in current catalog: ' + missingItemId + ...});
  }
  _lastKioskRebuildAt = Date.now();
  return catalogRoutes.rebuildKioskCatalog().then(...);
}
```
Alternatively, confirm `fetchItemDetailsBulk` results are cached upstream; if not, that is the
cheaper place to bound the cost. At minimum, document the accepted per-IP ceiling before the
prod deploy.

## Info

### IN-01: Client item_id extraction regex (`\d{15,}`) inconsistent with server validation (`\d{17,19}`)

**File:** `js/kiosk-core.js:2813` vs `zoho-middleware/routes/pos.js:781`
**Issue:** The client extracts the offending id with `saleErrMsg.match(/(\d{15,})/)` (15+
digits, greedy) but the server only accepts `/^\d{17,19}$/`. A 15/16-digit id would be sent by
the client yet silently dropped server-side, and the greedy `\d{15,}` could over-capture a
longer run. Harmless for the real 18-19-digit Zoho ids in play, but the two shapes should
agree so the field behaves predictably.
**Fix:** Align the client regex to the server contract, e.g. `saleErrMsg.match(/\b(\d{17,19})\b/)`.

### IN-02: `rebuildKioskCatalog` JSDoc claims "cold Zoho refetch" but reuses the 60s raw cache

**File:** `zoho-middleware/routes/catalog.js:788-803`
**Issue:** The doc-comment says the function forces "a cold Zoho refetch," but it calls
`fetchAllItemsCached()`, which serves `_rawItemsCache` for up to 60s. An item created/reactivated
in Zoho within the last 60s can therefore remain absent from the rebuild, so the sale-time
auto-reconcile can still 400 a genuinely-current item inside that window. The diagnosed
variant-1 case (30-min stale KIOSK cache) is well outside 60s and is fixed, so impact is
narrow — but the comment overstates the guarantee.
**Fix:** Reword the comment to "cold refetch of the KIOSK_PRODUCTS cache (raw list may be served
from the ≤60s `fetchAllItemsCached` layer)," or bypass the raw cache for the reconcile path if a
truly-cold fetch is required.

### IN-03: Idempotency lock not released on the phantom-item 400 after lock acquisition

**File:** `zoho-middleware/routes/pos.js:254-267, 355-378`
**Issue:** When a sale runs under an acquired idempotency lock and then hits the phantom 400
(item absent even after rebuild), the lock is left held (TTL 300s) with no cached response.
A retry reusing the *same* `idempotency_key` will hit `contention`/`failclosed` and return
409 "Sale already in progress" rather than a clean 400. This is a pre-existing pattern (any
in-`processSale` 400 leaves the lock held) and impact is low: the self-heal path never reaches
this 400, and retrying a genuinely-phantom item is futile anyway. Noted for completeness since
57-04 introduces a new 400 branch under the lock.
**Fix:** If a cleaner retry UX is wanted, release the lock before the phantom 400
(`cache.releaseLock(idempotencyKey)`), mirroring the terminal-push-failure release at
pos.js:643-645. No money has moved at this point, so release is safe.

---

_Reviewed: 2026-07-15_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
