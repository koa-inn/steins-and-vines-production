---
phase: 04-sales-order-management
plan: 02
subsystem: kiosk-frontend
tags: [sales-orders, kiosk, chip-filter, import-to-cart, reorder, checkout-fork]
dependency_graph:
  requires: [GET-kiosk-salesorders-4status, PUT-kiosk-salesorder-update]
  provides: [kiosk-so-chip-filter, kiosk-import-to-cart, kiosk-reorder-so, kiosk-checkout-fork]
  affects: [kiosk-browse-view, kiosk-cart-pane, kiosk-collect-view, kiosk-receipt-flow]
tech_stack:
  added: []
  patterns: [client-side-chip-filter, import-so-to-cart, checkout-fork-so-update-before-terminal]
key_files:
  created: []
  modified:
    - js/kiosk.js
    - css/kiosk.css
    - kiosk.html
decisions:
  - "Search is now client-side only (kioskRenderSoList) -- no re-fetch per keystroke"
  - "Zoho status 'confirmed' maps to display status 'paid' in chip filter and card rendering"
  - "Open and Draft chips active by default per D-10"
  - "Detaching SO banner only clears association, cart items remain per UI-SPEC"
  - "New-sale receipt handler also clears imported SO state for safety"
metrics:
  duration: "4m 22s"
  completed: "2026-04-28T14:35:47Z"
  tasks_completed: 2
  tasks_total: 2
  tests_added: 0
  tests_total: 254
---

# Phase 04 Plan 02: Kiosk SO Frontend — Chip Filter, Import, Reorder, Checkout Fork Summary

Added status chip filter with 5 toggles (Open/Draft active by default), SO import-to-cart flow with catalog lookup and confirm dialog, reorder for closed/paid SOs, and checkout fork that updates SO line items in Zoho before terminal charge with retry-skip on already-updated SO.

## Tasks Completed

| Task | Name | Commit | Key Changes |
|------|------|--------|-------------|
| 1 | Add CSS styles for chip filter and import banner | 3145eba | Chip filter row in kiosk.html, chip/card-action/banner CSS in kiosk.css |
| 2 | Add chip filter logic, import-to-cart, reorder, and checkout fork | d76127d | 4 new state vars, kioskFindProductById, rewritten kioskLoadSalesOrders/kioskRenderSoList, chip filter functions, import/reorder/clear functions, checkout fork, receipt handler update, search handler change |

## What Changed

### kiosk.html
- Added `<div class="kiosk-so-status-filter">` with 5 chip buttons between collect header and SO list
- Open and Draft chips have `active` class by default

### css/kiosk.css
- `.kiosk-so-status-filter`: flex row with wrap, 8px gap, raised background
- `.kiosk-so-chip`: pill shape (20px radius), 36px min-height, status-specific active colors
- `.kiosk-so-card-actions`: flex row for pay/import/reorder buttons
- `.kiosk-cart-so-banner`: info-colored banner for imported SO association
- `.kiosk-cart-so-clear`: minimal clear button for detaching SO

### js/kiosk.js
- **State**: `_kioskImportedSoId`, `_kioskImportedSoNumber`, `_kioskImportedSoUpdated`, `_kioskSoActiveChips`
- **kioskFindProductById**: catalog lookup by item_id for import flow
- **kioskLoadSalesOrders**: no longer takes searchTerm param, no `?search=` query string, calls kioskRenderSoChips after load
- **kioskRenderSoList**: chip filter (confirmed->paid mapping) applied before search filter, conditional action rows (collect+import for actionable, reorder for closed/paid), wires import/reorder click handlers
- **kioskRenderSoChips / kioskWireSoChips**: multi-select chip toggle with All-deactivates-others logic
- **kioskImportSoToCart**: confirm dialog if cart non-empty, catalog lookup per line item, sets imported SO state, syncs maker's fee, navigates to browse
- **kioskReorderSo**: confirm dialog, calls salesorder-create with copied line items, reloads SO list on success
- **kioskClearImportedSo**: resets all 3 imported SO state variables
- **kioskProceedToPayment fork**: if imported SO not yet updated, PUT to salesorder-update first then kioskCollectPayment; if already updated (retry), skip update and go straight to kioskCollectPayment; else existing new-sale flow
- **kioskRenderCart**: prepends SO import banner with clear button when imported SO is active
- **Receipt handlers**: both new-sale and SO-payment handlers clear imported SO state
- **Search input**: now calls kioskRenderSoList() (client-side filter) instead of kioskLoadSalesOrders(term)
- **Init**: kioskWireSoChips() wired on DOMContentLoaded

## Deviations from Plan

None - plan executed exactly as written.

## Threat Model Compliance

All mitigations from the plan's threat model are implemented:
- **T-04-06** (XSS in card HTML): All SO data (customer_name, salesorder_number, salesorder_id, line item names) wrapped in escapeHTML()
- **T-04-07** (XSS in banner): _kioskImportedSoNumber passed through escapeHTML() in banner HTML
- **T-04-08** (DoS - premature terminal charge): Terminal not charged until SO update succeeds; on failure, show error and stop
- **T-04-09** (Double update on retry): _kioskImportedSoUpdated flag prevents re-sending PUT; retry goes directly to kioskCollectPayment
- **T-04-10** (Info disclosure - closed/paid SOs): Accepted -- visible to authenticated kiosk staff as intended

## Self-Check: PASSED
