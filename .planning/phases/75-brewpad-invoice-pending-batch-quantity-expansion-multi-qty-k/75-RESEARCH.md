# Phase 75: BrewPad invoice→pending-batch quantity expansion — Research

**Researched:** 2026-08-26
**Domain:** Node.js/Express middleware (`zoho-middleware/`) + Google Apps Script batch store (`apps-script/adminApi.gs`) + vanilla ES5 frontend (`js/brewpad.js`)
**Confidence:** HIGH — root cause located with file:line evidence and cross-verified against an almost-identical prior bug (INV-000137) that was already fixed on the sibling code path.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (REVISED 2026-08-26 by owner — see "Open Questions (RESOLVED)" Q1):** Future-automatic + one-time manual backfill for the pre-fix invoice. The idempotent fix makes every *future* multi-qty kit invoice yield N pending batches automatically; the single pre-fix invoice INV-000171 is corrected by a one-time manual single-invoice re-import (`GET /api/batch/scan-invoices?number=INV-000171`) after the prod deploy. The date-window "Pull from Zoho" skip filter (`pos.js:3156-3160`) is intentionally NOT modified in this phase. Idempotency remains essential — re-import and re-poll must never duplicate (D-02 + stable per-unit identity); the regression suite must prove idempotency across repeated polls. *(Original text: "Auto-backfill on next reconcile... self-corrects from 1 → 3 with no manual step" — relaxed because no automatic re-scan resurfaces an already-linked invoice; delivering literal auto-backfill would require a higher-risk change to the skip filter overlapping Phase 62/63.)*
- **D-02:** Reconcile: pending_to_add = invoice_line_qty − batches_already_existing_for_that_line. Always converge the total batch count (pending + already-created) to exactly the invoice line quantity (capped per D-04). Never blindly create N; count what already exists for the line first so units already turned into real/activated batches (e.g. via the sale path) are not duplicated. Attributing an existing batch to a specific invoice line is a research detail (likely via the Phase 63 batch↔invoice link fields).
- **D-03:** Per-unit label "Unit X of N" on each pending batch (e.g. "30L Amber Kit — Unit 1 of 3 / 2 of 3 / 3 of 3") so staff can track and activate them distinctly. `js/brewpad.js` batch-list rendering. Ordinal is derived from the per-unit identity, stable across re-render.
- **D-04:** Match the sale path — cap by paid fermentation slots. Expand to `min(kit_line_qty, makers_fee_slots_paid)`, consistent with `createBatchesFromSale`/`makersFeeSlots`/`planKitBatches` and the `MAX_BATCHES_PER_KIT_LINE` (=100) fat-finger guard. Do not create batches for slots that weren't paid for. If the invoice lacks a usable Maker's Fee quantity (legacy/edge), fall back to kit-line quantity (mirror the sale path's legacy fallback).

### Claude's Discretion

- The exact per-unit identity / idempotency key scheme (e.g. `{invoice_id or line_id}#{unit_index}`) — research + planner decide, constrained only by: stable across re-polls, unique per unit, and reconcilable against existing batches (D-02). This was explicitly left as a technical decision. **Research finding:** no new stored key is required — see "D-01/D-02: why the Apps Script dedup guard already implements the reconcile formula" and the D-03 code example below; the existing `(zoho_so_number, product_sku)` pair plus the Apps Script's own count-based guard already satisfies this, and the per-unit display ordinal can be derived client-side from the existing sequential `batch_id`.
- Which layer the fix lands in (`apps-script/` derivation vs. `zoho-middleware/` reconciliation vs. both) — pin down in research. **Research finding:** the fix lands in `zoho-middleware/routes/pos.js`'s `/api/batch/bulk-create` handler (add `unit_total` + switch to `planKitBatches`). The Apps Script (`apps-script/adminApi.gs`) dedup guard is already correct and needs NO changes — it already implements the D-02 formula once given the right `unit_total` input.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| Owner bug report 2026-08-25 (BrewPad batch-ops correctness) | A Zoho invoice with a kit line at quantity > 1 must surface one pending batch per unit in BrewPad, not one total. Evidence: INV-000171 (3 × one kit → 1 pending batch observed, 3 expected). | Root cause located: `zoho-middleware/routes/pos.js:3216-3331` (`/api/batch/bulk-create`) never sets `batchPayload.unit_total`, so the Apps Script dedup guard (`apps-script/adminApi.gs:1964-2028`) rejects units 2+ as duplicates. Fix + regression-test pattern fully specified in this document (Architecture Patterns, Code Examples, Pitfall 1). |
</phase_requirements>

## Summary

The exact bug is located and fully understood. **`POST /api/batch/bulk-create`** (`zoho-middleware/routes/pos.js:3216-3331`) is the invoice→pending-batch derivation site — reached from BrewPad's "Pull from Zoho" UI (`js/brewpad.js` `openPullFromZohoSheet`/`renderPullCandidates`, ~L4177-4313) via `GET /api/batch/scan-invoices` (candidate discovery) → `POST /api/batch/bulk-create` (actual creation). This route correctly *loops* `kitBatchQuantity(item)` times per kit line (pos.js:3279-3292, added in a prior "D-07, quantity-aware" fix) — so 3 `callAppsScriptCreateBatch` calls really are issued for a qty-3 kit line. The loop is not the bug.

The bug is one field short: each of those calls sends an **identical `batchPayload`** that never sets `unit_total`. The Apps Script `createBatch` dedup guard (`apps-script/adminApi.gs:1964-2028`) counts existing Batches-sheet rows matching `(zoho_so_number, product_sku)` and rejects a new create once that count reaches `payload.unit_total` — **defaulting `unit_total` to 1 for legacy/absent callers** (`adminApi.gs:1994-1995`). So call 1 succeeds (0 existing ≥ 1? no → create), and calls 2 and 3 are rejected with `duplicate_so_number` (1 existing ≥ 1 → reject) — collapsing a qty-3 invoice line to exactly 1 pending batch. This is a byte-for-byte repeat of a bug already fixed on the *sibling* real-time-sale path: `createBatchesFromSale` (`zoho-middleware/lib/brewpad-integration.js:345-410`) computes `unitTotalBySku` and sets `batchPayload.unit_total` (line 384) specifically because of **INV-000137** (documented in the code comment at brewpad-integration.js:359-362 and STATE.md — "3 kits sold, 1 batch kept"). That fix was never ported to the `/api/batch/bulk-create` route, which is a near-duplicate implementation that drifted.

A second, related gap: `/api/batch/bulk-create` also never applies the Maker's-Fee-slot cap (`makersFeeSlots`/`planKitBatches`, brewpad-integration.js:168-250) that the sale path uses — it loops on raw `kitBatchQuantity(item)` for every detected kit line with no cap. This is exactly D-04's scope.

**Primary recommendation:** In `pos.js`'s `/api/batch/bulk-create` handler, replace the current per-kit-item `kitBatchQuantity` loop with `brewpadIntegration.planKitBatches(lineItems)` (the same function `createBatchesFromSale` uses) to get the fee-slot-capped unit list, then mirror `createBatchesFromSale`'s `unitTotalBySku` computation and set `batchPayload.unit_total` on every create call. Because the Apps Script guard already implements "create until existing count reaches `unit_total`," this single fix satisfies D-01 (auto-backfill), D-02 (reconcile formula), and D-04 (fee-slot cap) simultaneously — no new dedup logic needs to be written, and **no schema change or data migration is needed**.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Detect kit line items on a Zoho invoice | API/Backend (`zoho-middleware/lib/brewpad-integration.js`) | — | Zoho catalog has no kit category; detection logic (Maker's-Fee-relative) already centralized here |
| Expand a kit line's quantity into N batch-create calls | API/Backend (`pos.js` route handler) | — | Must reuse `planKitBatches`, not reimplement; currently duplicated/drifted between two call sites |
| Per-unit dedup / idempotency across re-creates | Database/Storage (`apps-script/adminApi.gs` `createBatch`, backed by the Batches Google Sheet) | API/Backend (must supply correct `unit_total` input) | The Sheet is the only source of truth for "which batches already exist"; the guard already implements the D-02 reconcile formula, contingent on receiving the right cap |
| Per-unit "Unit X of N" display | Browser/Client (`js/brewpad.js` `renderBatchList`, card view ~L3893-3937) | — | Pure rendering derived from already-fetched batch list; no new backend field needed |
| Fermentation-slot cap (D-04) | API/Backend (`brewpad-integration.js` `makersFeeSlots`/`planKitBatches`) | — | Already implemented correctly on the sale path; bulk-create path must call into it rather than reimplement |

## Standard Stack

No new libraries are introduced by this phase — it is a bug fix inside existing first-party code (Express route handler, Apps Script function, vanilla ES5 frontend). No `npm install` / `pip install` is required.

### Package Legitimacy Audit

**Not applicable.** This phase installs no external packages. Skip the legitimacy gate.

## Architecture Patterns

### System Architecture Diagram — current (buggy) invoice→pending-batch flow

```
[BrewPad "Pull from Zoho" sheet]  (js/brewpad.js: openPullFromZohoSheet)
        │  staff clicks "Import" or runs a date-window Scan
        ▼
GET /api/batch/scan-invoices   (pos.js:3037-3211)
        │  returns candidate invoices (kit_items array, NO quantity semantics used yet)
        │  ⚠ date-window mode SKIPS any invoice that already has a cf_batch_status
        │    value OR appears in existingSoNumbers (pos.js:3156-3162) — a PARTIALLY
        │    linked invoice (1-of-3 batches) is invisible to the date-window scan.
        ▼
[staff reviews + checks candidates] → buildBulkCreatePayload() → { invoice_ids: [...] }
        ▼
POST /api/batch/bulk-create   (pos.js:3216-3331)
        │  re-fetches each invoice fresh from Zoho (server-authoritative, D-06)
        │  detectKitItems(lineItems)
        │  FOR EACH kit line item:
        │     qty = kitBatchQuantity(item)     ← NO makersFeeSlots cap applied (D-04 gap)
        │     FOR u in 0..qty:
        │        batchPayload = { product_sku, product_name, customer_*, source:'zoho_scan',
        │                          zoho_so_number }        ← NO unit_total field (THE BUG)
        │        callAppsScriptCreateBatch(batchPayload)
        ▼
callAppsScriptCreateBatch()   (brewpad-integration.js:260-304)
        │  POST to Apps Script Web App, action=create_batch
        ▼
createBatch(payload, userEmail)   (apps-script/adminApi.gs:1964-2028)
        │  allowedUnits = Math.floor(Number(payload.unit_total))  → NaN when absent → defaults to 1
        │  matching = existing Batches rows where zoho_so_number === payload.zoho_so_number
        │                                    AND product_sku    === payload.product_sku
        │  if (matching.length >= allowedUnits) → reject 'duplicate_so_number'
        ▼
[unit 1: matching.length=0 ≥ 1? no → CREATE row]
[unit 2: matching.length=1 ≥ 1? YES → REJECT 'duplicate_so_number']   ← INV-000171 symptom
[unit 3: matching.length=1 ≥ 1? YES → REJECT 'duplicate_so_number']
        ▼
Rejected calls → queueForRetry() → Redis (24h TTL, 3 attempts) → 5-min sweep
(retryPendingBatches, server.js:710-719) replays the SAME payload (still no unit_total)
→ same rejection every retry → ages out after 3 attempts, deleted (brewpad-integration.js:438-445)
```

### Correct reference implementation — the sibling sale path (already fixed for this exact bug class)

```
createBatchesFromSale()  (brewpad-integration.js:345-410)
        │  batchUnits = planKitBatches(lineItems)     ← fee-slot-capped (D-04), mixed-cart-aware
        │  unitTotalBySku = {}; batchUnits.forEach(item => unitTotalBySku[sku]++)
        │  FOR EACH unit in batchUnits:
        │     batchPayload = { ..., unit_total: unitTotalBySku[sku] }   ← THE MISSING FIELD
        │     callAppsScriptCreateBatch(batchPayload)
```
Source: `zoho-middleware/lib/brewpad-integration.js:345-397`, comment block at 359-367 explicitly documents this was the INV-000137 fix.

### Recommended fix shape

```javascript
// pos.js /api/batch/bulk-create — replace the current kitItems.forEach(...) block with:
var batchUnits = brewpadIntegration.planKitBatches(lineItems);   // fee-slot capped (D-04)
if (batchUnits.length === 0) {
  results.push({ invoice_id: invoiceId, invoice_number: inv.invoice_number || invoiceId,
                  ok: false, error: 'no_kit_items' });
  return;
}
var unitTotalBySku = {};
batchUnits.forEach(function (item) {
  var sku = item.sku || item.item_id || '';
  unitTotalBySku[sku] = (unitTotalBySku[sku] || 0) + 1;
});
var kitChain = Promise.resolve();
var invoiceResults = [];
batchUnits.forEach(function (item) {
  var sku = item.sku || item.item_id || '';
  var nameParts = brewpadIntegration.splitCustomerName(customerName);
  var batchPayload = {
    product_sku: sku, product_name: item.name || '',
    customer_name: customerName, customer_firstname: nameParts.first || '',
    customer_lastname: nameParts.last || '', customer_id: customerId,
    source: 'zoho_scan', zoho_so_number: invoiceNumber,
    unit_total: unitTotalBySku[sku]                     // ← the fix
  };
  kitChain = kitChain.then(function () {
    return brewpadIntegration.callAppsScriptCreateBatch(batchPayload).then(function (result) {
      invoiceResults.push({ sku: sku, ok: !!(result && result.ok), batch_id: (result && result.batch_id) || undefined, error: (result && !result.ok && result.error) || undefined });
    });
  });
});
```
This mirrors `createBatchesFromSale` almost exactly. **Strong recommendation for the planner:** consider extracting a shared helper (e.g. `brewpadIntegration.buildBatchCreatePayloads(lineItems, invoiceNumber, customerName, customerId, source)` returning the ready-to-send payload array) consumed by BOTH `createBatchesFromSale` and the bulk-create route, so this exact "two near-identical implementations, one gets the fix" drift class cannot recur (Phase 75 is itself a repeat of the INV-000137 incident, just on the other code path).

### D-01/D-02: why the Apps Script dedup guard already implements the reconcile formula

`createBatch`'s guard (`adminApi.gs:1993-2014`) computes `matching.length` (batches already existing for that `zoho_so_number` + `product_sku` pair) and allows creates **until** `matching.length >= allowedUnits` (= `unit_total`). This is *exactly* D-02's `pending_to_add = invoice_line_qty − batches_already_existing_for_that_line` formula, already running server-side, keyed correctly, and idempotent by construction — it just needs a correct `unit_total` input. Once the bulk-create route sends the right `unit_total`:
- **First run on INV-000171** (1 batch already exists from the original buggy import): `matching.length=1` for the first retry call → `1 >= 3`? No → create (2nd batch). Then `matching.length=2` → `2>=3`? No → create (3rd batch). Then loop ends (only 3 units planned) — **self-corrects 1→3, no duplicates.**
- **Re-running the same import a second time** (idempotency check, D-01): `matching.length=3 >= 3` → all 3 further calls rejected as duplicates → **no drift.**

**No batch schema change and no data migration are required** — the per-line attribution key is already `(zoho_so_number, product_sku)` on the existing Batches sheet columns (`apps-script/adminApi.gs:2096` writes `zoho_so_number`; `product_sku` is column 3, `adminApi.gs:2077`).

### D-01 gap requiring a planner decision: how does INV-000171 get *found* again for backfill?

The date-window "Pull from Zoho" scan (`scan-invoices`, pos.js:3133-3172) explicitly **excludes** any invoice that already has a `cf_batch_status` value set (line 3156-3160, `alreadyHasBatch` check) or already appears in the Apps Script `get_batches` dedup set (line 3161-3162, `existingSoNumbers`). INV-000171 already has 1 batch, so `cf_batch_status` is already populated (via `syncBatchToZoho`, called after the original partial create) — **the date-window scan will silently skip it forever**, even after the code fix, even if it's within the 30-day window. This directly conflicts with D-01's "auto-backfill on next reconcile" framing if "reconcile" is expected to mean "the existing automatic Pull-from-Zoho scan."

Two automated/semi-automated cadences actually exist in the codebase today (there is **no fully-automatic "reconcile all invoices" cron** — confirmed by grepping `server.js` for `setInterval`, see Environment/cadence table below):
1. **5-minute retry sweep** (`retryPendingBatches`, `server.js:710-713`, `brewpad-integration.js:417-466`) — but it only replays payloads that were queued by a *prior failed create this session*; Redis TTL is 24h and max 3 attempts, so **any retry-queue entry from INV-000171's original failure has almost certainly already aged out and been deleted** (bug reported 2026-08-25, well past any 24h window from whenever the invoice first failed).
2. **Manual single-invoice import** (`GET /api/batch/scan-invoices?number=INV-000171`, pos.js:3049-3101) — has **no** `alreadyHasBatch`/dedup-set filter, so staff CAN re-surface INV-000171 as a candidate by number and re-run "Create Batches" through it once the `unit_total` fix lands.

**Recommendation for the planner:** the "auto" in D-01 cannot be delivered by the existing date-window scan without also changing its skip condition (`alreadyHasBatch`) to compare *counts* rather than *presence* — which is a larger, riskier change (touches the Pull-from-Zoho "already imported, don't show again" UX for the common single-batch case, which is intentional and correct there). The **lower-risk, in-scope path** is: (a) ship the `unit_total` fix so any future create (via single-invoice re-import, or a fresh sale) is correct and idempotent; (b) for INV-000171 specifically, treat it as a **known one-time manual backfill** — staff re-imports it by number (already possible once the fix ships, no code change needed for that entry point) — and (c) flag as an **Open Question** whether a broader "count-aware" date-window rescan is in scope for Phase 75 or should be deferred (it duplicates concerns with the not-yet-built Phase 62/63 OPS-01/OPS-02 reconciliation work). This is the single biggest scope decision the planner must make explicit — see Open Questions below.

### Recommended Project Structure (files touched)

```
zoho-middleware/
├── routes/pos.js                 # /api/batch/bulk-create handler — THE FIX (unit_total + planKitBatches)
├── lib/brewpad-integration.js    # optional: extract shared payload-building helper (recommended, not required)
└── __tests__/batch-scan-invoices.test.js   # existing bulk-create describe block — extend with realistic
                                             # Apps-Script-mock behavior (see Pitfall 1) + INV-000171 fixture
js/
└── brewpad.js                    # renderBatchList() card view (~L3893-3937) — add "Unit X of N" label (D-03)
tests/frontend/
└── brewpad-pending.test.js  or  brewpad-pull-from-zoho.test.js   # add a pure ordinal-label helper + tests
```

### Anti-Patterns to Avoid
- **Re-implementing the dedup/cap logic client-side or in a new middleware function:** the Apps Script guard already does count-based reconciliation correctly — just feed it the right `unit_total`. Writing a parallel "count existing batches" check in `pos.js` before calling `callAppsScriptCreateBatch` would duplicate logic AND introduce a race (Sheet read-then-write without the Apps Script lock) — `apps-script/adminApi.gs:2061` already wraps the actual row-append in `acquireScriptLock`.
- **Mocking `callAppsScriptCreateBatch` as always `{ok:true}` in tests regardless of payload:** this is the exact reason the current test suite is green while the bug ships (see Pitfall 1). Any new/updated test must simulate the *real* Apps Script dedup semantics.
- **Storing a new "unit_index" column on the Batches sheet:** not needed. D-03's ordinal can be derived purely at render time from the existing `batch_id` (sequential, generated in `createBatch`, `adminApi.gs:2064`) sort order within a `(zoho_so_number, product_sku)` group — see Pattern below.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Fee-slot-capped kit expansion | A new cap loop in `pos.js` | `brewpadIntegration.planKitBatches(lineItems)` | Already handles Maker's-Fee-slot cap, mixed kit+merchandise disambiguation by price, and the `MAX_BATCHES_PER_KIT_LINE=100` fat-finger guard (brewpad-integration.js:197-250) |
| Per-(invoice,SKU) dedup / idempotent backfill counting | A pre-check "count existing batches" query from `pos.js` before creating | Send correct `unit_total`; let `apps-script/adminApi.gs:1993-2014`'s existing guard do the counting | Avoids a read-then-write race the Apps Script `acquireScriptLock` (adminApi.gs:2061) already protects against on the write side |
| Per-unit ordinal label ("Unit X of N") | A new stored `unit_index` field + backend endpoint | Client-side derivation: group `_allBatchesData` by `(zoho_so_number, product_sku)`, sort by `batch_id` ascending, ordinal = position in that sorted group | `batch_id` is monotonically assigned at creation (`generateNextId`, adminApi.gs:2064) and never reassigned — stable across re-renders and re-polls with zero schema change |

**Key insight:** almost everything Phase 75 needs already exists in the codebase, correctly implemented, on the sale path. The task is closer to "port a fix" than "design a new mechanism."

## Common Pitfalls

### Pitfall 1: The existing bulk-create regression test already masks this exact bug class
**What goes wrong:** `zoho-middleware/__tests__/batch-scan-invoices.test.js`, test `'quantity-aware: a kit line with quantity 3 yields 3 creates...'` (lines 682-711) mocks `brewpadIntegration.callAppsScriptCreateBatch.mockResolvedValue({ ok: true, batch_id: ... })` **unconditionally** — every one of the 3 calls "succeeds" in the test regardless of payload content. It asserts the middleware issued 3 calls, but never asserts what was *in* each call's payload (no `unit_total` assertion anywhere in this file or in `brewpad-integration.test.js`'s equivalent `createBatchesFromSale` test at line 289-301).
**Why it happens:** the mock stands in for the real Apps Script, but doesn't reproduce its dedup-guard semantics — so a regression that strips `unit_total` (like the one shipped) is invisible to this suite. This is the "green tests ≠ working system" anti-pattern already flagged once in this project's STATE.md (fda6e40 incident) — happening again, in the sibling code path.
**How to avoid:** write the regression test FIRST (per CLAUDE.md #3) using a **realistic** `callAppsScriptCreateBatch` mock that models the real dedup guard: track a fake Batches-sheet array in the test, and on each call check `matching.length >= Number(payload.unit_total || 1)` before deciding `ok`. Assert the mock records `unit_total` on every payload. This turns the mock into a faithful stand-in for `apps-script/adminApi.gs:1964-2028` rather than an unconditional stub.
**Warning signs:** any test that asserts `toHaveBeenCalledTimes(N)` on a create function without also asserting the created *payload* is the exact shape that would hide this bug.

### Pitfall 2: `retryPendingBatches` will silently re-fail forever on a payload missing `unit_total`
**What goes wrong:** if a future regression re-strips `unit_total` from a queued payload, the 5-min retry sweep (`brewpad-integration.js:417-466`) replays the *same broken payload* up to 3 times (24h TTL) and then permanently drops it (`attempts > MAX_RETRIES` → `cache.del(key)`, line 438-445) with only a log line — no alert, no visible-in-BrewPad signal.
**Why it happens:** the retry payload is captured at first-failure time and never re-derived from current invoice state.
**How to avoid:** out of scope to redesign the retry queue for Phase 75, but the regression test suite should include an idempotency test that re-invokes the (fixed) bulk-create handler twice for the same invoice and asserts the second run creates zero new batches and reports `duplicate_so_number`/already-satisfied cleanly (proving D-01's "re-poll never duplicates" without relying on the retry queue at all).

### Pitfall 3: date-window "Pull from Zoho" scan will not resurface a partially-linked invoice
**What goes wrong:** see the Architecture Patterns section above — `scan-invoices`'s date-window mode skips any invoice with an existing `cf_batch_status` value. A planner who assumes "next reconcile" means "next automatic date-window scan" will build a fix that never actually reaches INV-000171 in production without an owner action.
**How to avoid:** treat this explicitly as an Open Question (below) rather than assuming; do not silently redefine `alreadyHasBatch`'s skip condition without flagging the UX tradeoff for the common (already-fully-linked, correctly-skip) case.

### Pitfall 4: `js/brewpad.min.js` is a build artifact
**What goes wrong:** hand-editing the minified file (or forgetting to rebuild after editing `js/brewpad.js`) ships a stale bundle to staff.
**How to avoid:** per CLAUDE.md #8/#9, edit only `js/brewpad.js`, then run `npm run build` (which runs `stamp:brewpad` + `minify:js`, package.json line 11/15/18) to regenerate `brewpad.min.js` and re-stamp `brewpad.html`'s cache-busting query string.

## Code Examples

### Existing quantity-aware unit_total pattern (the fix to port)
```javascript
// Source: zoho-middleware/lib/brewpad-integration.js:359-367, 373-396
// How many batches this sale expects per (invoice + SKU). The Apps Script dedup
// guard keys on exactly that pair, so without this it admits the first unit of a
// kit line and rejects the rest as duplicates — which is how INV-000137 sold three
// kits and kept one batch. unit_total tells the guard how many are legitimate.
var unitTotalBySku = {};
batchUnits.forEach(function (item) {
  var sku = item.sku || item.item_id || '';
  unitTotalBySku[sku] = (unitTotalBySku[sku] || 0) + 1;
});
batchUnits.forEach(function (item) {
  var sku = item.sku || item.item_id || '';
  var batchPayload = {
    product_sku: sku,
    // ...
    unit_total: unitTotalBySku[sku]
  };
  creates.push(callAppsScriptCreateBatch(batchPayload) /* ... */);
});
```

### Apps Script dedup guard contract (grep-checkable, already documented in-repo)
```javascript
// Source: apps-script/adminApi.gs:1986-1989
//   createBatch({zoho_so_number:'INV-001', product_sku:'SKU-A', unit_total:3}) x3 — all 3 create
//   createBatch({zoho_so_number:'INV-001', product_sku:'SKU-A', unit_total:3}) — 4th call: duplicate_so_number
//   createBatch({zoho_so_number:'INV-001', product_sku:'SKU-A'}) — no unit_total: legacy, allows 1
//   createBatch({zoho_so_number:'INV-001', product_sku:'SKU-B'}) — different SKU: independent count
```

### Existing realistic-fixture pattern to extend (INV-000171-shaped invoice)
```javascript
// Source: zoho-middleware/__tests__/batch-scan-invoices.test.js:148-160 (makeDetailInvoice helper)
function makeDetailInvoice(overrides) {
  return Object.assign({
    invoice_id: 'INV-ID-001',
    invoice_number: 'INV-000001',
    customer_name: 'Anne MacDougall',
    customer_id: 'CUST-001',
    status: 'paid',
    line_items: [
      { item_id: 'KIT-001', sku: 'WINE-KIT-CAB', name: 'Cabernet Sauvignon Kit' },
      { item_id: 'FEE-001', sku: 'MAKERS-FEE', name: "Maker's Fee" }
    ]
  }, overrides || {});
}
// INV-000171-shaped fixture for Phase 75 (mirrors the INV-000137 pattern already
// used at brewpad-integration.test.js:289-301):
var inv171 = makeDetailInvoice({
  invoice_number: 'INV-000171',
  line_items: [
    { item_id: 'KIT-001', sku: '80087352', name: 'Italy Nebbiolo Style', quantity: 3 },
    { item_id: 'FEE-001', sku: 'MAKERS-FEE', name: "Maker's Fee", quantity: 3 }
  ]
});
```

### D-03 per-unit label — derive ordinal from existing sequential batch_id, no schema change
```javascript
// New helper to add near shouldShowKioskBadge (js/brewpad.js:552-561), same
// module-scope-pure-function pattern used throughout this file for testability.
function computeUnitLabel(batch, allBatches) {
  var siblings = allBatches.filter(function (b) {
    return b.zoho_so_number && b.zoho_so_number === batch.zoho_so_number &&
           b.product_sku === batch.product_sku;
  }).sort(function (a, b) { return String(a.batch_id).localeCompare(String(b.batch_id)); });
  if (siblings.length <= 1) return '';
  var idx = siblings.findIndex(function (b) { return b.batch_id === batch.batch_id; });
  return 'Unit ' + (idx + 1) + ' of ' + siblings.length;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Dedup guard matched on `zoho_so_number` alone | Matches on `(zoho_so_number, product_sku)` pair | "CR-01 fix (gap-closure 29.3)" — pre-existing, per adminApi.gs:1970-1974 | A multi-kit invoice (different SKUs) no longer falsely blocks the 2nd kit line |
| Dedup guard blocked ANY 2nd unit of the same SKU on the same invoice | `unit_total`-aware: allows creates until `matching.length >= unit_total` | INV-000137 fix — sale path only (`createBatchesFromSale`) | Same-SKU qty>1 kit lines now correctly expand on the **sale** path; the **bulk-create/scan** path was never updated — that gap is this phase |
| Bulk-create looped once per kit line item (1 batch per line) | Loops `kitBatchQuantity(item)` times per line (D-07 fix, pre-existing) | Some point before this research (comment says "D-07, quantity-aware") | The loop count is already correct; only the per-call `unit_total` payload field and the fee-slot cap (D-04) are missing |

**Not deprecated, still current:** the Apps Script Web App / Google Sheets batch store model itself — no migration away from it is in scope or implied by this phase.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | INV-000171 was created via the "Pull from Zoho" bulk-create path (source `'zoho_scan'`), not the real-time kiosk-sale path — inferred from the bug being framed as "invoice→pending-batch" (existing invoice, not a live sale) and from the sale path already being confirmed quantity-aware in CONTEXT.md. Not directly confirmed by reading INV-000171's actual Batches-sheet row (no read access to the live Google Sheet from this environment). | Summary, root cause | If INV-000171 actually went through `createBatchesFromSale` (kiosk/online source) instead, the root cause located here would be wrong — the planner/owner should confirm by checking the existing pending batch's `source` field in BrewPad or the Batches sheet before implementation, as a cheap Wave 0 sanity check. |
| A2 | No fully-automatic "reconcile all recent invoices for missing units" cron/interval exists today (checked `server.js` `setInterval` registrations — only kit-registry refresh, retry sweeps, and kiosk pending-charge sweep exist; none re-scans invoices for under-created batch counts). | Architecture Patterns — D-01 gap section | If such a mechanism exists elsewhere (e.g., a Zoho webhook, or an Apps Script time-trigger not visible in this repo's `apps-script/*.gs` files), the D-01 "auto-backfill" story could ride that instead of needing an owner-manual re-import step. Apps Script time-triggers are configured in the Apps Script project UI, not necessarily visible as code — this should be confirmed with the owner during planning/discuss. |

**If this table is empty:** N/A — see above, both items should be quickly confirmable and are flagged as Open Questions too.

## Open Questions (RESOLVED)

**RESOLVED 2026-08-26 (owner + planner):** all three questions below are now decided. Markers inline.

1. **What does "next reconcile" in D-01 concretely trigger for INV-000171 specifically?**
   - **RESOLVED (owner 2026-08-26 — revised, locked D-01):** ship the scoped idempotent `unit_total` fix (all FUTURE multi-qty invoices auto-correct on first reconcile) + a one-time manual single-invoice re-import (`GET /api/batch/scan-invoices?number=INV-000171` → Create Batches) for the single pre-fix invoice. The date-window scan's `alreadyHasBatch` skip filter (`pos.js:3156-3160`) is explicitly **NOT** modified this phase — making it count-aware is higher-risk and overlaps the not-yet-built Phase 62/63 reconciliation model. See 75-CONTEXT.md revised D-01.
   - What we know: the code fix (adding `unit_total`) makes any *future* create call idempotent and correct. The existing date-window scan explicitly skips already-linked invoices (Pitfall 3), and any original retry-queue entry for INV-000171 has almost certainly aged out (Redis 24h TTL, 3 attempts, bug reported well after any plausible original creation time).
   - What's unclear: whether Phase 75 is expected to also modify the date-window scan's skip condition (broader risk, touches the "don't re-show already-fully-linked invoices" UX) so that a fully-automatic re-scan surfaces INV-000171, or whether a one-time manual re-import (single-invoice mode, `?number=INV-000171`, which has no skip filter) is an acceptable "auto-backfill on next reconcile" for this phase. **-> Resolved: one-time manual re-import; date-window skip filter untouched.**
   - Recommendation: plan the `unit_total` fix as the core, always-in-scope deliverable. Treat "does the date-window scan need to become count-aware" as a separate, explicitly-scoped decision — default to NOT touching the date-window skip logic unless the owner confirms fully-hands-off backfill (not just a manual re-import) is required, since that skip condition intentionally prevents already-linked invoices from cluttering the Pull-from-Zoho candidate list for the common (correct) case. **-> Recommendation adopted.**

2. **Should `createBatchesFromSale` and the bulk-create route's kit-expansion logic be unified into one shared helper as part of this phase, or left as parallel implementations with the bug ported over?**
   - **RESOLVED (planner 2026-08-26):** shared-helper extraction is **declined for this phase** — mirror the sale-path pattern into the bulk-create route and keep scope tight (CLAUDE.md: simplest solution, don't touch the working money-adjacent sale path, one logical change per commit). Recurrence-prevention via a shared helper is recorded as a follow-up candidate, not executed here.
   - What we know: they are ~90% identical (both call `detectKitItems`, both need `planKitBatches`/`unitTotalBySku`, both call `callAppsScriptCreateBatch`), and their divergence is exactly how this bug happened.
   - What's unclear: whether refactoring into a shared helper is in-scope for a bug-fix phase (CLAUDE.md working principle: "don't over-engineer... implement the simplest solution for simple problems") or should be flagged as a follow-up. **-> Resolved: follow-up, not this phase.**
   - Recommendation: the planner should decide based on phase-granularity config (`.planning/config.json` `granularity: "coarse"`) — a shared-helper refactor is a defensible small addition (low risk, same file, prevents recurrence) but is not strictly required to close the bug. Surface as a discretionary task, not a mandatory one. **-> Decision: not surfaced as a task; deferred.**

3. **Does INV-000171's currently-existing 1 pending batch need to be preserved (as "Unit 1 of 3") or could a naive fix create a NEW extra 4th batch instead of filling in units 2-3?**
   - **RESOLVED (planner 2026-08-26):** confirmed — the idempotency regression test starts from **1 pre-existing batch** for (INV-000171, 80087352) with `unit_total=3` and asserts exactly 2 new creates and 0 duplicates (the self-heal path). The naive "create N" behavior is explicitly not implemented; the Apps Script count guard fills only the shortfall.
   - What we know: the Apps Script guard's counting (`matching.length`) already handles this correctly by construction — it counts existing rows and only creates the shortfall, so re-running with a correct `unit_total=3` will add exactly 2 more rows (not 3, not 4).
   - What's unclear: nothing structurally, but this MUST be the exact scenario the idempotency regression test proves (start with 1 pre-existing batch in the fake-sheet mock, unit_total=3, expect exactly 2 new creates and 0 duplicates), not just the "0 pre-existing → 3 creates" happy path already covered by the existing (but payload-blind) test. **-> Covered by Plan 01 Task 1 Test B.**

## Environment Availability

Skip — no new external tool/service/runtime dependency. This phase touches only existing first-party code (Express route, Apps Script function already deployed, ES5 frontend file) using infrastructure already present and configured (`APPS_SCRIPT_URL`, `APPS_SCRIPT_SERVER_TOKEN`, Redis via `lib/cache.js`).

Cadence/trigger inventory for reference (all pre-existing, `zoho-middleware/server.js`):

| Interval | Function | Purpose | Touches this bug? |
|----------|----------|---------|--------------------|
| Hourly | `refreshKitSkus()` (server.js:700-704) | Refresh authoritative Kit SKU registry | No |
| Every 5 min | `retryPendingBatches()` + `retrySyncQueue()` (server.js:710-718) | Replay queued failed batch creates / Zoho syncs | Yes — currently replays broken payloads forever until aged out (Pitfall 2) |
| Every 5 min | `reconcile.sweepPendingCharges()` (server.js:724-728) | Kiosk payment orphan-charge sweep (unrelated money path) | No |
| Manual only | Pull-from-Zoho scan + bulk-create (`js/brewpad.js` UI) | The actual invoice→pending-batch derivation site | Yes — this IS the fix site |
| None found | Automatic full invoice re-scan for under-linked invoices | — | Does not exist (Open Question 1 / Assumption A2) |

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|-------------------|
| V2 Authentication | Yes (unchanged) | `authTiers.requireTiers(['legacy','session'])` already gates `/api/batch/scan-invoices` and `/api/batch/bulk-create` (pos.js:2712, 3038, 3217) — Phase 75 does not change auth tiering |
| V4 Access Control | Yes (unchanged) | Same tier gate; device tier is rejected for both routes (BrewPad/session-scoped only), consistent with existing comments |
| V5 Input Validation | Yes (unchanged) | `invoice_ids` numeric-ID format + 200-item cap already enforced (pos.js:3225-3237, WR-01 fix) — no new user input surface is introduced by adding `unit_total` (server-computed, never client-supplied, consistent with D-06 "server-authoritative, ignores client fields") |
| V6 Cryptography | No | Not applicable — no crypto/secrets touched |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Client supplying a manipulated `unit_total` to over- or under-create batches | Tampering | Not a risk here — `unit_total` is computed server-side from the server-refetched Zoho invoice (`zohoGet('/invoices/' + invoiceId)`, pos.js:3245), never taken from the client request body, matching the existing D-06 "server-authoritative" pattern already enforced for `product_name`/`customer_name` |
| Race between two concurrent bulk-create calls for the same invoice creating duplicate batches | Race condition (Tampering-adjacent) | Already mitigated by `acquireScriptLock(15000)` inside `createBatch` (adminApi.gs:2061-2064), which serializes the read-check-append sequence per Apps Script execution |

## Sources

### Primary (HIGH confidence — direct code inspection, this repo)
- `zoho-middleware/routes/pos.js:3213-3331` — `/api/batch/bulk-create` handler (the bug site)
- `zoho-middleware/routes/pos.js:3035-3211` — `/api/batch/scan-invoices` handler (candidate discovery, date-window skip logic)
- `zoho-middleware/lib/brewpad-integration.js:1-410` — `detectKitItems`, `kitBatchQuantity`, `makersFeeSlots`, `planKitBatches`, `callAppsScriptCreateBatch`, `createBatchesFromSale`, `queueForRetry`
- `zoho-middleware/lib/brewpad-integration.js:412-466` — `retryPendingBatches` (5-min sweep, TTL/attempts)
- `zoho-middleware/lib/brewpad-integration.js:688-792` — `fetchLiveBatchIndex`, `reconcileInvoiceBatchStatus` (existing cf_batch_status-label reconciliation, distinct from batch creation)
- `apps-script/adminApi.gs:1962-2028` — `createBatch` dedup guard (the counterpart the fix must satisfy)
- `js/brewpad.js:552-561, 595-663, 3676-3939, 4177-4313` — kiosk-badge helper, Pull-from-Zoho pure helpers, `renderBatchList` card/table rendering, Pull-from-Zoho UI wiring
- `zoho-middleware/__tests__/batch-scan-invoices.test.js:1-160, 564-822` — existing test harness, mocking conventions, `makeDetailInvoice` fixture, existing (payload-blind) quantity-aware test
- `zoho-middleware/__tests__/brewpad-integration.test.js:204-301` — `createBatchesFromSale` tests including the original INV-000137 regression test
- `tests/frontend/brewpad-pending.test.js`, `tests/frontend/brewpad-pull-from-zoho.test.js` — existing frontend pure-helper test patterns for `js/brewpad.js`
- `zoho-middleware/server.js:680-730` — cron/interval registrations (cadence inventory)
- `zoho-middleware/lib/checkout-helpers.js:170-201` — `findMakersFeeItem`/`findMaterialsFeeItem` (fee detection used by `planKitBatches`)
- `package.json:9-18` — build/minify scripts for `js/brewpad.js` → `js/brewpad.min.js`
- `.planning/config.json` — `nyquist_validation: false`, `security_enforcement: true`, `security_asvs_level: 1`

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` line 145 — confirms a near-identical prior incident: "INV-000137 backfilled — SV-B-000183 + SV-B-000184; guard now reports '3 of 3' and rejects a 4th" (validates the dedup-guard's intended correct behavior once `unit_total` is right)
- `.planning/STATE.md` "Anti-patterns discovered" note (fda6e40 incident) — validates the Pitfall 1 concern about green-tests-vs-live-Apps-Script drift generally in this codebase

### Tertiary (LOW confidence)
- None — all claims above are grounded in direct code reads from this repository. See Assumptions Log for the two claims not independently confirmed against live production data (INV-000171's actual `source` field; existence of any Apps-Script-UI-configured time trigger outside this repo's tracked `.gs` files).

## Metadata

**Confidence breakdown:**
- Standard stack: N/A — no new libraries
- Architecture / root cause location: HIGH — file:line evidence, corroborated by an already-fixed identical bug on the sibling code path with an explicit in-code comment documenting the exact failure mode
- Pitfalls: HIGH — Pitfall 1 (test blind spot) and Pitfall 3 (scan skip-filter) are directly verified by reading the referenced test/route code
- D-01 backfill cadence: MEDIUM — mechanism for "auto" is under-specified in the existing codebase (Open Question 1); the fix itself is HIGH confidence, only the "how does it get triggered for the already-broken invoice" story needs an owner/planner decision

**Research date:** 2026-08-26
**Valid until:** 30 days (stable first-party code; no external dependency drift risk) — but re-verify quickly if `apps-script/adminApi.gs` is redeployed in the interim (project convention: Apps Script requires MANUAL redeploy, not CI-tracked, per STATE.md anti-pattern #3).
