---
phase: 67-kiosk-tax-quote-charge-correctness-pre-charge-total-assertio
reviewed: 2026-08-11T19:02:47Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - js/kiosk-core.js
  - kiosk.html
  - admin.html
  - tests/frontend/kiosk-catalog-freshness.test.js
  - tests/frontend/kiosk-html-escaping.test.js
  - tests/frontend/kiosk-missing-tax.test.js
  - tests/frontend/kiosk-sale-beacon-servererror.test.js
  - zoho-middleware/routes/pos.js
  - zoho-middleware/__tests__/catalog.test.js
  - zoho-middleware/__tests__/pos-precharge-assertion.test.js
  - zoho-middleware/__tests__/pos-tax.test.js
findings:
  critical: 2
  warning: 5
  info: 5
  total: 12
status: issues_found
---

# Phase 67: Code Review Report

**Reviewed:** 2026-08-11T19:02:47Z
**Depth:** standard
**Files Reviewed:** 11 (js/kiosk-core.min.js noted as build artifact, verified regenerated, not reviewed line-by-line)
**Status:** issues_found

## Summary

Reviewed the Phase 67 kiosk tax quote-charge correctness work: fail-closed `computeTax` with the tagged `__taxUnresolved` confirm-path throw, the pre-charge `client_grand_total` assertion, and the client-side missing-tax gate + client totals + checkout-entry catalog force-refresh. Diff range `568c312b~1..HEAD` (11 phase commits). All 62 phase tests pass (45 middleware, 17 frontend).

The orphan-charge invariant was verified and holds: the confirm-path unresolved-tax throw is raised inside the `resolveDiscount(...).then(...)` promise chain (pos.js:1049-1055), so it rejects into the outer `.catch` (pos.js:1450), which routes through `moneyPath.voidWithTimeout` whenever `body.transaction_id` exists and only bare-400s when nothing was charged — matching the existing `__manualVerify` idiom. The sale-path 400s all fire before any Helcim call. The assertion is correctly skipped for absent/non-finite `client_grand_total` (back-compat) and is never applied on the confirm path (where a charge may exist).

However, the review found two Critical defects: (1) the $0.01 assertion tolerance **deterministically false-rejects legitimate discounted sales** because the client and server use different discount-rounding methodologies (verified by simulation — thousands of ordinary cart/discount combinations diverge by $0.02+, and re-ringing cannot fix it); and (2) the fail-closed unresolved-tax guard is **unreachable through the real catalog build**, which launders a genuinely-missing tax into a numeric `0` before `computeTax` ever sees it — so the exact data-error shape this phase claims to fail-close now silently sells at 0% tax (previously 5%).

## Critical Issues

### CR-01: Pre-charge assertion deterministically false-rejects legitimate discounted sales (client/server rounding-methodology divergence)

**File:** `js/kiosk-core.js:731-757` (client discount math) vs `zoho-middleware/routes/pos.js:82-142,159-208,577-583` (server discount/tax math + assertion)
**Issue:** The client and server compute discounted totals with different rounding methodologies, so their grand totals legitimately diverge by more than the $0.01 tolerance on ordinary carts — with identical rates, quantities, tax rates, and discount preset:

- **Percentage discounts** — client rounds the discount **per line** (`d = kioskR2(lt * discount.value / 100)` at kiosk-core.js:735) and sums the rounded values; the server never rounds per line — it sums unrounded `lt * (1 - pct/100)` and rounds the **sum once** (pos.js:130-142). Per-line rounding error accumulates ~half a cent per line.
- **Fixed discounts** — client allocates proportional per-line shares but gives the **last matched line the exact remainder** so the total discount equals the preset value (kiosk-core.js:741-756); the server rounds **every** line's proportional share independently with no remainder correction (pos.js:90-97, 117-123), so the server's effective discount can differ from the preset value by several cents.
- The per-line rounding delta also propagates into the tax base (client taxes `lt - d_rounded`, server taxes `lt * (1 - pct/100)` unrounded), compounding the divergence.

Verified by simulation of both code paths exactly as written: a 3-line cart of $1.50 + $1.95 + 2×$1.50 with a **5% cart discount** produces client total **$6.65** vs server total **$6.67** — `|diff| = 0.02 > 0.01` → 400 `"Totals changed — refresh the product list and re-ring the sale."`. A scan of realistic price grids ($0.95–$30, 5/10/15/20/25% discounts) found **3,033 divergent combinations**. Because the divergence is a pure methodology artifact, it is **deterministic**: refreshing and re-ringing the identical cart reproduces the identical totals and the identical 400 — the sale becomes impossible to complete, and the error message directs staff to a remediation that cannot work. No charge is taken (fail-safe direction), but this is a hard checkout outage for affected discount+cart combinations. Note the phase's own tests never exercise a discounted cart against the assertion (pos-precharge-assertion.test.js uses only single-line, no-discount carts).
**Fix:** Align the client's discount math with the server's before shipping the assertion, e.g. in `kioskCalcTotals`:
```js
// percentage branch — accumulate unrounded, round the SUM once (mirror pos.js resolveDiscount):
matchedIds.forEach(function (id) {
  var entry = cart[id];
  var lt = (parseFloat(entry.item.rate) || 0) * entry.qty;
  var d = lt * discount.value / 100;          // NO per-line kioskR2
  lineDiscount[id] = d;                        // keep unrounded for the tax base
  discountAmount += d;
});
discountAmount = kioskR2(discountAmount);
```
and mirror the server's per-line `Math.round` share allocation (no last-line remainder) in the fixed branch. Alternatively (or additionally, as belt-and-suspenders) widen the tolerance to cover worst-case methodology drift (e.g. `0.01 * (lineCount + 1)`), but methodology alignment is the correct fix — a widened tolerance weakens the detector for real divergence.

### CR-02: Fail-closed unresolved-tax guard is unreachable through the real catalog build — genuinely unconfigured items now silently sell at 0% tax (previously 5%)

**File:** `zoho-middleware/routes/pos.js:190-204` (new unresolved branch) vs `zoho-middleware/routes/catalog.js:818-828` (rebuildKioskCatalog, unchanged by this phase)
**Issue:** `computeTax`'s new unresolved branch fires only when `parseFloat(catalogItem.tax_percentage)` is NaN AND no rule matches AND no `tax_id`. But `rebuildKioskCatalog` — the sole producer of the `zoho:kiosk-products` cache both `computeTax` and the client read — **always writes a numeric `tax_percentage`**, coercing a genuinely-missing value to `0`:
```js
var pct = (detail.tax_percentage !== undefined && detail.tax_percentage !== null)
  ? parseFloat(detail.tax_percentage)
  : (item.tax_percentage != null ? parseFloat(item.tax_percentage) || 0 : 0);  // ← missing → 0
```
So for the exact data-error shape this phase claims to fail-close (no Zoho tax_percentage, no matching rule, no tax_id), the catalog serves `tax_percentage: 0` — a "resolved 0%" per the new contract — and:
1. The server's unresolved branch never fires; the sale proceeds at **0% tax** where the removed fallback charged 5%. The line also carries no `tax_id`, and per this file's own F3 comment (pos.js:992-995) an untagged invoice line is **default-taxed by Zoho** — so the terminal charge (0% tax) undershoots the Zoho invoice total → **partial-paid invoice**, the precise failure mode F3 exists to prevent. The old 5% fallback happened to align the charge with Zoho's 5% GST default; the new code does not.
2. The client's missing-tax gate (kiosk-core.js:774-786) never fires either, since `parseFloat(0)` is not NaN.
3. The test fixtures that make the new fail-closed tests pass (`CATALOG_UNRESOLVED` in pos-precharge-assertion.test.js:155-165, `item-zero`/`item-notax` in pos-tax.test.js) hand-craft catalog entries with **no `tax_percentage` key at all** — a shape `rebuildKioskCatalog` never emits. The tests pass against a catalog shape production cannot produce; the only real-world triggers left for the fail-closed path are exotic (a garbage-string `detail.tax_percentage` → NaN → JSON-serialized `null` in Redis, or a stale pre-enrichment cache entry).

The phase's stated contract ("a missing tax_percentage is a fail-closed data error, never a guess" — kiosk-core.js:237-238, pos.js:261-265) is therefore not delivered end-to-end: the guess moved upstream into catalog.js and changed from 5% to 0%.
**Fix:** Make `rebuildKioskCatalog` preserve unresolvability instead of laundering it, e.g.:
```js
// catalog.js rebuildKioskCatalog — do NOT default to 0 when nothing resolved:
var pct = (detail.tax_percentage !== undefined && detail.tax_percentage !== null)
  ? parseFloat(detail.tax_percentage)
  : (item.tax_percentage != null ? parseFloat(item.tax_percentage) : NaN);
...
tax_percentage: isNaN(pct) ? null : pct,   // null survives JSON; parseFloat(null) is NaN downstream
```
(only for the kiosk catalog path; keep a resolved rule/tax_id item selling as today). Then the existing pos.js and kiosk-core.js fail-closed branches become genuinely reachable and the pos-tax fixtures become representative. Add a catalog.test.js case pinning that an item with no tax_percentage / no rule / no tax_id is served with `tax_percentage: null`, and a pos-tax case driving that shape through the real builder output.

## Warnings

### WR-01: Confirm-path unresolved-tax 400 leaves the confirm idempotency lock held — retry is 409-blocked for up to 5 minutes

**File:** `zoho-middleware/routes/pos.js:1471-1474`
**Issue:** The new no-charge `__taxUnresolved` 400 returns without releasing `confirmIdemKey`. `moneyPath.acquireIdempotencyLock` only replays when a **result** was cached (never on failures); the underlying `lock:` key persists for `IDEMPOTENCY_KEY_TTL` (300s), so a staff retry after fixing the catalog gets `{ status: 'contention' }` → 409 "Confirm already in progress — please wait before retrying" until the TTL expires. The sale-path counterpart added in this same phase (pos.js:579-581) correctly releases the lock on its 400 for exactly this reason ("so a corrected re-ring can retry immediately"); the confirm path's actionable 400 does not.
**Fix:**
```js
if (err && err.__taxUnresolved && !(body && body.transaction_id)) {
  if (res.headersSent) return;
  if (confirmIdemKey) { cache.releaseLock(confirmIdemKey).catch(function () {}); }
  return res.status(400).json({ error: err.message });
}
```
(`confirmIdemKey` is in scope inside `runConfirm`.)

### WR-02: Checkout-entry force-refresh busts the server catalog cache on every checkout, contradicts its own comment, and opens a deleted-cache race against the sale POST — while being unable to affect the totals it exists to protect

**File:** `js/kiosk-core.js:2405-2415` (kioskStartCheckout), `zoho-middleware/routes/catalog.js:897-903`
**Issue:** Three compounding problems with `kioskLoadProducts(true)` at checkout entry:
1. The comment claims "30-min server cache TTL respected", but `forceRefresh` appends `?bust=1`, and the server's bust branch does `cache.del(KIOSK_PRODUCTS_CACHE_KEY)` then a full rebuild (Zoho items list + ~3 uncached `/itemdetails` bulk calls). Every checkout entry — including abandoned ones — now triggers a cold Zoho rebuild, on top of the existing New-Sale and post-sale busts. The TTL is not respected; Zoho quota/429 exposure scales with checkout attempts.
2. Race window: the server deletes the cache **before** the rebuild completes. If staff move through the customer step quickly (or the rebuild is slow/429s), the subsequent `POST /api/kiosk/sale` reads a null catalog → every line "missing" → triggers a second concurrent rebuild at charge time (added latency at the worst moment) or, if Zoho is rate-limited, a spurious `Item not found in current catalog` 400.
3. The refresh cannot change the assertion inputs anyway: cart entries hold references to the **old** item objects, so `kioskCalcTotals` and `client_grand_total` are computed from the pre-refresh rates/tax either way. The refresh only benefits the *next* cart. The stated benefit does not justify costs 1-2.
**Fix:** Drop `?bust=1` here — call `kioskLoadProducts()` guarded by the existing `KIOSK_CATALOG_MAX_AGE_MS` staleness clock (the 57-03 pattern), or add a non-busting refresh mode that re-reads the server cache without deleting it. If a bust is truly wanted, it must not delete-before-rebuild (build the new array first, then overwrite the key).

### WR-03: Missing-tax gate blocks imported-SO payment collection with inapplicable guidance — inconsistent with the sibling phantom guard's explicit scoping

**File:** `js/kiosk-core.js:2497-2503`
**Issue:** The new gate runs **before** the imported-SO checkout fork (kiosk-core.js:2509) and applies to every cart type. The 57-03 phantom guard directly above it is explicitly scoped to exclude imported-SO and recipe carts (`!_kcEnv.getRecipeContext() && !_kioskImportedSoId`, with a comment explaining why: those lines don't come from this catalog). The tax gate has no such scoping. For an imported SO, the amount charged is the SO's Zoho balance via `kioskCollectPayment` — the client's per-line tax resolution is irrelevant to the money path — yet a cart line with unresolvable tax (e.g. a catalog entry whose `tax_percentage` serialized as `null`) blocks payment collection entirely, and the error copy ("Refresh the product list and re-add it") is wrong for SO flows (re-adding is not how SO carts are built; the import maps lines to catalog objects at kiosk-core.js:3638-3646).
**Fix:** Scope the gate like its sibling:
```js
if (!_kioskImportedSoId && totals.missingTaxItem) { ... }
```
(recipe carts cannot currently trigger it — see WR-04 — but adding `!_kcEnv.getRecipeContext()` documents intent).

### WR-04: Recipe carts bypass the fail-closed doctrine and the pre-charge assertion entirely

**File:** `js/kiosk-core.js:1503` (and 1513/1519/1528), `js/kiosk-core.js:2606-2623`
**Issue:** Recipe-cart ingredient lines are built with `tax_percentage: Number(ing.tax_percentage) || 0` — the same silent missing→0% laundering this phase removed elsewhere. A recipe ingredient with missing tax data displays 0% tax and can never trip the missing-tax gate. Separately, `recipeSaleBody` carries no `client_grand_total`/`client_tax_total`, so `/api/kiosk/recipe-sale` gets no quote-vs-charge divergence detection at all — the dynamically-priced path (scaled volumes, modified ingredients, server-side quote) is arguably the highest-divergence surface, and the payment screen displays `totals.total` from these client-side lines while the server charges its own recomputed amount. If recipe scope-out was deliberate, it is not recorded at either code site.
**Fix:** Minimum: change line 1503 to preserve NaN (`parseFloat(ing.tax_percentage)`) so the gate covers recipe carts, or add a code comment documenting why recipe lines are exempt. Follow-up phase: extend the pre-charge assertion contract to `/api/kiosk/recipe-sale`.

### WR-05: Assertion mismatch discards the divergence evidence — no log, no Sentry, and `client_tax_total` is never read by any code

**File:** `zoho-middleware/routes/pos.js:577-584`
**Issue:** The assertion block returns a generic 400 with no `log.warn`, no `eventLog.logEvent`, and no `captureExceptionSafe` — the client total, server total, tax split, and line items are all discarded. The doc comment sells `client_tax_total` as "observability only", but nothing in the codebase reads `body.client_tax_total`; it is dead payload. INV-000160 was diagnosable only because telemetry existed (the 57-01 beacon); a divergence *detector* that records nothing defeats its diagnostic purpose — staff will report "totals changed" errors with no server-side trail to distinguish CR-01-style rounding drift from a real stale-quote incident.
**Fix:** Before returning the 400:
```js
log.warn('[pos/kiosk/sale] pre-charge total mismatch: client=' + body.client_grand_total +
  ' client_tax=' + body.client_tax_total + ' server=' + grandTotal + ' tax=' + taxTotal +
  ' items=' + lineItems.length + ' ref=' + (body.reference_number || ''));
eventLog.logEvent('kiosk.total_mismatch', { client: body.client_grand_total, server: grandTotal });
```

## Info

### IN-01: `kioskItemTax` NaN change is unreachable in production code

**File:** `js/kiosk-core.js:604-613`, `js/kiosk.js:82`, `js/admin.js:9927`
**Issue:** `kioskItemTax` is aliased in both consumers (`var kioskItemTax = KioskCore.itemTax;`) but never invoked anywhere in production code — only kiosk-missing-tax.test.js calls it. The NaN-returning change is therefore safe (no `$NaN` render risk) but is dead code; the unused aliases invite accidental future use without the NaN guard callers would need.
**Fix:** Remove the unused aliases, or note in the function comment that callers must handle NaN.

### IN-02: `validateEnv.js` still documents the retired `KIOSK_TAX_RATE` env var

**File:** `zoho-middleware/lib/validateEnv.js:70`
**Issue:** No code reads `KIOSK_TAX_RATE` after this phase, but the env manifest still lists it ("Tax rate for kiosk sales"), which will mislead future operators into thinking a fallback rate exists.
**Fix:** Remove the entry (or annotate it as retired by Phase 67).

### IN-03: New comments cite fixed line numbers that have already drifted

**File:** `zoho-middleware/routes/pos.js:1044,1470` ("pos.js:816-819 invariant")
**Issue:** The "NEVER bare-400 after a charge" invariant comment actually lives at ~pos.js:881-884; lines 816-819 are inside the client-error scrubber. Line-number references rot with every edit.
**Fix:** Reference the invariant by name/anchor comment (e.g. "CR-01 NEVER-bare-400 invariant at the /confirm route header") instead of line numbers.

### IN-04: Existing pinned tests in pos-tax.test.js were modified (CLAUDE.md rule 10) — documented, but one fixture changed meaning

**File:** `zoho-middleware/__tests__/pos-tax.test.js:80-96,185-320`
**Issue:** Two existing tests pinning the old 5% fallback were rewritten. The in-file comments document this as a sanctioned CONTEXT.md exception (noting for the record per rule 10). One side effect: the `item-zero` fixture changed from **explicit `tax_percentage: 0`** (which the old code charged 5% on — itself a bug for a gift-card item) to a **missing** `tax_percentage`, so the "explicit 0 + no tax_id" shape — whose behavior this phase changed from 5% to 0% — is no longer covered by any test (the new legitimate-0% test uses a rule-resolved item instead).
**Fix:** Add one test for `{ tax_percentage: 0, tax_id: '' }` pinning that an explicit 0 sells at 0% (the new intended behavior).

### IN-05: Client gate and server `computeTax` disagree on the `tax_id`-present/NaN-percentage shape

**File:** `js/kiosk-core.js:774-786` vs `zoho-middleware/routes/pos.js:195-204`
**Issue:** The server treats a NaN `tax_percentage` with a `tax_id` present as resolvable (computes 0% locally, lets Zoho tag the invoice line); the client gate blocks **any** NaN regardless of `tax_id`. A catalog entry in that shape would be client-blocked even though the server would happily sell it. Narrow in practice (see CR-02 — the catalog rarely emits NaN), but the two halves of the same contract should agree; if CR-02's fix makes NaN shapes real, this asymmetry becomes user-visible.
**Fix:** Either mirror the server's `tax_id` exception in `kioskCalcTotals`, or (preferred, simpler) document that the client is deliberately stricter than the server.

---

_Reviewed: 2026-08-11T19:02:47Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
