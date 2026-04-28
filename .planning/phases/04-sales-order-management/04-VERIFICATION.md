---
phase: 04-sales-order-management
verified: 2026-04-28T15:00:00Z
status: human_needed
score: 7/7 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Verify chip filter renders correctly with proper colors and active/inactive toggle"
    expected: "Open and Draft chips are green/brown (active) by default. Tapping Closed/Paid activates them with grey/green colors. Tapping All activates all. Individual chip taps deactivate All."
    why_human: "Visual rendering and color accuracy cannot be verified programmatically"
  - test: "Verify SO cards show correct action buttons per status"
    expected: "Open/draft SOs with balance > 0 show Collect + Import to Cart buttons. Closed/paid SOs show status badge + Reorder Items button."
    why_human: "Dynamic rendering depends on Zoho data; need real SO data to verify conditional rendering"
  - test: "Verify import banner appears in cart after importing an SO"
    expected: "After tapping Import to Cart, browse view shows cart items with blue info banner showing 'Order: SO-XXXXXX' and an X close button"
    why_human: "Visual rendering and layout of banner within cart pane"
  - test: "Verify full import-to-cart-to-payment flow end-to-end"
    expected: "Import SO -> modify cart -> tap Pay -> SO updates in Zoho -> terminal charges -> receipt shows -> return to empty browse view"
    why_human: "Requires live Zoho API, Helcim terminal, and real SO data"
  - test: "Verify reorder creates new SO successfully from a closed/paid SO"
    expected: "Tap Reorder Items on closed SO -> confirm dialog -> new SO created in Zoho -> success toast -> SO list refreshes with new SO"
    why_human: "Requires live Zoho API and real closed SO data"
---

# Phase 4: Sales Order Management Verification Report

**Phase Goal:** Staff can view all sales orders (including closed/paid), import an existing Zoho SO into the kiosk cart, process payment, and have the SO marked as closed/paid in Zoho
**Verified:** 2026-04-28T15:00:00Z
**Status:** human_needed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Sales order list shows all statuses (open, draft, closed, paid) with a filter toggle | VERIFIED | GET handler fetches 4 statuses in parallel (pos.js:974-978). Chip filter in kiosk.html:300-306 with 5 buttons. kioskRenderSoList maps Zoho 'confirmed' to display 'paid'. Test verifies 4-status fetch (kiosk-salesorders.test.js:225-238). |
| 2 | Staff can select an existing sales order and load its line items into the kiosk cart for payment processing | VERIFIED | kioskImportSoToCart (kiosk.js:2380-2424) looks up each line item by item_id via kioskFindProductById, populates _kioskCart, sets imported SO state, calls kioskSyncMakersFee, navigates to browse view. item_id preserved in GET response (pos.js:998). |
| 3 | After payment is collected on an imported SO, the sales order is marked as closed/paid in Zoho with the payment linked | VERIFIED | Checkout fork (kiosk.js:1851-1895) calls PUT /api/kiosk/salesorder-update to sync line items, then delegates to kioskCollectPayment which calls existing /api/kiosk/salesorder-pay endpoint (records payment via Zoho /customerpayments). |
| 4 | PUT /api/kiosk/salesorder-update validates auth and input, updates Zoho SO, busts cache, logs event | VERIFIED | pos.js:1347-1415: auth check (401), 6 validation checks (400), zohoPut call, cache.del, eventLog, structured response. 10 tests covering all paths pass. |
| 5 | Chip filter toggles (Open/Draft active by default, All deactivates individuals) | VERIFIED | _kioskSoActiveChips defaults to ['open', 'draft'] (kiosk.js:715). kioskWireSoChips (kiosk.js:2356-2378) handles All/individual toggle logic. kioskRenderSoChips syncs active class. kioskWireSoChips() wired on init (kiosk.js:3401). |
| 6 | Checkout fork prevents terminal charge if SO update fails; retry skips SO update | VERIFIED | kiosk.js:1851-1895: if SO update fails, kioskShowSoError called (no kioskCollectPayment). `return;` at line 1889 prevents fall-through. _kioskImportedSoUpdated flag (set true on success at line 1869) causes retry path to skip update (line 1891-1894). |
| 7 | Staff can reorder closed/paid SO items (creates new SO with same line items) | VERIFIED | kioskReorderSo (kiosk.js:2428-2469) uses confirm dialog, builds payload with customer_id + line items, calls POST /api/kiosk/salesorder-create, reloads SO list on success. Reorder button rendered for closed/paid SOs (kiosk.js:2306). |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `zoho-middleware/routes/pos.js` | Extended GET handler + new PUT handler | VERIFIED | 1417 lines. zohoPut imported (line 13). GET fetches 4 statuses (974-978). item_id in line_items (998). PUT endpoint at line 1347-1415 with full auth/validation/update/cache/event flow. |
| `zoho-middleware/__tests__/kiosk-salesorders.test.js` | Tests for GET extension and PUT endpoint | VERIFIED | 675 lines, 28 tests all passing. 2 new GET tests (item_id, 4-status). 10 new PUT tests (auth, 6 validation, happy path, Zoho error, multi-item). Router mock extended with put. makeReq supports headers. |
| `js/kiosk.js` | Chip filter, import flow, reorder, checkout fork, post-payment cleanup | VERIFIED | 3465 lines. 4 new state vars (712-715). kioskFindProductById (838). Rewritten kioskLoadSalesOrders (2201) and kioskRenderSoList (2230). Chip functions (2344-2378). Import (2380-2424). Reorder (2428-2469). Clear (2473-2477). Checkout fork (1851-1895). Banner rendering (1518-1525, 1564). Receipt handler (2567-2580). Init wiring (3401). |
| `css/kiosk.css` | Chip filter styles, card action styles, import banner styles | VERIFIED | Chip styles at 2402-2454 (flex row, pill shape, 5 status-specific active colors). Card actions at 2458-2479. Banner at 2483-2510. |
| `kiosk.html` | Chip filter row HTML in collect view | VERIFIED | Status filter div at line 300-306 with 5 chip buttons. Open and Draft have `active` class by default. Positioned between .kiosk-collect-header and #kiosk-so-list. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| pos.js GET handler | zohoGet('/salesorders', { status: 'closed' }) | Promise.all 4-status fetch | WIRED | Lines 974-978: all 4 zohoGet calls in Promise.all |
| pos.js PUT handler | zohoPut('/salesorders/' + soId, payload) | zohoPut call | WIRED | Line 1390: zohoPut called with SO ID and line_items payload |
| kiosk.js kioskImportSoToCart | _kioskCart | kioskFindProductById catalog lookup | WIRED | Line 2404: product = kioskFindProductById(li.item_id), line 2406: _kioskCart populated |
| kiosk.js checkout fork | PUT /api/kiosk/salesorder-update | fetch call when _kioskImportedSoId set | WIRED | Line 1861: fetch to salesorder-update endpoint with PUT method |
| kiosk.js kioskReorderSo | POST /api/kiosk/salesorder-create | fetch call with copied line items | WIRED | Line 2452: fetch to salesorder-create with copied payload |
| kiosk.js chip click handlers | kioskRenderSoList | kioskWireSoChips event binding | WIRED | Line 2356-2378: chip click handlers call kioskRenderSoChips + kioskRenderSoList. Wired on init at line 3401. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| kiosk.js (kioskRenderSoList) | _kioskSalesOrders | GET /api/kiosk/salesorders via fetch | Yes -- middleware queries Zoho API with 4 status params | FLOWING |
| kiosk.js (kioskImportSoToCart) | _kioskCart | SO line_items mapped via kioskFindProductById | Yes -- SO data from Zoho, catalog data from /api/kiosk/products | FLOWING |
| kiosk.js (kioskRenderCart banner) | _kioskImportedSoNumber | Set from SO data during import | Yes -- SO number from Zoho response | FLOWING |
| pos.js PUT handler | zohoPut response | Zoho Books API PUT /salesorders/:id | Yes -- returns updated SO with total/balance | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Middleware tests pass | `cd zoho-middleware && npm test` | 374 passed, 0 failed | PASS |
| SO-specific tests pass | `cd zoho-middleware && npm test -- --testPathPattern=kiosk-salesorders` | 28 passed, 0 failed | PASS |
| Build succeeds | `npm run build` | kiosk.min.js generated without errors | PASS |
| Lint passes | `npm run lint` | 0 errors, 79 warnings (all pre-existing) | PASS |
| zohoPut destructured | `grep "var zohoPut = zohoApi.zohoPut" zoho-middleware/routes/pos.js` | Found at line 13 | PASS |
| 4-status fetch present | `grep "status:.*confirmed" zoho-middleware/routes/pos.js` | Found at line 978 | PASS |
| PUT endpoint registered | `grep "router.put.*salesorder-update" zoho-middleware/routes/pos.js` | Found at line 1347 | PASS |
| Import function exists | `grep -c "kioskImportSoToCart" js/kiosk.js` | 2 (definition + usage) | PASS |
| Checkout fork exists | `grep -c "salesorder-update" js/kiosk.js` | 1 (fetch call in fork) | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SOM-01 | 04-01, 04-02 | Sales order list shows all statuses with filter toggle | SATISFIED | GET fetches 4 statuses (pos.js:974-978). Chip filter in HTML (kiosk.html:300-306) with JS toggle logic (kiosk.js:2344-2378). Confirmed/paid status mapping. |
| SOM-02 | 04-01, 04-02 | Staff can import existing SO line items into kiosk cart | SATISFIED | item_id preserved in GET (pos.js:998). kioskImportSoToCart (kiosk.js:2380-2424) maps via kioskFindProductById. Cart editable. D-03 confirm dialog. |
| SOM-03 | 04-01, 04-02 | After payment, SO marked closed/paid with payment linked | SATISFIED | Checkout fork (kiosk.js:1851-1895) calls PUT /api/kiosk/salesorder-update to sync line items, then kioskCollectPayment calls existing /api/kiosk/salesorder-pay which records payment via Zoho /customerpayments. |

No orphaned requirements found for Phase 4.

### CONTEXT.md Decisions Compliance

| Decision | Description | Status | Evidence |
|----------|-------------|--------|---------|
| D-01 | Import loads items into editable cart | VERIFIED | kioskImportSoToCart populates _kioskCart (kiosk.js:2398-2410), navigates to browse view for editing |
| D-02 | Cart edits local until payment; SO updated at payment time | VERIFIED | Checkout fork sends PUT at payment time (kiosk.js:1861-1864), not during import |
| D-03 | Confirm dialog when cart has items before import | VERIFIED | confirm() at kiosk.js:2389 when Object.keys(_kioskCart).length > 0 |
| D-04 | Staff can add new items after import | VERIFIED | kioskShowView('browse') at kiosk.js:2423 shows product grid; cart is standard _kioskCart |
| D-05 | Both Pay and Import buttons on actionable SOs | VERIFIED | kiosk-so-pay-btn + kiosk-so-import-btn rendered for isActionable && balance > 0 (kiosk.js:2293-2300) |
| D-06 | SO closure via existing payment recording | VERIFIED | Delegates to kioskCollectPayment which calls /api/kiosk/salesorder-pay (uses Zoho /customerpayments) |
| D-07 | Return to empty browse view after SO payment | VERIFIED | Receipt handler clears cart, calls kioskShowView('browse') (kiosk.js:2569-2575) |
| D-08 | Retry skips SO update when already updated | VERIFIED | _kioskImportedSoUpdated flag (kiosk.js:1869/1891-1894) |
| D-09 | Horizontal chip filter with multi-select | VERIFIED | 5 chips in HTML, kioskWireSoChips toggle logic (kiosk.js:2356-2378) |
| D-10 | Default active: Open + Draft | VERIFIED | _kioskSoActiveChips = ['open', 'draft'] at kiosk.js:715; HTML chips have active class |
| D-11 | Reorder on closed/paid SOs | VERIFIED | kioskReorderSo (kiosk.js:2428-2469) with Reorder Items button (kiosk.js:2306) |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | - | - | - | No TODO/FIXME/PLACEHOLDER/console.log in new code. All SO data escaped with escapeHTML(). |

### Human Verification Required

### 1. Chip Filter Visual Rendering

**Test:** Navigate to kiosk > Sales Orders tab. Observe the chip filter row.
**Expected:** Open (green) and Draft (brown) chips are active by default with white text. Closed (grey), Paid (green), All (dark) are inactive with border-only style. Tapping chips toggles active state with smooth 0.15s transition.
**Why human:** Visual color accuracy and CSS variable rendering depend on browser and display. Transition smoothness cannot be verified programmatically.

### 2. SO Card Action Buttons

**Test:** View SO list with mixed statuses (needs real Zoho data with open, draft, closed, confirmed SOs).
**Expected:** Open/draft SOs with balance > 0 show "Collect $XX.XX" (primary) + "Import to Cart" (secondary) buttons. Paid/closed SOs show status badge + "Reorder Items" button. Open/draft with zero balance show "Paid" badge only.
**Why human:** Requires real Zoho data to observe all conditional rendering paths. Button layout and sizing need visual inspection.

### 3. Import Banner in Cart

**Test:** Tap "Import to Cart" on an open/draft SO. Observe the browse view cart panel.
**Expected:** Blue info-colored banner at top of cart showing "Order: SO-XXXXXX" with X close button. Cart items below reflect SO line items. Tapping X removes banner but keeps cart items.
**Why human:** Banner positioning, color, and layout within the cart pane require visual inspection.

### 4. Full Import-to-Payment Flow

**Test:** Import SO -> optionally modify cart -> tap Pay -> observe terminal flow.
**Expected:** "Updating order SO-XXXXXX..." message shows first. After SO update succeeds, terminal payment proceeds. On success, receipt shows, then "New Sale" button returns to empty browse view. If SO update fails, error shows and terminal is NOT charged.
**Why human:** Requires live Zoho API and Helcim terminal hardware. End-to-end flow cannot be simulated.

### 5. Reorder Flow

**Test:** Tap "Reorder Items" on a closed/paid SO.
**Expected:** Confirm dialog: "Create a new order with the same items as SO-XXXXXX?" On confirm, success toast shows new SO number. SO list refreshes with new SO at top.
**Why human:** Requires live Zoho API to create new SO. Confirm dialog rendering is browser-native.

### Gaps Summary

No code-level gaps found. All 7 must-have truths are verified against the codebase with evidence at all 4 levels (existence, substance, wiring, data flow). All 374 middleware tests pass. Build and lint succeed. All 11 CONTEXT.md decisions are honored. All 3 requirements (SOM-01, SOM-02, SOM-03) are satisfied.

5 human verification items remain for visual rendering and end-to-end flow testing with live Zoho/Helcim integration.

---

_Verified: 2026-04-28T15:00:00Z_
_Verifier: Claude (gsd-verifier)_
