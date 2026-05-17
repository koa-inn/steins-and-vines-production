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
- [x] **Phase 11: Producer & Brand Visibility** - Kit product cards show producer and brand so customers can distinguish kits from multiple producers (completed 2026-05-06)

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
**Plans:** 3 plans

Plans:
**Wave 1** *(no dependencies -- run in parallel)*
- [x] 07-01-PLAN.md -- Middleware Zoho sync: POST /api/batch/sync-zoho endpoint, syncBatchToZoho/retrySyncQueue in brewpad-integration.js, Redis retry queue, unit tests
- [x] 07-02-PLAN.md -- Apps Script backend: extend updateBatch allowedFields for SO linking, fermentation_started_at in updateBatchSchedule, completed_at in handlePackagingCompletion, createBatch appendRow extension

**Wave 2** *(depends on Wave 1)*
- [x] 07-03-PLAN.md -- BrewPad frontend: lifecycle timeline, Link to Sales Order search/link UI, Zoho sync indicator, CSS, unit tests, build

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
| 7. Zoho Audit Trail | v1.1 | 0/3 | Not started | - |
| 8. First-Batch Promo | v1.1 | 6/6 | Complete   | 2026-05-04 |
| 9. Content & SEO Push | v1.1 | 3/3 | Complete | 2026-05-04 |
| 10. Checkout Payment Safety | v1.1 | 4/4 | Complete   | 2026-05-06 |
| 11. Producer & Brand Visibility | v1.1 | 3/3 | Complete   | 2026-05-06 |

### Phase 10: Checkout Payment Safety
**Goal**: Prevent duplicate Helcim charges during checkout by implementing a proper payment state machine, clearing stale tokens on error, and ensuring confirmation reaches both customer and store — zero tolerance for silent charge failures
**Depends on**: Phase 8 (shares checkout.js code)
**Requirements**: PAY-SAFE-01, PAY-SAFE-02, PAY-SAFE-03
**Success Criteria** (what must be TRUE):
  1. After a failed `/api/checkout` call where the card was charged, the user CANNOT trigger a second Helcim iframe — they see a "Processing refund..." state until the void confirms or times out
  2. The `_helcimCheckoutToken` and `_helcimTransactionId` variables are both cleared to null on every error path (single-cart catch, dual-cart onError, ABORTED postMessage)
  3. If the Zoho confirmation email (`/salesorders/{id}/email`) fails, the customer still sees a success page AND a fallback email is sent via the SMTP mailer
  4. Frontend generates and sends a unique idempotency key per checkout attempt — server rejects duplicates with 409 rather than creating a second sales order
**Plans:** 4/4 plans complete

Plans:
**Wave 1** *(no dependencies — run in parallel)*
- [x] 10-01-PLAN.md -- Frontend payment state machine: cooldown lock, clear all Helcim state on error paths, client-side idempotency key generation, unit tests
- [x] 10-02-PLAN.md -- Server-side fallback email: sendCustomerConfirmation in mailer.js, Zoho email .catch() fallback, staff email eventLog, unit tests

**Wave 2** *(depends on Wave 1)*
- [x] 10-03-PLAN.md -- Integration verification: full test suite pass, lint clean, npm run build produces deployable artifacts

### Phase 11: Producer & Brand Visibility
**Goal**: Kit product cards and all product name displays show the producer (Zoho Manufacturer field) and brand in a consistent "Producer Brand - Product Name" format, so customers can distinguish kits from multiple producers
**Depends on**: Phase 8 (shares catalog and product card code)
**Requirements**: PROD-VIS-01, PROD-VIS-02, PROD-VIS-03
**Success Criteria** (what must be TRUE):
  1. Middleware pipes the Zoho `manufacturer` field through catalog enrichment and returns it in the product API response
  2. All kit card types (wine label, beer label, default) display producer and brand above or before the product name
  3. Checkout review, cart sidebar, kiosk cards, and admin views show producer/brand context where space allows
**Plans:** 3/3 plans complete

Plans:
**Wave 1** *(no dependencies)*
- [x] 11-01-PLAN.md -- Middleware enrichment: add manufacturer_name to 3 catalog.js enrichment paths + shapeProduct(), unit tests
**Wave 2** *(depends on Wave 1 -- needs manufacturer in API response)*
- [x] 11-02-PLAN.md -- Product card producers: add producer element to 6 card builders (3 featured + 3 catalog), Producer filter on catalog page, all CSS, frontend tests, build
**Wave 3** *(depends on Wave 1 + Wave 2 -- needs CSS classes from Plan 02)*
- [x] 11-03-PLAN.md -- Compact view producers: cart sidebar (inline per D-03), checkout table, kiosk grid/list, admin kit table, HTML changes, frontend tests, build

---

## v2.0 Recipe-Based Products

**Milestone Goal:** Customers can browse pre-made beer and ferment recipes, and staff can sell them through the kiosk with ingredient-level inventory deduction, automatic batch creation in BrewPad, and a feature flag preventing live sales until the federal brewing licence is granted.

## Phases

- [x] **Phase 12: Recipe Data Foundation** - Recipe schema, Apps Script CRUD, feature flag, and fee item confirmation established before any sale code is written (completed 2026-05-16)
- [x] **Phase 13: Middleware API + Admin Recipe Management** - Staff can create, edit, and activate recipes via the admin panel; middleware API exposes recipe CRUD and availability checking (completed 2026-05-17)
- [x] **Phase 14: Kiosk Recipe Sales, Inventory, and Batch Creation** - Staff can select a recipe on the kiosk, process payment, have ingredients deducted from Zoho Inventory, and get a batch auto-created in BrewPad (completed 2026-05-17)
- [ ] **Phase 15: BeerXML Import** - Staff can upload a BeerXML file, review an ingredient-to-SKU mapping table, and save the recipe as a draft without manual data entry

## Phase Details

### Phase 12: Recipe Data Foundation
**Goal**: The recipe schema, feature gate, and fee item confirmation are locked in place so no downstream code can be built on an unstable foundation
**Depends on**: Nothing (first phase of v2.0 milestone)
**Requirements**: RDM-01, RDM-02, RDM-03, RDM-04, RDM-05
**Success Criteria** (what must be TRUE):
  1. A Google Sheets "Recipes" tab exists with columns for name, style metadata (ABV, IBU, colour, batch size), a separate RecipeIngredients tab (Zoho SKUs and quantities), locked_price, service_fee, materials_fee, and status
  2. Apps Script exposes `create_recipe`, `get_recipes`, `update_recipe`, and `delete_recipe` actions authenticated by staff OAuth (primary) and server token (create_recipe only, for middleware integration)
  3. A `recipe_id` column and a `recipe_snapshot` JSON column exist in the Batches sheet, populated at sale time and never updated by recipe edits afterward
  4. `BEER_SALES_ENABLED` env var is registered in middleware startup validation and set to `false` in Railway (enforcement at the confirm endpoint is delivered in Phase 14 SC2)
  5. The existing Maker's Fee (`MAKERS_FEE_ITEM_ID`) and Materials Fee (`MATERIALS_FEE_ITEM_ID`) Zoho service items are confirmed set in Railway env vars and will be reused for recipe sales (per D-03 -- no new Zoho service items created)
**Plans:** 2/2 plans complete

Plans:
**Wave 1**
- [x] 12-01-PLAN.md -- Apps Script recipe CRUD: Recipes + RecipeIngredients sheet constants, create/get/update/delete recipe actions, setupRecipeTabs utility, cache invalidation

**Wave 2** *(depends on Wave 1 -- extends setupRecipeTabs and modifies adminApi.gs)*
- [x] 12-02-PLAN.md -- Infrastructure scaffolding: BEER_SALES_ENABLED env var, CACHE_KEYS.RECIPES, ITEM_TYPES.RECIPE, Batches sheet recipe_id/recipe_snapshot columns, fee env var confirmation

### Phase 13: Middleware API + Admin Recipe Management
**Goal**: Staff have a working admin interface to create and manage recipes, and the middleware API is the authoritative contract that kiosk and admin both depend on
**Depends on**: Phase 12
**Requirements**: API-01, API-02, API-03, ADM-01, ADM-02, ADM-03
**Success Criteria** (what must be TRUE):
  1. Staff can open the admin panel, navigate to a "Recipes" tab, and see a list of all recipes with their status (draft, active, inactive)
  2. Staff can create a new recipe by entering a name, style metadata, ingredient line items (Zoho SKU lookup with quantity), locked price, and brewing fee — and save it
  3. Staff can edit an existing recipe's ingredients, price, or fee, and activate or deactivate it without affecting any already-created batch snapshots
  4. The middleware `GET /api/recipes/:id/availability` endpoint returns whether all ingredient SKUs have sufficient Zoho stock for a given recipe quantity
  5. The middleware resolves all ingredient references to Zoho item IDs server-side — the client supplies only a recipe ID, never raw SKU lists
**Plans:** 4/4 plans complete
**UI hint**: yes

Plans:
**Wave 1** *(no dependencies -- run in parallel)*
- [x] 13-01-PLAN.md -- Apps Script bug fixes: CR-01 lock protection on updateRecipe/deleteRecipe, WR-01 hard error on missing sheet, WR-02 dead cache key removal, WR-03 parameterized cache key
- [x] 13-02-PLAN.md -- Middleware recipe API: routes/recipes.js with CRUD + availability endpoints, Redis caching, activation guardrail, unit tests, server.js mount

**Wave 2** *(depends on Wave 1 Plan 02)*
- [x] 13-03-PLAN.md -- Admin Recipes tab: HTML shell, recipe list/detail/editor views, ingredient autocomplete, availability indicators, activation guardrail, CSS, frontend tests, build

**Wave 3** *(depends on Wave 1 + Wave 2)*
- [x] 13-04-PLAN.md -- Deploy to staging, Apps Script deployment, human verification of full CRUD and availability flow

### Phase 14: Kiosk Recipe Sales, Inventory, and Batch Creation
**Goal**: A complete recipe sale can be processed end-to-end on the kiosk — ingredients reserved, payment collected, Zoho invoice created, inventory deducted, and a single batch record created in BrewPad
**Depends on**: Phase 13
**Requirements**: KSK-01, KSK-02, KSK-03, KSK-04, BAT-01, BAT-02, BAT-03, INV-01, INV-02, INV-03
**Success Criteria** (what must be TRUE):
  1. Staff can open a "Recipes" tab on the kiosk, browse active recipes, and select one — the kiosk cart auto-populates with all ingredient line items and the brewing fee in one action
  2. The kiosk refuses to proceed to payment for any recipe sale when `BEER_SALES_ENABLED` is false, enforced server-side at the confirm endpoint
  3. A completed recipe sale creates a Zoho invoice with one line item per ingredient plus a brewing fee line item, and each ingredient's stock level in Zoho Inventory decreases by the recipe quantity
  4. Within 30 seconds of a successful recipe sale, exactly one new batch appears in BrewPad — linked to the recipe ID, carrying the full ingredient snapshot at time of sale, and showing the Zoho SO number
  5. If payment fails or is cancelled after ingredients are reserved, reserved ingredient quantities are released and no partial batch is created
**Plans:** 5/5 plans complete
**UI hint**: yes

Plans:
**Wave 1** *(no dependencies -- run in parallel)*
- [x] 14-01-PLAN.md -- Foundation wiring: LOCK_KEYS.RECIPE_SALE constant, MILLING_FEE_ITEM_ID env var, detectRecipeSale() in brewpad-integration.js, unit tests
- [x] 14-02-PLAN.md -- Recipe sale endpoint: pos-recipe.js with initiate + confirm handlers, mutex, feature gate, void-on-failure, server.js mount, unit tests

**Wave 2** *(depends on Wave 1 Plan 02)*
- [x] 14-03-PLAN.md -- Kiosk recipe browser UI: mode toggle, recipe cards, sale-type prompt, availability check, cart population, checkout routing in admin.js + admin.html
- [x] 14-04-PLAN.md -- Recipe browser CSS: mode toggle, sale-type buttons, availability banners, milling toggle styles in kiosk.css

**Wave 3** *(depends on all Wave 1 + Wave 2)*
- [~] 14-05-PLAN.md -- Integration verification: full test suite, lint, build, staging deploy, human verification of recipe sale flow (Task 1 complete — awaiting human staging sign-off)

### Phase 15: BeerXML Import
**Goal**: Staff can import a recipe from any BeerSmith-compatible .xml export rather than entering every ingredient manually, with a mandatory review step before any data is saved
**Depends on**: Phase 13 (requires admin recipe UI and API to exist before the import flow can deposit into them)
**Requirements**: IMP-01, IMP-02, IMP-03, IMP-04
**Success Criteria** (what must be TRUE):
  1. Staff can upload a .xml file in the admin Recipes tab and see a parsed ingredient list extracted from the BeerXML — fermentables, hops, yeast, and misc items with quantities in kg (using AMOUNT, not DISPLAY_AMOUNT)
  2. Each parsed ingredient is shown alongside its closest Zoho SKU match; staff can accept, reject, or manually correct each mapping before saving
  3. The imported recipe is saved with status "draft" — it does not appear in the kiosk recipe browser or the public site until staff explicitly activate it after setting a price
  4. A BeerXML file larger than 500KB or containing malformed XML is rejected at upload with a clear error message before any parsing occurs
**Plans**: 2 plans

Plans:
**Wave 1** *(no dependencies)*
- [x] 15-01-PLAN.md -- TDD: parseBeerXML and autoMatchIngredients pure functions with unit tests (fermentable/hop/yeast/misc extraction, kg/g/pcs conversion, fuzzy catalog matching with confidence scoring)

**Wave 2** *(depends on Wave 1 -- needs parser and matcher functions)*
- [ ] 15-02-PLAN.md -- Import UI: admin.html button + file input, CSS confidence badges and review table styles, validateAndReadBeerXML + showBeerXMLReviewModal + confirmBeerXMLImport in admin.js, build, human verification

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 12. Recipe Data Foundation | v2.0 | 2/2 | Complete    | 2026-05-16 |
| 13. Middleware API + Admin Recipe Management | v2.0 | 4/4 | Complete   | 2026-05-17 |
| 14. Kiosk Recipe Sales, Inventory, and Batch Creation | v2.0 | 5/5 | Complete    | 2026-05-17 |
| 15. BeerXML Import | v2.0 | 1/2 | In Progress|  |
