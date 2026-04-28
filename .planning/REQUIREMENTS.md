# Requirements: Kiosk Production Readiness

**Defined:** 2026-04-27
**Core Value:** Every kiosk sale must result in an accurate Zoho sales order with correct stock deduction.

## v1 Requirements

### Stock Accuracy

- [x] **STOCK-01**: Kiosk displays current stock levels for each product from Zoho Inventory
- [x] **STOCK-02**: When cart quantity exceeds available stock, user sees a warning with option to override or reduce quantity
- [ ] **STOCK-03**: Stock levels update after a completed sale without requiring manual cache bust
- [x] **STOCK-04**: Out-of-stock items show a warning when added to cart with option to override (existing behavior — verify working)

### Catalog Display

- [x] **CAT-01**: Category filter dropdown only shows actual product categories, not Zoho item types ("goods", "services")
- [x] **CAT-02**: Products display correct category labels derived from `category_name`, not fallback to `product_type`

### Sales Orders

- [ ] **SO-01**: Completed kiosk sale creates a sales order in Zoho Books with correct line items, quantities, and amounts
- [ ] **SO-02**: Sales order includes correct tax calculation matching Zoho tax rules
- [ ] **SO-03**: Failed Zoho sales order creation after successful payment triggers auto-void and staff notification

### Sales Order Management

- [ ] **SOM-01**: Sales order list shows all statuses (open, draft, closed, paid) with a filter toggle
- [ ] **SOM-02**: Staff can import an existing Zoho sales order's line items into the kiosk cart for payment
- [ ] **SOM-03**: After payment on an imported SO, the sales order is marked closed/paid in Zoho with payment linked

### Reliability

- [ ] **REL-01**: Kiosk handles network interruptions gracefully during product load, cart operations, and payment
- [ ] **REL-02**: Kiosk handles Helcim terminal timeout without leaving the UI in a broken state
- [ ] **REL-03**: PIN login works reliably across sessions and after page refresh

## v2 Requirements

### Kiosk Enhancements

- **ENH-01**: Receipt printing from kiosk
- **ENH-02**: Shift/daily sales reporting
- **ENH-03**: Refund processing through kiosk
- **ENH-04**: Barcode/SKU scanner input

## Out of Scope

| Feature | Reason |
|---------|--------|
| Online checkout changes | Separate system, not part of kiosk readiness |
| Admin dashboard changes | No kiosk admin work in scope |
| New payment methods | Helcim terminal is the only kiosk payment method |
| Kiosk UI redesign | Polish only, no structural UI changes |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| STOCK-01 | Phase 1 | Complete (01-02) |
| STOCK-02 | Phase 1 | Complete (01-02) |
| STOCK-03 | Phase 2 | Pending |
| STOCK-04 | Phase 1 | Complete (01-02) |
| CAT-01 | Phase 1 | Complete (01-01) |
| CAT-02 | Phase 1 | Complete (01-01) |
| SO-01 | Phase 2 | Pending |
| SO-02 | Phase 2 | Pending |
| SO-03 | Phase 2 | Pending |
| REL-01 | Phase 3 | Pending |
| REL-02 | Phase 3 | Pending |
| REL-03 | Phase 3 | Pending |
| SOM-01 | Phase 4 | In Progress (04-01: backend 4-status GET) |
| SOM-02 | Phase 4 | In Progress (04-01: item_id in GET response) |
| SOM-03 | Phase 4 | In Progress (04-01: PUT salesorder-update endpoint) |

**Coverage:**
- v1 requirements: 15 total
- Mapped to phases: 15
- Unmapped: 0

---
*Requirements defined: 2026-04-27*
*Last updated: 2026-04-28 — Phase 4 Plan 01 backend complete (SOM-01/02/03 in progress)*
