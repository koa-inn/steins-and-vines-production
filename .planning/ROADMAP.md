# Roadmap: Steins & Vines

## Milestones

- **v1.0 Kiosk Production Readiness** - Phases 1-4 (in progress)
- **v1.1 Brewpad Reliability & Integration** - Phases 5-7 (planned)

<details>
<summary>v1.0 Kiosk Production Readiness (Phases 1-4)</summary>

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
- [x] 01-01-PLAN.md -- Fix category filter: kioskItemCategory returns category_name only, add Other option for uncategorized items
- [x] 01-02-PLAN.md -- Add stock overflow warning: confirm dialog when cart qty exceeds stock, verify existing stock/cache behaviors
- [x] 01-03-PLAN.md -- Deploy to staging and human verification of all Phase 1 changes

### Phase 2: Sales Order Integrity
**Goal**: Every kiosk payment results in a Zoho sales order with correct line items, amounts, and tax -- and stock levels refresh automatically after the sale
**Depends on**: Phase 1
**Requirements**: SO-01, SO-02, SO-03, STOCK-03
**Success Criteria** (what must be TRUE):
  1. A completed kiosk sale creates a sales order in Zoho Books with line items matching the cart (correct SKUs, quantities, unit prices)
  2. Tax amounts on the sales order match Zoho tax rules for each line item
  3. If Zoho sales order creation fails after a successful Helcim charge, the payment is auto-voided and staff see an on-screen notification
  4. After a completed sale, kiosk product stock levels update without staff needing to manually refresh or bust the cache
**Plans:** 2 plans

Plans:
- [x] 02-01-PLAN.md -- Per-item tax_id on invoice line items for both sale flows + SO-to-Invoice conversion in salesorder-pay
- [x] 02-02-PLAN.md -- Full-screen void error with transaction ID, post-sale product refresh on receipt dismiss, negative stock display

### Phase 3: Resilience & Session Stability
**Goal**: The kiosk recovers gracefully from network problems, terminal issues, and session interruptions without leaving staff stranded
**Depends on**: Phase 2
**Requirements**: REL-01, REL-02, REL-03
**Success Criteria** (what must be TRUE):
  1. If the network drops during product load, cart update, or payment, the kiosk shows a clear error message and allows retry -- it never shows a blank screen or spinner that never resolves
  2. If the Helcim terminal times out or fails to respond, the kiosk UI returns to a usable state with a clear message (not stuck on "Processing...")
  3. PIN login works correctly after page refresh, browser restart, and across multiple sessions without requiring workarounds
**Plans**: 1 complete, more TBD

Plans:
- [x] 03-01-PLAN.md -- Split terminal payment into 3 short-lived steps (push, poll, confirm) to eliminate gateway timeouts
- [ ] 03-02: Network error handling, retry UX, session stability (not yet planned)

### Phase 4: Sales Order Management
**Goal**: Staff can view all sales orders (including closed/paid), import an existing Zoho SO into the kiosk cart, process payment, and have the SO marked as closed/paid in Zoho
**Depends on**: Phase 2
**Requirements**: SOM-01, SOM-02, SOM-03
**Success Criteria** (what must be TRUE):
  1. Sales order list shows all statuses (open, draft, closed, paid) with a filter toggle -- not just open/draft
  2. Staff can select an existing sales order and load its line items into the kiosk cart for payment processing
  3. After payment is collected on an imported SO, the sales order is marked as closed/paid in Zoho with the payment linked
**Plans**: 2 plans

Plans:
- [x] 04-01-PLAN.md -- Extend GET /api/kiosk/salesorders (4-status fetch, item_id) + new PUT /api/kiosk/salesorder-update endpoint
- [x] 04-02-PLAN.md -- Kiosk frontend SO tab with cart import and payment flow

</details>

## v1.1 Brewpad Reliability & Integration

**Milestone Goal:** Staff can trust BrewPad to save their work and see the full journey from kit sale to finished batch. Auth never silently expires, form data is never lost, and every batch traces back to its sales order.

## Phases

- [x] **Phase 5: Auth Reliability** - BrewPad sessions persist reliably, form data survives token refresh, and login prompts never stack (completed 2026-04-29)
- [ ] **Phase 6: Kiosk-to-Brewpad Integration** - Kit sales on the kiosk auto-create linked batches in BrewPad
- [ ] **Phase 7: Zoho Audit Trail** - Full traceability from Zoho sale through fermentation to batch completion

## Phase Details

### Phase 5: Auth Reliability
**Goal**: Staff can use BrewPad for extended sessions without losing work to silent auth failures or duplicate login prompts
**Depends on**: Nothing (first phase of v1.1 milestone; no dependency on v1.0 phases)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04
**Success Criteria** (what must be TRUE):
  1. A staff member can open BrewPad on Monday, leave the iPad idle overnight, and resume use Tuesday morning without re-logging in
  2. If a staff member is mid-way through entering a plato reading or editing a batch and the OAuth token expires, the token refreshes silently and the form data they entered is still there when the refresh completes
  3. When a token refresh or login is triggered, only one login prompt appears at a time -- no stacked dialogs, no duplicate GSI popups
  4. A clear "session expiring" warning appears before the session actually expires, giving staff the option to extend without interruption
**Plans:** 2 plans

Plans:
- [x] 05-01-PLAN.md -- Auth refresh infrastructure: mutex, visibility handler, 7-day session persistence, error_callback, timer modifications, auth dot CSS
- [x] 05-02-PLAN.md -- Form state protection: 5 form type save/restore registry, session expired overlay, restore toast, unit tests

### Phase 6: Kiosk-to-Brewpad Integration
**Goal**: When a kit is sold on the kiosk, a batch is automatically created in BrewPad so staff never have to manually duplicate sale data
**Depends on**: Phase 5
**Requirements**: INTG-01, INTG-02, INTG-03
**Success Criteria** (what must be TRUE):
  1. After a kit sale completes on the kiosk, a new batch appears in BrewPad's batch list within 30 seconds -- with customer name, product name, and Zoho SO number pre-filled
  2. Auto-created batches are visually distinguishable in the batch list (a "from kiosk" badge or indicator) so staff know which batches were auto-generated vs. manually created
  3. Opening the detail view of an auto-created batch shows the linked Zoho sales order number as a visible reference
**Plans:** 3 plans

Plans:
- [x] 06-01-PLAN.md -- Apps Script pending batch mode: createBatch accepts optional schedule, doPost server-token branch handles create_batch action, Batches sheet column setup
- [x] 06-02-PLAN.md -- Middleware integration: brewpad-integration.js module with fire-and-forget Apps Script call, Redis retry queue, pos.js hook, server.js retry sweep
- [x] 06-03-PLAN.md -- BrewPad frontend: Pending status badge, Kiosk source badge, Pending filter button, Zoho Ref in detail view, unit tests, build

### Phase 7: Zoho Audit Trail
**Goal**: Every batch carries its full provenance from sale to completion, and Zoho reflects batch status so the business has a single source of truth
**Depends on**: Phase 6
**Requirements**: ZOHO-01, ZOHO-02, ZOHO-03
**Success Criteria** (what must be TRUE):
  1. Every batch record (whether auto-created or manual) stores the originating Zoho SO number and customer ID, visible in the batch detail view
  2. The corresponding Zoho sales order shows the batch's current status (active or complete) -- via a custom field or note that updates as the batch progresses
  3. Staff can view a single timeline or summary showing the full lifecycle: sale date and SO number, batch creation, fermentation start, key milestones, and completion -- without switching between BrewPad and Zoho
**Plans**: TBD

### Phase 8: First-Batch Promo
**Goal**: New customers see a 20% discount offer on the homepage and can apply promo code FIRSTBATCH at checkout, with one-use-per-email enforcement, plus checkout form persistence and cart merge feasibility
**Depends on**: Nothing (independent of Phase 7)
**Requirements**: PROMO-01, PROMO-02, PROMO-03, FORM-01, CART-01
**Success Criteria** (what must be TRUE):
  1. Homepage displays a prominent banner advertising "20% off your first batch" with the code FIRSTBATCH clearly visible
  2. Checkout flow has a promo code input field that accepts FIRSTBATCH and applies a 20% discount to kit line items before payment
  3. If a customer email has already redeemed FIRSTBATCH, the code is rejected with a clear message -- enforced server-side via Redis
  4. Checkout form fields (name, email, phone) persist across page refresh via localStorage
  5. Cart merge feasibility assessment documents all affected code paths and proposes an implementation roadmap
**Plans:** 6/6 plans complete

Plans:
- [x] 08-01-PLAN.md -- Server-side promo validation: POST /api/promo/validate endpoint, PROMO_REDEEMED_PREFIX constant, Redis redemption check, admin reset endpoint, unit tests
- [x] 08-02-PLAN.md -- Checkout integration: promo code widget in 12-checkout.js, server-side re-validation and Maker's Fee discount in checkout.js, redemption burn after SO creation, promo CSS
- [x] 08-03-PLAN.md -- Homepage banner: promo-banner in content/home.json, #promo-banner element in index.html, initPromoBanner() in 13-init.js, dismiss button CSS
- [x] 08-04-PLAN.md -- Gap closure: fix promo discount display in dual-cart combined totals (re-render trigger + regression test)
- [x] 08-05-PLAN.md -- Checkout form persistence: localStorage-based save/restore for name, email, phone fields
- [x] 08-06-PLAN.md -- Cart merge feasibility assessment: impact analysis of unifying dual cart into single cart

### Phase 9: Content & SEO Push
**Goal**: Product pages and homepage feel professional, trustworthy, and discoverable — with real facility photos, SEO landing copy, and linked Google Review testimonials
**Depends on**: Nothing (independent — can run in parallel with Phase 8)
**Requirements**: SEO-01, SEO-02, SEO-03
**Success Criteria** (what must be TRUE):
  1. Ferment-in-store and ingredients/supplies product pages have unique, SEO-targeted landing copy that describes what the business offers and why
  2. Professional facility/process photos appear on the homepage and product pages
  3. Customer testimonials from Google Reviews are displayed on the site with links back to the original reviews
**Plans:** 3 plans

Plans:
**Wave 1** *(no dependencies — run in parallel)*
- [x] 09-01-PLAN.md -- Homepage testimonials: reviews.json, testimonial CSS, loadTestimonials() in 13-init.js, testimonials section in index.html
- [x] 09-02-PLAN.md -- SEO landing copy: inline HTML sections in ferment-in-store.html and ingredients-supplies.html with compliance-reviewed content

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 09-03-PLAN.md -- Facility photos: user provides photos, placement on landing pages + homepage + about page, photo CSS, visual verification

## Progress

**Execution Order:**
Phases execute in numeric order: 5 -> 6 -> 7 (Phases 8 and 9 can run in parallel, independent of 7)

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Catalog & Stock Display | v1.0 | 3/3 | Complete | 2026-04-28 |
| 2. Sales Order Integrity | v1.0 | 2/2 | Complete | 2026-04-28 |
| 3. Resilience & Session Stability | v1.0 | 1/1+ | In progress | - |
| 4. Sales Order Management | v1.0 | 2/2 | Complete | 2026-04-28 |
| 5. Auth Reliability | v1.1 | 2/2 | Complete | 2026-04-29 |
| 6. Kiosk-to-Brewpad Integration | v1.1 | 3/3 | Complete | 2026-05-03 |
| 7. Zoho Audit Trail | v1.1 | 0/? | Not started | - |
| 8. First-Batch Promo | v1.1 | 6/6 | Complete   | 2026-05-04 |
| 9. Content & SEO Push | v1.1 | 3/3 | Complete | 2026-05-04 |
