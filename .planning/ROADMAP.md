# Roadmap: Kiosk Production Readiness

## Overview

The kiosk works end-to-end but needs hardening before daily production use. This roadmap fixes what users see (stock levels and catalog display), ensures what happens after payment is correct (Zoho sales orders with accurate line items and tax), and then hardens the system against real-world conditions (network failures, terminal timeouts, session stability). Three phases, each delivering a verifiable capability.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Catalog & Stock Display** - Products show correct categories and accurate stock levels with override warnings
- [ ] **Phase 2: Sales Order Integrity** - Every completed sale creates a correct Zoho sales order with proper tax and post-sale stock refresh
- [ ] **Phase 3: Resilience & Session Stability** - Kiosk handles network failures, terminal timeouts, and session refresh gracefully

## Phase Details

### Phase 1: Catalog & Stock Display
**Goal**: Staff and customers see accurate product information with correct categories and real-time stock levels before adding to cart
**Depends on**: Nothing (first phase)
**Requirements**: STOCK-01, STOCK-02, STOCK-04, CAT-01, CAT-02
**Success Criteria** (what must be TRUE):
  1. Product cards show current stock quantities sourced from Zoho Inventory
  2. Category filter dropdown contains only real product categories (e.g., "Wine Kits", "Beer Kits"), not Zoho item types like "goods" or "services"
  3. When a user adds more items than available stock, a warning appears with options to override or reduce quantity
  4. Out-of-stock items display a clear warning when added to cart, with override available for staff
  5. Product category labels come from `category_name`, not fallback `product_type` values
**Plans:** 3 plans

Plans:
**Wave 1**
- [ ] 01-01-PLAN.md — Fix category filter: kioskItemCategory returns category_name only, add Other option for uncategorized items
**Wave 2** *(blocked on Wave 1 completion)*
- [ ] 01-02-PLAN.md — Add stock overflow warning: confirm dialog when cart qty exceeds stock, verify existing stock/cache behaviors
**Wave 3** *(blocked on Wave 2 completion)*
- [ ] 01-03-PLAN.md — Deploy to staging and human verification of all Phase 1 changes

### Phase 2: Sales Order Integrity
**Goal**: Every kiosk payment results in a Zoho sales order with correct line items, amounts, and tax -- and stock levels refresh automatically after the sale
**Depends on**: Phase 1
**Requirements**: SO-01, SO-02, SO-03, STOCK-03
**Success Criteria** (what must be TRUE):
  1. A completed kiosk sale creates a sales order in Zoho Books with line items matching the cart (correct SKUs, quantities, unit prices)
  2. Tax amounts on the sales order match Zoho tax rules for each line item
  3. If Zoho sales order creation fails after a successful Helcim charge, the payment is auto-voided and staff see an on-screen notification
  4. After a completed sale, kiosk product stock levels update without staff needing to manually refresh or bust the cache
**Plans**: TBD

Plans:
- [ ] 02-01: TBD
- [ ] 02-02: TBD

### Phase 3: Resilience & Session Stability
**Goal**: The kiosk recovers gracefully from network problems, terminal issues, and session interruptions without leaving staff stranded
**Depends on**: Phase 2
**Requirements**: REL-01, REL-02, REL-03
**Success Criteria** (what must be TRUE):
  1. If the network drops during product load, cart update, or payment, the kiosk shows a clear error message and allows retry -- it never shows a blank screen or spinner that never resolves
  2. If the Helcim terminal times out or fails to respond, the kiosk UI returns to a usable state with a clear message (not stuck on "Processing...")
  3. PIN login works correctly after page refresh, browser restart, and across multiple sessions without requiring workarounds
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Catalog & Stock Display | 0/3 | Planning complete | - |
| 2. Sales Order Integrity | 0/0 | Not started | - |
| 3. Resilience & Session Stability | 0/0 | Not started | - |
