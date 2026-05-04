---
phase: 06-kiosk-to-brewpad-integration
verified: 2026-05-03T22:15:00Z
status: human_needed
score: 3/3
overrides_applied: 0
human_verification:
  - test: "Trigger a test kiosk kit sale (with Maker's Fee) and verify a pending batch appears in BrewPad batch list within 30 seconds"
    expected: "New batch row appears with customer name, product name, Pending status badge (neutral grey), and Kiosk badge (blue-slate)"
    why_human: "End-to-end flow requires live kiosk sale, running middleware, connected Apps Script, and populated Google Sheet -- cannot verify programmatically without running services"
  - test: "Open the detail view of the auto-created batch and verify Zoho Ref row displays the SO number"
    expected: "'Zoho Ref' info row shows the Zoho sales order number from the kiosk sale"
    why_human: "Requires visual inspection of the rendered detail view with real batch data from the Sheet"
  - test: "Change the auto-created batch status from Pending to Primary and verify the Kiosk badge disappears"
    expected: "After status change, the Kiosk badge is no longer shown in the batch list row"
    why_human: "Status change interaction and badge disappearance require live browser testing"
  - test: "Filter by Pending in the BrewPad filter bar and verify only pending batches are shown"
    expected: "Pending filter button works; if no pending batches exist, custom empty state shows 'No pending batches' message"
    why_human: "Filter rendering with real data requires live BrewPad UI"
---

# Phase 6: Kiosk-to-Brewpad Integration Verification Report

**Phase Goal:** When a kit is sold on the kiosk, a batch is automatically created in BrewPad so staff never have to manually duplicate sale data
**Verified:** 2026-05-03T22:15:00Z
**Status:** human_needed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | After a kit sale completes on the kiosk, a new batch appears in BrewPad's batch list within 30 seconds -- with customer name, product name, and Zoho SO number pre-filled | VERIFIED | pos.js:515 calls `brewpadIntegration.createBatchesFromSale` fire-and-forget with lineItems, invoiceNumber, customer_name, contact_id. brewpad-integration.js:134-145 builds payload with product_sku, product_name, customer_name, source=kiosk, zoho_so_number. Apps Script adminApi.gs:200-206 routes create_batch to createBatch. adminApi.gs:1694-1717 appends row with all fields. axios timeout 12s + Apps Script sync appendRow = well within 30s. List view shows product_name (line 1162), customer_name (line 1163). Detail view shows Zoho Ref (line 1565-1566). |
| 2 | Auto-created batches are visually distinguishable in the batch list (a "from kiosk" badge or indicator) so staff know which batches were auto-generated vs. manually created | VERIFIED | js/brewpad.js:84-86 defines `shouldShowKioskBadge(source, status)` returning true only when source=kiosk AND status=pending. Lines 1166-1167 (table view) and 1203-1204 (card view) render `<span class="bp-kiosk-badge">Kiosk</span>`. css/brewpad.css:424-434 defines `.bp-kiosk-badge` with blue-slate background. Neutral grey `.bp-status-badge--neutral` at line 418 for Pending badge. 6 unit tests in brewpad-pending.test.js confirm badge visibility logic. |
| 3 | Opening the detail view of an auto-created batch shows the linked Zoho sales order number as a visible reference | VERIFIED | js/brewpad.js:1565-1566: `if (b.zoho_so_number) { html += '<div class="bp-detail-info-row"><span class="bp-detail-info-label">Zoho Ref</span><span>' + escapeHTML(b.zoho_so_number) + '</span></div>'; }`. Conditional rendering -- only shows when zoho_so_number is present. XSS-safe via escapeHTML. Apps Script writes zoho_so_number at appendRow position 22 (column V). |

**Score:** 3/3 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps-script/adminApi.gs` | Pending batch mode in createBatch + create_batch action in doPost | VERIFIED | `isPending` appears 7 times. `create_batch` action at line 200 in server-token branch. Pending batches skip schedule validation, task creation, vessel operations. appendRow includes source (pos 21) and zoho_so_number (pos 22). customer_email suppressed for kiosk source (line 1701). |
| `zoho-middleware/lib/brewpad-integration.js` | createBatchesFromSale and retryPendingBatches functions | VERIFIED | 209 lines, exports 4 functions. Uses ES5 style (var, no arrows). Calls checkoutHelpers.findMakersFeeItem for Maker's Fee detection. Fire-and-forget pattern with skipRetryQueue parameter for retry de-duplication. |
| `zoho-middleware/lib/constants.js` | BATCH_RETRY_PREFIX Redis key prefix | VERIFIED | Line 58: `BATCH_RETRY_PREFIX: 'brewpad:pending-batch:'` in CACHE_KEYS object. |
| `zoho-middleware/routes/pos.js` | Hook into sale/confirm handler | VERIFIED | Line 10: import. Line 515: `brewpadIntegration.createBatchesFromSale(lineItems, invoiceNumber, body.customer_name, body.contact_id, catalogMap)`. Not awaited -- fire-and-forget before `res.status(201).json(result)`. |
| `zoho-middleware/server.js` | 5-minute setInterval for retryPendingBatches | VERIFIED | Line 27: import. Lines 454-458: `setInterval` calling `retryPendingBatches().catch(...)` at `5 * 60 * 1000`. Placed outside Zoho auth conditional. |
| `zoho-middleware/__tests__/brewpad-integration.test.js` | Unit tests for batch creation logic | VERIFIED | 23 tests all passing. Covers: detectKitItems (5 tests), createBatchesFromSale (5 tests), callAppsScriptCreateBatch (5 tests), retryPendingBatches (4 tests). |
| `css/brewpad.css` | bp-status-badge--neutral and bp-kiosk-badge CSS rules | VERIFIED | Lines 418-421: `.bp-status-badge--neutral` with `rgba(154, 134, 114, 0.10)` background. Lines 424-434: `.bp-kiosk-badge` with `rgba(74, 111, 138, 0.12)` background. Matches UI-SPEC color values exactly. |
| `js/brewpad.js` | Pending status, Kiosk badge, Pending filter, Zoho Ref in detail | VERIFIED | STATUS_LABELS has `pending: 'Pending'` (line 979). STATUS_COLORS has `pending: 'neutral'` (line 980). filterOpts has `{ val: 'pending', label: 'Pending' }` as first entry (line 1016). shouldShowKioskBadge used in table (1166) and card (1203) views. Zoho Ref conditional in detail (1565). Exported in module.exports (4160). |
| `tests/frontend/brewpad-pending.test.js` | Unit tests for pending status and kiosk badge logic | VERIFIED | 67 lines, 6 test cases for shouldShowKioskBadge covering true, false, edge cases, case-insensitive status. All pass. |
| `css/brewpad.min.css` | Built with new CSS rules | VERIFIED | Contains "bp-kiosk-badge" (grep count: 1). |
| `js/brewpad.min.js` | Built with new JS | VERIFIED | Contains "shouldShowKioskBadge" (grep count: 1). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| apps-script/adminApi.gs doPost | apps-script/adminApi.gs createBatch | `action === 'create_batch'` in server-token branch | WIRED | Line 200-206: server-token branch routes create_batch to createBatch with 'kiosk-middleware' as userEmail |
| zoho-middleware/routes/pos.js | zoho-middleware/lib/brewpad-integration.js | require and function call in sale/confirm handler | WIRED | Line 10: `var brewpadIntegration = require('../lib/brewpad-integration');` Line 515: `brewpadIntegration.createBatchesFromSale(...)` |
| zoho-middleware/lib/brewpad-integration.js | Apps Script URL | axios.post with APPS_SCRIPT_URL | WIRED | Line 56: `axios.post(url, JSON.stringify(payload), ...)` where url = `process.env.APPS_SCRIPT_URL` |
| zoho-middleware/server.js | zoho-middleware/lib/brewpad-integration.js | setInterval calling retryPendingBatches | WIRED | Line 27: import. Line 454-458: `setInterval(function () { brewpadIntegration.retryPendingBatches()... }, 5 * 60 * 1000)` |
| js/brewpad.js STATUS_LABELS | js/brewpad.js renderBatchList | statusKey lookup in render loop | WIRED | Lines 1144-1146 (table), 1178-1180 (card): `STATUS_LABELS[statusKey]` and `STATUS_COLORS[statusKey]` with pending entries at lines 979-980 |
| js/brewpad.js renderBatchDetail | batch.zoho_so_number | conditional info row rendering | WIRED | Lines 1565-1566: `if (b.zoho_so_number)` renders "Zoho Ref" row with `escapeHTML(b.zoho_so_number)` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| js/brewpad.js batch list | b.source, b.status, b.zoho_so_number | Apps Script sheetToObjects from Batches Google Sheet | Yes -- appendRow writes source (pos 21), zoho_so_number (pos 22), status=pending (pos 2) | FLOWING |
| zoho-middleware/lib/brewpad-integration.js | lineItems, invoiceNumber, customerName | pos.js sale/confirm handler (from Zoho invoice creation chain) | Yes -- data flows from actual kiosk sale through payment chain | FLOWING |
| apps-script/adminApi.gs createBatch | payload.product_sku, payload.customer_name, payload.zoho_so_number | brewpad-integration.js callAppsScriptCreateBatch | Yes -- populated from real sale data via createBatchesFromSale | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| brewpad-integration.js loads without errors | `cd zoho-middleware && node -e "require('./lib/brewpad-integration')"` | Exit 0 | PASS |
| Frontend tests pass (270 total) | `npm test` | 12 suites, 270 tests passed | PASS |
| Middleware tests pass (410 total) | `cd zoho-middleware && npm test` | 18 suites, 410 tests passed | PASS |
| brewpad-integration tests pass (23) | `npx jest --testPathPattern=brewpad-integration` | 23 tests passed | PASS |
| brewpad-pending tests pass (6) | `npx jest --testPathPattern=brewpad-pending` | 6 tests passed | PASS |
| Build artifacts contain new code | grep bp-kiosk-badge in min.css, shouldShowKioskBadge in min.js | Both found | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| INTG-01 | 06-01, 06-02 | When a kit is sold on the kiosk, a batch is auto-created in BrewPad with customer name, product, and SO reference | SATISFIED | Full pipeline: pos.js -> brewpad-integration.js -> Apps Script -> Batches Sheet. Payload includes customer_name, product_sku, product_name, zoho_so_number. Note: REQUIREMENTS.md status tracker shows "Pending" but code implementation is complete. |
| INTG-02 | 06-03 | Auto-created batches appear in the BrewPad batch list with a "from kiosk" indicator | SATISFIED | Kiosk badge renders in both table and card views via shouldShowKioskBadge. Pending status badge with neutral grey distinguishes pending batches. |
| INTG-03 | 06-03 | Batch detail view shows the linked sales order number with a reference back to Zoho | SATISFIED | Conditional "Zoho Ref" info row in renderBatchDetail when b.zoho_so_number is present. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none found) | -- | -- | -- | No TODO/FIXME/placeholder/stub patterns found in any phase 6 artifacts |

### Human Verification Required

### 1. End-to-End Kiosk Sale to Batch Creation

**Test:** Perform a test kiosk kit sale (product with Maker's Fee line item) on staging. After the sale completes, switch to BrewPad and check the batch list.
**Expected:** A new batch appears within 30 seconds with: the customer name from the sale, the product name/SKU, a "Pending" status badge in neutral warm grey, a "Kiosk" badge in blue-slate next to the status, and pending filter shows this batch.
**Why human:** End-to-end flow requires live kiosk sale, running middleware, connected Apps Script, and populated Google Sheet. Cannot verify programmatically without running services and creating real transaction data.

### 2. Batch Detail View Zoho Ref

**Test:** Click on the auto-created batch to open its detail view.
**Expected:** An info row labeled "Zoho Ref" displays the Zoho sales order number from the kiosk sale. Product and Customer rows also show the correct values.
**Why human:** Requires visual inspection of the rendered detail view with real batch data from the Google Sheet.

### 3. Kiosk Badge Disappears After Status Change

**Test:** In BrewPad, click the status badge of the auto-created pending batch and change its status to "Primary".
**Expected:** The "Kiosk" badge disappears from the batch row. The status badge changes from "Pending" (neutral grey) to "Primary" (info blue). The "Zoho Ref" still shows in the detail view.
**Why human:** Status change interaction and badge disappearance require live browser testing with real batch data.

### 4. Pending Filter Empty State

**Test:** If no pending batches exist, click the "Pending" filter button in the BrewPad filter bar.
**Expected:** Custom empty state message: "No pending batches" with body "Kiosk sales with Maker's Fee will appear here automatically."
**Why human:** Filter rendering with dynamic empty state requires live BrewPad UI.

### Gaps Summary

No code-level gaps found. All three ROADMAP success criteria are fully implemented and verified in the codebase:

1. **SC-1 (auto-batch creation):** Complete pipeline from pos.js sale/confirm handler through brewpad-integration.js to Apps Script createBatch with pending mode. Customer name, product name, and Zoho SO number all flow through and are stored in the Batches sheet. Redis retry queue handles failures with 3-attempt max and 24h TTL.

2. **SC-2 (visual distinction):** Kiosk badge ("Kiosk" in blue-slate) renders in both table and card list views only for pending kiosk-sourced batches. Pending status badge uses neutral warm grey distinct from other statuses. shouldShowKioskBadge pure helper exported and tested with 6 cases.

3. **SC-3 (Zoho SO in detail):** Conditional "Zoho Ref" row in batch detail view renders the zoho_so_number when present, escaped via escapeHTML.

Human verification is required to confirm the end-to-end flow works with live services (kiosk -> middleware -> Apps Script -> Google Sheet -> BrewPad UI). All code artifacts, wiring, data flow, and tests are verified as correct.

**Note:** REQUIREMENTS.md status tracker shows INTG-01 as "Pending" -- this should be updated to "Complete (06-01, 06-02)" since the implementation is finished. ROADMAP.md shows 06-01-PLAN.md checkbox as unchecked -- should be marked complete.

---

_Verified: 2026-05-03T22:15:00Z_
_Verifier: Claude (gsd-verifier)_
