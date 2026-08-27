---
phase: 75-brewpad-invoice-pending-batch-quantity-expansion-multi-qty-k
verified: 2026-08-26T21:14:11Z
status: passed
score: 10/10 must-haves verified (code-level)
overrides_applied: 0
human_verification:
  - test: "Live one-time manual re-import of INV-000171 after prod middleware deploy: GET /api/batch/scan-invoices?number=INV-000171 -> Create Batches"
    expected: "BrewPad shows exactly 3 pending batches for the Italy Nebbiolo Style kit line (converging from the 1 pre-fix batch to 3 via the D-02 reconcile formula, not creating 4), and a 4th re-run of the same re-import creates 0 additional batches (D-01 idempotency proven live against the real, un-mocked Apps Script dedup guard)."
    why_human: "Requires a prod middleware deploy (no staging middleware exists per project convention) and live Google Apps Script / Google Sheets execution — the regression suite mocks the Apps Script dedup guard faithfully but cannot exercise the real deployed Apps Script. This is explicitly documented as an owner operational follow-up in both 75-01-PLAN.md and 75-01-SUMMARY.md, not an in-plan code task."
  - test: "After the INV-000171 backfill above, open BrewPad in a browser (not curl, per STATE.md anti-pattern #2) and visually confirm the three sibling batches for INV-000171 / SKU 80087352 render contiguous 'Unit 1 of 3', 'Unit 2 of 3', 'Unit 3 of 3' labels in both the card and table views."
    expected: "Three distinct pending batch cards/rows, each showing a correct, non-duplicated, non-mixed-up unit ordinal label next to the product name."
    why_human: "computeUnitLabel is fully unit-tested (5 passing tests covering the exact INV-000171-shaped 3-unit group, 1-unit no-label, empty-SO non-grouping, independent-SKU groups, and batch_id-sort-order) and its wiring into both render call sites is confirmed by grep + code read, but real visual rendering against live production batch data has not occurred yet — it depends on the INV-000171 backfill above having happened first. Documented as an owner operational follow-up in 75-02-PLAN.md/75-02-SUMMARY.md."
---

# Phase 75: BrewPad invoice→pending-batch quantity expansion Verification Report

**Phase Goal:** Fix the bug where a Zoho invoice containing quantity > 1 of the same kit produces only ONE pending batch in BrewPad instead of one pending batch per unit (evidence INV-000171: 3 × the same kit → 1 pending batch observed, 3 expected). Expand multi-qty kit lines into `quantity` distinct pending batches with stable per-unit identity/idempotency (re-ingestion must not duplicate), and add a regression test using an INV-000171-shaped invoice (qty 3 → 3 pending batches). Confirm interaction with existing batch↔invoice reconciliation/dedup so the fix doesn't create duplicate batches on re-poll. Also: per-unit "Unit X of N" labels on each pending batch of a multi-unit invoice line.

**Verified:** 2026-08-26T21:14:11Z
**Status:** passed (human verification completed 2026-08-27 — owner-tested on staging; see 75-HUMAN-UAT.md)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Plan 01 — backend unit_total fix)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Paid qty-3 kit line creates exactly 3 pending batches via `POST /api/batch/bulk-create` | ✓ VERIFIED | `batch-scan-invoices.test.js` Test A (L915-942) passes against post-fix `pos.js`: 3 `callAppsScriptCreateBatch` calls, each `unit_total===3`, `fakeSheet.length===3`. Ran directly: `npx jest __tests__/batch-scan-invoices.test.js -t "unit_total regression"` → 4/4 pass. |
| 2 | Re-running bulk-create for the same invoice creates 0 additional batches (idempotency) | ✓ VERIFIED | Test C (L973-1003): fake sheet pre-seeded with all 3 rows, re-run produces `oks.length===0`, `fakeSheet.length` unchanged at 3, HTTP still 200. |
| 3 | An invoice line with 1 existing batch converges to exactly 3 (adds 2, not 3 — D-02) | ✓ VERIFIED | Test B (L945-970): pre-seeded 1 row, run produces `oks.length===2`, final `fakeSheet.length===3`. |
| 4 | Batch count capped by paid Maker's Fee slots — min(kit_qty, fee_slots), never exceeding (D-04) | ✓ VERIFIED | Test D (L1006-1031): kit qty 5, fee slots 3 → exactly 3 creates, not 5. `planKitBatches` (brewpad-integration.js:197-250) implements the `min(kit,slots)` cap and is what the route now calls (`pos.js:3266`). |
| 5 | `unit_total` computed server-side from the re-fetched Zoho invoice, never read from client request body | ✓ VERIFIED | `grep -n "req.body.unit_total\|body.unit_total" zoho-middleware/routes/pos.js` → no matches. `unit_total` is set from `unitTotalBySku[sku]`, itself derived from `planKitBatches(lineItems)`, itself derived from `zohoGet('/invoices/'+invoiceId)` (pos.js:3242, 3266, 3282-3286, 3298). |
| 6 | Revised, locked D-01 executed as written: future invoices auto-correct via the idempotent fix; INV-000171 corrected via one-time manual single-invoice re-import; date-window skip filter (pos.js:3156-3160) intentionally NOT modified | ✓ VERIFIED | `pos.js:3150-3165` (the date-window scan's `alreadyHasBatch` skip) is byte-identical pre/post-fix (confirmed via `git diff 1aa49065 f6208ae5 -- zoho-middleware/routes/pos.js`, which shows changes only inside the bulk-create handler L3257-3314). 75-CONTEXT.md documents this as an explicit owner decision dated 2026-08-26, not a planner-side descope. |

### Observable Truths (Plan 02 — "Unit X of N" label)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 7 | Each pending batch belonging to a multi-unit invoice line shows a "Unit X of N" label (D-03) | ✓ VERIFIED | `computeUnitLabel` (js/brewpad.js:577-592) implemented and wired into both table (L3909-3912) and card (L3948-3959) render sites; `tests/frontend/brewpad-unit-label.test.js` test 1 (INV-000171-shaped 3-unit group, shuffled input) passes. |
| 8 | A batch whose (zoho_so_number, product_sku) group has only one member shows NO unit label | ✓ VERIFIED | Test 2 in `brewpad-unit-label.test.js` (group of 1 → `''`); code: `if (group.length <= 1) return '';` (brewpad.js:582). |
| 9 | Ordinal is stable across re-renders/re-polls, derived from ascending batch_id order within the group | ✓ VERIFIED | Test 5 (`derives ordinal from ascending batch_id string order, not array position`) passes; code sorts via `String(a.batch_id).localeCompare(String(b.batch_id))` (brewpad.js:583-585), independent of array/fetch order. |
| 10 | After the revised-D-01 manual backfill, INV-000171's three sibling batches render contiguous "Unit 1 of 3 / 2 of 3 / 3 of 3" labels, grouped by (zoho_so_number, product_sku), never mixing across invoices/SKUs | ✓ VERIFIED (code-level) / pending live confirmation | Test 1 (contiguous group), Test 3 (empty-SO never groups), Test 4 (independent SKUs never mix) all pass with an INV-000171-shaped fixture. Grouping key in code is exactly `(zoho_so_number, product_sku)` (brewpad.js:579-581) — matches the D-03 contiguity contract exactly. **Live rendering against real backfilled INV-000171 data has not occurred** (requires Plan 01 deployed to prod + the manual backfill — see Human Verification). |

**Score:** 10/10 truths verified at the code level (all automated checks pass); 2 of those truths (#6 live exercise, #10 live rendering) additionally require an owner-performed live confirmation after a prod middleware deploy, which is outside this phase's code scope by explicit, documented owner decision.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `zoho-middleware/routes/pos.js` | bulk-create handler sends `unit_total` and uses `planKitBatches` | ✓ VERIFIED | `grep -n "planKitBatches\|unit_total" zoho-middleware/routes/pos.js` shows both inside the bulk-create handler (L3266, 3283-3286, 3298); diff shows only the intended replacement of the raw `kitBatchQuantity` loop, no leftover dead code. |
| `zoho-middleware/__tests__/batch-scan-invoices.test.js` | Regression tests with realistic dedup-guard mock + INV-000171 fixture | ✓ VERIFIED | New describe block (L870-1032) with Tests A-D; mock enforces real count-based semantics (`matching.length >= allowedUnits`), mirroring `apps-script/adminApi.gs:1986-2014` exactly. Pre-existing L682-711 masking test and all 27 other pre-existing tests in this file untouched and still passing. |
| `js/brewpad.js` | `computeUnitLabel` pure helper + render-site usage (card + table) | ✓ VERIFIED | Helper at L577-592; call sites at L3909 (table) and L3948 (card); exported at L9326 (`module.exports` block). |
| `js/brewpad.min.js` | Regenerated build artifact reflecting the source change | ✓ VERIFIED | Contains `computeUnitLabel` (1 occurrence, minified) and the `"Unit "` string literal (1 occurrence); regenerated via `npm run build`, not hand-edited (commit `0ec23ef1` diff shows the corresponding minified diff, scoped only to brewpad.js/brewpad.min.js/brewpad.html). |
| `tests/frontend/brewpad-unit-label.test.js` | Unit tests for computeUnitLabel ordinal derivation | ✓ VERIFIED | 5 tests, all passing: contiguous 3-unit group (shuffled), 1-unit no-label, empty-SO non-grouping, independent-SKU groups, batch_id-sorted ordinal. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `zoho-middleware/routes/pos.js /api/batch/bulk-create` | `brewpadIntegration.planKitBatches` | fee-slot-capped unit expansion | ✓ WIRED | `var batchUnits = brewpadIntegration.planKitBatches(lineItems);` (pos.js:3266); `planKitBatches` (brewpad-integration.js:197-250) implements `min(kit_qty, makersFeeSlots)`. |
| `zoho-middleware/routes/pos.js /api/batch/bulk-create` | `brewpadIntegration.callAppsScriptCreateBatch` | `batchPayload.unit_total` set per (invoice, SKU) | ✓ WIRED | `unit_total: unitTotalBySku[sku]` (pos.js:3298) flows directly into the payload passed to `callAppsScriptCreateBatch` (pos.js:3302). |
| `js/brewpad.js renderBatchList` (table + card views) | `computeUnitLabel(b, _allBatchesData)` | per-batch label from sibling group | ✓ WIRED | Both call sites pass the full unfiltered `_allBatchesData` (populated from a real API fetch, `r1.data.batches` at L3025 / `r.data.batches` at L3684 — not a hardcoded empty array), so the group size N reflects all siblings regardless of the active filter. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `js/brewpad.js` render sites | `_allBatchesData` | Fetched from backend batch list endpoint (`r1.data.batches` / `r.data.batches`) | Yes — module-scope var populated by live fetch, not hardcoded static value | ✓ FLOWING |
| `zoho-middleware/routes/pos.js` bulk-create | `unit_total` | `zohoGet('/invoices/'+invoiceId)` → `planKitBatches(lineItems)` → `unitTotalBySku` | Yes — derived from server-refetched Zoho invoice line items, not from `req.body` | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| qty-3 kit line → 3 batches, unit_total=3 | `cd zoho-middleware && npx jest __tests__/batch-scan-invoices.test.js -t "unit_total regression"` | 4/4 passed (Tests A-D) | ✓ PASS |
| computeUnitLabel ordinal derivation | `npx jest tests/frontend/brewpad-unit-label.test.js` | 5/5 passed | ✓ PASS |
| Full middleware suite unaffected | `cd zoho-middleware && npm test` | 93 suites / 1449 tests passed | ✓ PASS |
| Full frontend suite unaffected | `npm test` | 83 suites / 1139 tests passed | ✓ PASS |
| Lint (both configs) | `npm run lint` (root) + `cd zoho-middleware && npm run lint` | Both exit 0 | ✓ PASS |
| No client-supplied `unit_total` | `grep -n "req.body.unit_total\|body.unit_total" zoho-middleware/routes/pos.js` | No matches | ✓ PASS |
| Date-window skip filter unmodified | `git diff 1aa49065 f6208ae5 -- zoho-middleware/routes/pos.js` | Only bulk-create handler (L3257-3314) changed; `pos.js:3150-3165` untouched | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes declared in either plan or referenced by the roadmap for this phase. Step 7c: SKIPPED (no declared/conventional probes for this phase — this is a Jest-test-driven bug-fix phase, not a migration/tooling phase).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|--------------|--------|----------|
| OWNER-BUG-20260825 | 75-01-PLAN.md, 75-02-PLAN.md | Owner bug report 2026-08-25 (BrewPad batch-ops correctness), evidence INV-000171 (3× kit → 1 pending batch observed, 3 expected) | ✓ SATISFIED (code-level; live confirmation pending, see Human Verification) | Both plans' `requirements: [OWNER-BUG-20260825]` map directly to the fix + regression tests + label verified above. `.planning/REQUIREMENTS.md` does not contain a formal `OWNER-BUG-20260825` entry — it tracks only the v4.5–v4.8 milestone requirements (SEC/MONEY/RESIL/OBS/REVIEW/OPS-prefixed IDs) and was last updated 2026-07-24, before this 2026-08-25 owner bug report. This matches the established project pattern for ad-hoc, owner-reported bug-fix phases outside the milestone REQUIREMENTS.md (e.g. Phase 73's recipe-pricing bug is similarly absent from REQUIREMENTS.md). Not an ORPHANED requirement — REQUIREMENTS.md makes no claim on Phase 75 at all, so there is nothing to reconcile against; this is an informational note, not a gap. |

**Coverage check:** No requirement ID declared in either PLAN's frontmatter is missing implementation evidence. No requirement ID is present in REQUIREMENTS.md's phase-mapping table under "Phase 75" (the table only goes up to Phase 56); this is consistent with prior ad-hoc bug-fix phases and does not constitute an ORPHANED requirement per the verification process definition (ORPHANED requires REQUIREMENTS.md to reference the phase with IDs absent from the plan — the reverse situation here, where REQUIREMENTS.md simply doesn't track this phase at all, is out of scope for that check).

### Anti-Patterns Found

None. Scanned all diffs (`git diff 1aa49065 f6208ae5`) for `zoho-middleware/routes/pos.js`, `js/brewpad.js`, `zoho-middleware/__tests__/batch-scan-invoices.test.js`, `tests/frontend/brewpad-unit-label.test.js` against `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER|placeholder|coming soon|not yet implemented|not available` — zero matches. No stub returns (`return null`, empty-array/object hardcoded fallbacks feeding render) found in the new/changed code; `_allBatchesData` and `unit_total` both trace to live data sources (see Data-Flow Trace).

### Human Verification Required

Both items below are already explicitly documented as owner operational follow-ups in 75-01-PLAN.md/SUMMARY and 75-02-PLAN.md/SUMMARY — they are not newly discovered gaps, but per the verification process they must still be surfaced because they are the only remaining unresolved links between the (fully verified) code fix and the originally reported live symptom.

### 1. Live INV-000171 backfill + idempotency proof

**Test:** After deploying the Plan 01 fix to prod middleware, re-import INV-000171 once via single-invoice mode (`GET /api/batch/scan-invoices?number=INV-000171` → Create Batches), then repeat the same re-import a second time.
**Expected:** First re-import: BrewPad shows exactly 3 pending batches for the Italy Nebbiolo Style line (converged from the existing 1). Second re-import: 0 new batches created (real, deployed Apps Script dedup guard proves idempotency, not just the mocked one in tests).
**Why human:** Requires a prod middleware deploy (no staging middleware exists per project convention) and execution against the live, deployed Google Apps Script — outside what a repo-level automated check can exercise.

### 2. Live "Unit X of N" label rendering

**Test:** After the backfill above, open BrewPad in a browser and visually inspect the three INV-000171 / SKU 80087352 sibling batches in both card and table views.
**Expected:** Contiguous "Unit 1 of 3", "Unit 2 of 3", "Unit 3 of 3" labels next to the product name, in the correct order, not mixed with any other invoice/SKU group.
**Why human:** Visual rendering confirmation against real production data; the pure-helper logic is fully unit-tested and the wiring is code-verified, but no real multi-unit batch exists yet to look at until item 1 above happens.

### Gaps Summary

No code-level gaps. Every must-have truth, artifact, and key link declared in both plans' frontmatter is verified present, substantive, and correctly wired, with passing automated tests (4 new middleware regression tests + 5 new frontend unit tests, both suites in full green, both lint configs clean). The only open items are two owner-operational, post-deploy live confirmations that both plans explicitly scoped out of this phase's code deliverable by a documented 2026-08-26 owner decision (the revised D-01). These are surfaced as human-verification items per the verification process rather than as gaps, since there is no missing or stubbed code to fix — only a real-world action (prod deploy + manual re-import) still pending.

---

*Verified: 2026-08-26T21:14:11Z*
*Verifier: Claude (gsd-verifier)*
