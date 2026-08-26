---
phase: 75-brewpad-invoice-pending-batch-quantity-expansion-multi-qty-k
reviewed: 2026-08-26T21:09:49Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - zoho-middleware/routes/pos.js
  - zoho-middleware/__tests__/batch-scan-invoices.test.js
  - js/brewpad.js
  - brewpad.html
  - tests/frontend/brewpad-unit-label.test.js
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 75: Code Review Report

**Reviewed:** 2026-08-26T21:09:49Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Reviewed the phase-75 diff against `94badf65^`: the `POST /api/batch/bulk-create`
unit_total fix in `zoho-middleware/routes/pos.js`, the `computeUnitLabel` addition and
its two render call-sites in `js/brewpad.js`, and the two supporting test files, plus the
`brewpad.html` cache-bust bump.

The core fix is sound: `bulk-create` now mirrors the sale-path `createBatchesFromSale`
exactly — it swaps the `kitItems` × `kitBatchQuantity` inline loop for
`planKitBatches(lineItems)` (fee-slot-capped) and stamps each per-unit payload with
`unit_total = unitTotalBySku[sku]`, which is precisely the field the Apps Script dedup
guard needs so units 2..N of a qty-N kit line are no longer rejected as duplicates
(INV-000171). The regression tests reproduce the real guard semantics rather than a
trivial `{ok:true}` stub, which is good. No security defects (invoice_ids are
regex-validated `^\d{15,20}$`; the unit label is numeric and `escapeHTML`-wrapped).

Two behavioural gaps remain worth fixing before ship, plus two minor items.

## Warnings

### WR-01: Idempotent / partial convergence reports the guard's success signal as a failure

**File:** `zoho-middleware/routes/pos.js:3301-3331`, consumed at `js/brewpad.js:664-693`

**Issue:** The Apps Script dedup guard returns `{ ok: false, error: 'duplicate_so_number' }`
when a `(zoho_so_number, product_sku)` batch already exists — i.e. when the invoice has
already converged to its `unit_total`. The route pushes that verbatim into `invoiceResults`
as a failure (`ok: false`), sets the invoice-level `error: 'duplicate_so_number'`, and
`allOk` becomes false. `summarizeBulkResults` (brewpad.js:675-683) then counts each such
unit into `failCount`, so the operator sees a spurious failure toast:

- Re-running bulk-create on an already-fully-batched invoice (Test C scenario) →
  "All 3 failed — check batches list", even though all 3 batches exist correctly.
- Partial convergence (1 pre-existing + 2 new, Test B) → "Created 2 batch(es); 1 failed",
  where the "1 failed" is in fact a correctly de-duplicated unit.

Because `duplicate_so_number` specifically means "already exists = desired state reached,"
surfacing it as indistinguishable from a real error (Apps Script down, HTTP error) defeats
the idempotent-convergence guarantee this phase is built around and will train operators
to ignore or repeatedly retry legitimate warnings. The phase's own Test B/C accept this
only because they assert on `oks.length`, never on the invoice-level `ok`/error surfaced
to the UI.

**Fix:** Treat `duplicate_so_number` as a benign "already exists" outcome distinct from a
hard failure. For example, classify it in the per-unit result and exclude it from
`failCount`:
```js
// pos.js — tag the dedup outcome
invoiceResults.push({
  sku: sku,
  ok: !!(result && result.ok),
  duplicate: !!(result && !result.ok && result.error === 'duplicate_so_number'),
  batch_id: (result && result.batch_id) || undefined,
  error: (result && !result.ok && result.error) || undefined
});
// allOk should treat an already-existing unit as satisfied:
var allOk = invoiceResults.length > 0 &&
  invoiceResults.every(function (r) { return r.ok || r.duplicate; });
```
```js
// brewpad.js summarizeBulkResults — do not count converged units as failures
if (r.kit_results[k] && r.kit_results[k].ok) { okCount++; }
else if (r.kit_results[k] && r.kit_results[k].duplicate) { /* already exists — skip */ }
else { failCount++; }
```

### WR-02: `computeUnitLabel` ordinal derives from `localeCompare` of `batch_id`, which is only correct for uniform fixed-width IDs

**File:** `js/brewpad.js:578-592`

**Issue:** The "Unit X of N" ordinal is assigned by sorting the group with
`String(a.batch_id).localeCompare(String(b.batch_id))`. This is a lexicographic string
sort, so it only matches true creation order while every `batch_id` in the group shares an
identical prefix and a fixed-width zero-padded suffix (`SV-B-000183`). It breaks for:
- Width-crossing sequences (`SV-B-000999` vs `SV-B-001000` is fine, but any non-padded or
  padding-boundary-crossing scheme mis-sorts, e.g. `...-9` before `...-10` inverts).
- Mixed/legacy IDs in the same group — e.g. the backfilled `SV-B-EXISTING-1/2/3` IDs used
  in this phase's own bulk-create tests, or manually created batches, which do not sort
  alongside `SV-B-000xxx` in creation order.

The label is display-only (no data/dedup impact), but a wrong ordinal misleads staff about
which physical fermentation unit maps to which batch — the exact thing the label exists to
disambiguate.

**Fix:** Sort on the numeric component, or use a numeric-aware collation:
```js
group.sort(function (a, b) {
  return String(a.batch_id).localeCompare(String(b.batch_id), undefined, { numeric: true });
});
```
Better, extract and compare the trailing integer so mixed prefixes still order by creation
sequence.

## Info

### IN-01: `bp-batch-unit` class has no CSS rule

**File:** `js/brewpad.js:3911, 3958` (rendered span), `css/brewpad.css`

**Issue:** Both render sites wrap the label in `<span class="bp-batch-unit">`, but no rule
for `bp-batch-unit` exists in `css/brewpad.css` or `css/brewpad.min.css` (grep: 0 matches),
and the diff includes no CSS change. The label still renders readably thanks to the inline
`— ` em-dash separator, but the dedicated class suggests intended styling (muted/smaller
text) that was never added.

**Fix:** Add a `.bp-batch-unit` rule (e.g. muted colour / smaller font) to
`css/brewpad.css` and rebuild, or drop the class if no styling is intended.

### IN-02: Unreachable secondary early-return in bulk-create

**File:** `zoho-middleware/routes/pos.js:3267-3270`

**Issue:** `if (batchUnits.length === 0)` is effectively dead: the preceding
`kitItems.length === 0` guard (line 3251) already returns `no_kit_items`, and
`detectKitItems` returning non-empty implies a Maker's Fee line is present, so
`planKitBatches` (which fails closed only when there is no fee / no kits) will not return
`[]` here. Harmless defensive code, but the duplicated `no_kit_items` path can confuse
future readers into thinking the two conditions differ.

**Fix:** Leave as defensive if desired, but add a one-line comment noting it is a
belt-and-braces guard, or collapse the two `no_kit_items` returns.

---

_Reviewed: 2026-08-26T21:09:49Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
