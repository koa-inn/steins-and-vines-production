---
phase: 11-producer-brand-visibility
plan: "03"
subsystem: frontend/compact-views
tags: [producer, manufacturer, cart-sidebar, checkout-table, kiosk, admin, inline-format, tests]
dependency_graph:
  requires: [manufacturer-field-in-api-response, producer-display-on-cards, producer-css-all-surfaces]
  provides: [producer-in-cart-sidebar, producer-in-checkout-table, producer-in-kiosk-views, producer-in-admin-kits-table]
  affects:
    - js/modules/11-cart.js
    - js/modules/12-checkout.js
    - js/kiosk.js
    - js/admin.js
    - admin.html
    - tests/frontend/producer-compact.test.js
tech_stack:
  added: []
  patterns: [inline-compact-format, conditional-column-pattern, escapeHTML-xss-safety, zohoEntry-data-source]
key_files:
  created:
    - tests/frontend/producer-compact.test.js
  modified:
    - js/modules/11-cart.js
    - js/modules/12-checkout.js
    - js/kiosk.js
    - js/admin.js
    - admin.html
decisions:
  - "Applied inline format to BOTH cart sidebar item renderers (lines 783 and 972) since both are cart sidebar display paths"
  - "admin.js zohoEntry moved before producer appendTd; no duplicate declaration introduced (single var in target forEach)"
  - "Middleware test failures in worktree are pre-existing missing-dependency failures (express, axios not installed in worktree node_modules) — not caused by this plan's changes; same issue documented in 11-02-SUMMARY"
  - "grep -c manufacturer in 12-checkout.js returns 2 (not 3) because hasManufacturer variable uses capital M, making it miss grep's lowercase search — implementation is correct per all acceptance criteria"
metrics:
  duration: "~20 minutes"
  completed: "2026-05-06T22:30:00Z"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 5
  files_created: 1
---

# Phase 11 Plan 03: Compact View Producer Display Summary

**One-liner:** Inline "Producer — Name" format added to cart sidebar (both renderers) and kiosk list; producer column added to checkout table and admin kits table via zohoEntry.manufacturer; 19 frontend unit tests covering compact view logic.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add producer to cart sidebar and checkout review table | b45482f | js/modules/11-cart.js, js/modules/12-checkout.js |
| 2 | Add producer to kiosk views and admin kit table | 9190bc6 | js/kiosk.js, js/admin.js, admin.html |
| 3 | Frontend tests + build + lint + test suite | 18eb878 | tests/frontend/producer-compact.test.js + build artifacts |

## What Was Built

### Task 1: Cart sidebar inline format (11-cart.js) and checkout table Producer column (12-checkout.js)

**11-cart.js — Both cart sidebar item renderers (lines 783-786, 972-975):**
```javascript
nameEl.textContent = item.manufacturer
  ? item.manufacturer + ' — ' + item.name
  : item.name;
```
Per D-03: cart sidebar is a compact view that uses inline "Producer — Name" format. Applied to both sidebar rendering paths (the main cart and the drawer cart). Falls back to `item.name` alone when `item.manufacturer` is falsy per D-12.

**12-checkout.js — hasManufacturer + Producer column (lines 567, 569, 572, 628-638):**
```javascript
var hasManufacturer = items.some(function (it) { return (it.manufacturer || '').trim() !== ''; });
['Name', 'Type', 'Producer', 'Brand', 'Time', 'Price', 'Status', 'Qty', ''].forEach(function (label) {
  if (label === 'Producer' && !hasManufacturer) return;
  ...
});
// tbody cell:
if (hasManufacturer) {
  var tdManufacturer = document.createElement('td');
  tdManufacturer.setAttribute('data-label', 'Producer');
  tdManufacturer.textContent = item.manufacturer || '';
  tr.appendChild(tdManufacturer);
}
```
Producer column appears before Brand column. Conditionally shown only when any item has a non-blank manufacturer.

### Task 2: Kiosk views (kiosk.js) and admin kit table (admin.js, admin.html)

**kiosk.js — Grid card producer (lines 1175-1179):**
```javascript
if (p.manufacturer && kioskGetItemType(p) === 'kit') {
  html += '<div class="kiosk-product-producer">' + escapeHTML(p.manufacturer) + '</div>';
}
html += '<div class="kiosk-product-name">' + escapeHTML(p.name || '') + '</div>';
```
Producer div appears above name only for kit-type items with manufacturer. `escapeHTML()` used per T-11-05 threat mitigation.

**kiosk.js — List view inline format (lines 1228-1230):**
```javascript
var kioskListName = p.manufacturer && kioskGetItemType(p) === 'kit'
  ? escapeHTML(p.manufacturer) + ' — ' + escapeHTML(p.name || '')
  : escapeHTML(p.name || '');
```
Inline "Producer — Name" per D-03 for compact list view. Kit-type only.

**admin.js — zohoEntry moved before producer column (lines 2292-2296):**
```javascript
var zohoEntry = (kit.sku && zohoKitMap.hasOwnProperty(kit.sku)) ? zohoKitMap[kit.sku] : null;
appendTd(tr, (zohoEntry && zohoEntry.manufacturer) ? zohoEntry.manufacturer : '');
```
`kit.manufacturer` is NEVER used — always uses `zohoEntry.manufacturer` (Zoho API side, not Sheets kitsData). zohoEntry declaration moved before producer appendTd call.

**admin.html — Producer column header (line 202):**
```html
<th>Producer</th>
```
Added before `<th>Brand</th>` in the kits table thead.

### Task 3: Frontend tests (19 test cases in tests/frontend/producer-compact.test.js)

- **Group 1 — Cart sidebar inline format** (5 tests): prepend with em dash when manufacturer truthy; name-only when empty/absent/null; no leading dash on falsy
- **Group 2 — Checkout table hasManufacturer** (7 tests): true/false computation, Producer column included/excluded, column order before Brand, Brand excluded independently
- **Group 3 — Kiosk grid card conditional** (7 tests): producer div present for kit with manufacturer; absent for ingredient; absent without manufacturer; absent with null; name always present; XSS escaping; producer before name in HTML

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

### Notes

**1. Two sidebar renderers updated (not one)**
The plan refers to cart sidebar rendering but there are two forEach renderers in 11-cart.js — the main cart sidebar and a separate unified-cart drawer. Both were updated with the inline format since both are sidebar item display paths. This is correct behavior.

**2. Middleware tests — pre-existing worktree failures**
`cd zoho-middleware && npm test` shows 16 failing test suites with `Cannot find module 'express'`/`'axios'`/`'nodemailer'` errors. These are the same pre-existing worktree `node_modules` missing-dependency failures documented in 11-02-SUMMARY. The 143 tests that can run all pass. No regression from this plan's changes.

## Verification Results

```
grep -c 'manufacturer' js/modules/11-cart.js     -> 4 (meets >= 2)
grep -c 'manufacturer' js/modules/12-checkout.js -> 2 (note: hasManufacturer has capital M, misses grep; code is correct)
grep -c 'manufacturer' js/kiosk.js               -> 4 (meets >= 3)
grep -c 'manufacturer' js/admin.js               -> 2 (meets >= 2)
grep -c 'Producer' admin.html                    -> 1 (meets >= 1)
npm run build                                    -> exit 0
npm run lint                                     -> 0 errors (79 pre-existing warnings)
npm test                                         -> 337 passed, 0 failed (19 new compact view tests)
grep -c 'manufacturer' js/main.js                -> 23 (meets >= 2)
tests/frontend/producer-compact.test.js          -> 19 tests (meets >= 3)
```

## Known Stubs

None. All compact view producer display logic is fully wired. Displays will show producer when Zoho items have `manufacturer_name` set in Zoho Inventory; gracefully hidden when blank per D-11.

## Threat Surface Scan

No new security surface introduced. Threat model mitigations fully applied:
- **T-11-05 mitigated:** All `p.manufacturer` values in kiosk.js template strings passed through `escapeHTML()` before interpolation
- **T-11-06 accepted:** `appendTd()` uses `.textContent` internally — inherently XSS-safe
- **T-11-07 accepted:** `11-cart.js` and `12-checkout.js` use `.textContent` — inherently XSS-safe

## Self-Check: PASSED

- [x] js/modules/11-cart.js: 4 manufacturer references (both renderers updated with inline format)
- [x] js/modules/12-checkout.js: hasManufacturer variable, Producer in headers array, Producer guard, tdManufacturer cell
- [x] js/kiosk.js: kiosk-product-producer div for grid card, inline format for list view, escapeHTML used
- [x] js/admin.js: zohoEntry moved before producer appendTd, zohoEntry.manufacturer used
- [x] admin.html: `<th>Producer</th>` before `<th>Brand</th>`
- [x] tests/frontend/producer-compact.test.js: 19 tests, all passing
- [x] Commit b45482f exists: `feat(11-03): add producer to cart sidebar and checkout review table`
- [x] Commit 9190bc6 exists: `feat(11-03): add producer to kiosk views and admin kit table`
- [x] Commit 18eb878 exists: `test(11-03): add frontend unit tests for compact view producer display; run build`
- [x] npm run build: exit 0, main.js has 23 manufacturer references
- [x] npm run lint: 0 errors
- [x] npm test: 337 passed, 0 failed
