# Roadmap: Steins & Vines

## Milestones

- ✅ **v1.0 Kiosk Production Readiness** — Phases 1-4 (shipped 2026-04-28)
- ✅ **v1.1 Brewpad Reliability & Integration** — Phases 5-11 (shipped 2026-05-06)
- ✅ **v2.0 Recipe-Based Products** — Phases 12-19 (shipped 2026-05-27)
- ✅ **v3.0 Catalog Subpages** — Phases 20-24 (shipped 2026-06-03)
- 🚧 **v4.0 Booking Migration (Cal.com)** — Phase 25 (in progress)

## Phases

<details>
<summary>✅ v1.0 Kiosk Production Readiness (Phases 1-4) — SHIPPED 2026-04-28</summary>

- [x] Phase 1: Catalog & Stock Display (3/3 plans)
- [x] Phase 2: Sales Order Integrity (2/2 plans)
- [x] Phase 3: Resilience & Session Stability (1/1 plans)
- [x] Phase 4: Sales Order Management (2/2 plans)

</details>

<details>
<summary>✅ v1.1 Brewpad Reliability & Integration (Phases 5-11) — SHIPPED 2026-05-06</summary>

- [x] Phase 5: Auth Reliability (2/2 plans)
- [x] Phase 6: Kiosk-to-Brewpad Integration (3/3 plans)
- [x] Phase 7: Zoho Audit Trail (3/3 plans)
- [x] Phase 8: First-Batch Promo (6/6 plans)
- [x] Phase 9: Content & SEO Push (3/3 plans)
- [x] Phase 10: Checkout Payment Safety (4/4 plans)
- [x] Phase 11: Producer & Brand Visibility (3/3 plans)

</details>

<details>
<summary>✅ v2.0 Recipe-Based Products (Phases 12-19) — SHIPPED 2026-05-27</summary>

- [x] Phase 12: Recipe Data Foundation (2/2 plans) — completed 2026-05-16
- [x] Phase 13: Middleware API + Admin Recipe Management (4/4 plans) — completed 2026-05-17
- [x] Phase 14: Kiosk Recipe Sales, Inventory, and Batch Creation (5/5 plans) — completed 2026-05-17
- [x] Phase 15: BeerXML Import (2/2 plans) — completed 2026-05-17
- [x] Phase 16: Recipe Management — BrewPad, Kiosk & Batch Integration (3/3 plans) — completed 2026-05-18
- [x] Phase 17: Custom Labels Page (3/3 plans) — completed 2026-05-18
- [x] Phase 18: Custom Labels Iteration (3/3 plans) — completed 2026-05-19
- [x] Phase 19: Hop Inventory Catalog (3/3 plans) — completed 2026-05-19

</details>

### ✅ v3.0 Catalog Subpages (Shipped 2026-06-03)

**Milestone Goal:** Break the monolithic ingredients page into dedicated category subpages with shared template, cross-category navigation, and unified search.

- [x] **Phase 20: Zoho Data Foundation** - Tag all ingredient items with subcategory; refresh snapshot pipeline
- [x] **Phase 21: Shared Template & Build Infrastructure** - Shared JS module, CSS, and build pipeline for all subpages (completed 2026-05-29)
- [x] **Phase 22: Category Subpages & Navigation** - All 5 subpages live with sub-nav and main nav dropdown (completed 2026-05-29)
- [x] **Phase 23: Cross-Category Search** - Search overlay with grouped results and deep-link navigation (completed 2026-05-30)
- [x] **Phase 24: SEO & Staging Deploy** - Per-subpage SEO meta, QA pass, and staging deployment (completed 2026-06-03)

### 🚧 v4.0 Booking Migration (Cal.com) (In Progress)

**Milestone Goal:** Replace the Zoho Bookings backend with Cal.com Cloud (free tier) behind the existing `/api/bookings*` middleware contract — keeping the website checkout flow unchanged — with multiple appointment types and HTTPS-based confirmation emails (Railway blocks outbound SMTP).

- [ ] **Phase 25: Cal.com Booking Migration** - Swap Zoho Bookings → Cal.com Cloud behind unchanged `/api/bookings*` endpoints; multiple event types; manual cutover of existing appointments

## Phase Details

### Phase 20: Zoho Data Foundation

**Goal**: All ingredient items carry accurate subcategory data so the frontend can filter correctly
**Depends on**: Nothing (first phase of this milestone)
**Requirements**: DATA-01, DATA-02
**Success Criteria** (what must be TRUE):

  1. Every ingredient item in Zoho Inventory has its Subcategory custom field set to one of: Grain, Yeast, Additive, Packaging, Equipment, Hops, or uncategorized
  2. The nightly snapshot JSON file includes the subcategory field for each ingredient item
  3. Client-side filtering by subcategory value returns the correct items on a local test page

**Plans**: 2 plans
Plans:
**Wave 1**

- [x] 20-01-PLAN.md — Create bulk tagging script and coverage verification script

**Wave 2**

- [x] 20-02-PLAN.md — Execute tagging workflow and verify 100% coverage

### Phase 21: Shared Template & Build Infrastructure

**Goal**: A single reusable JS module and CSS file can render any category subpage from a per-page config object, and the build pipeline handles all new files
**Depends on**: Phase 20
**Requirements**: TPL-01, TPL-02, TPL-03, TPL-04, BUILD-01
**Success Criteria** (what must be TRUE):

  1. A test HTML page using `16-catalog-subpage.js` with a minimal config renders a product grid from the ingredients API filtered to a single subcategory
  2. Users can switch between grid and list view on the test page
  3. Out-of-stock items display a visible indicator; a category with no items displays a friendly empty-state message
  4. Each subpage's hero section displays the category name with a distinct accent color
  5. `npm run build` completes without errors and produces stamped, minified output for all new CSS and JS files

**Plans**: 2 plans
Plans:
**Wave 1**

- [x] 21-01-PLAN.md — Create 16-catalog-subpage.js standalone module and catalog-subpage.css stylesheet

**Wave 2**

- [x] 21-02-PLAN.md — Test HTML page, unit tests, and build pipeline integration

### Phase 22: Category Subpages & Navigation

**Goal**: Customers can navigate directly to any ingredient category subpage from anywhere on the site, and all 5 category pages are live
**Depends on**: Phase 21
**Requirements**: CAT-01, CAT-02, CAT-03, CAT-04, CAT-05, NAV-01, NAV-02, NAV-03
**Success Criteria** (what must be TRUE):

  1. Each of the 5 subpages (Grains, Yeast, Additives, Packaging, Equipment) loads and shows only its category's items with correct cart controls
  2. A horizontal sub-nav bar appears on every ingredient page showing: All | Hops | Grains | Yeast | Additives | Packaging | Equipment — and the current page's tab is visually highlighted
  3. The main site Products dropdown includes direct links to each ingredient category subpage
  4. Weight-based products on the Grains page offer quantity entry in kg/g as appropriate

**Plans**: 3 plans
Plans:
**Wave 1**

- [x] 22-01-PLAN.md — Sub-nav CSS styles, dropdown divider style, and build pipeline stamp:pages update

**Wave 2** (parallel)

- [x] 22-02-PLAN.md — Create 5 new category subpages, move hops.html, rebuild ingredients-supplies.html
- [x] 22-03-PLAN.md — Update nav dropdown in 9 existing pages and verify navigation end-to-end

### Phase 23: Cross-Category Search

**Goal**: Customers can search across all ingredient categories from a single entry point and jump directly to any matching item
**Depends on**: Phase 22
**Requirements**: SRCH-01, SRCH-02
**Success Criteria** (what must be TRUE):

  1. Triggering the search icon in the sub-nav opens an overlay with a text input; typing at least 2 characters shows results grouped by category
  2. Clicking a search result navigates to that item's category subpage with the item's detail panel already expanded

**Plans**: 2 plans
**UI hint**: yes
Plans:
**Wave 1**

- [x] 23-01-PLAN.md — Create search overlay module, CSS, and fix data-sku gap

**Wave 2**

- [x] 23-02-PLAN.md — Wire overlay into 7 HTML pages, build pipeline, and unit tests

### Phase 24: SEO & Staging Deploy

**Goal**: Each subpage is discoverable by search engines and the full feature set is verified on staging
**Depends on**: Phase 23
**Requirements**: BUILD-02
**Success Criteria** (what must be TRUE):

  1. Each subpage has a unique title tag, meta description, og:title, og:description, canonical URL, and LocalBusiness JSON-LD
  2. sitemap.xml includes entries for all 5 new subpages
  3. All 5 subpages load correctly on staging.steinsandvines.ca with no console errors

**Plans**: 2 plans
Plans:
**Wave 1**

- [x] 24-01-PLAN.md — Add full SEO head (unique title, description, og:*, twitter:card, LocalBusiness JSON-LD) to all 5 category subpages

**Wave 2**

- [x] 24-02-PLAN.md — Build, stamp, push to staging, and QA-verify all 5 subpages load clean on staging.steinsandvines.ca

### Phase 25: Cal.com Booking Migration

**Goal**: Appointment booking runs on Cal.com Cloud (free tier) behind the unchanged `/api/bookings*` middleware contract, supporting multiple appointment types, with customer/staff confirmation emails delivered by Cal.com over HTTPS
**Depends on**: (new milestone v4.0 — no prior phase dependency)
**Requirements**: BOOK-01, BOOK-02, BOOK-03, BOOK-04, BOOK-05
**Success Criteria** (what must be TRUE):

  1. `GET /api/bookings/services`, `GET /api/bookings/availability`, `GET /api/bookings/slots`, and `POST /api/bookings` return the same response shapes as today, now backed by Cal.com (frontend unchanged)
  2. A completed ferment-in-store checkout creates a real Cal.com booking and the customer receives a Cal.com confirmation email (verified end-to-end on staging)
  3. At least one additional appointment type beyond ferment-in-store is bookable through Cal.com
  4. Zoho Bookings code paths (`bookingsGet`/`bookingsPost`, `ZOHO_BOOKINGS_*` env) are removed or disabled with no dead references; offline-fallback behavior preserved
  5. Middleware test suite covers the new Cal.com adapter (request/response mapping, error + offline-fallback paths) and passes; lint clean

**Plans**: 4 plans (3 waves)
- [x] 25-01-PLAN.md — Free-tier risk gate + Cal.com adapter (lib/calcom.js) + env registration
- [ ] 25-02-PLAN.md — Rewrite /api/bookings* handlers onto Cal.com, preserving the contract
- [ ] 25-03-PLAN.md — POST /api/webhooks/calcom (signature-verified, cache invalidation)
- [ ] 25-04-PLAN.md — Staging booking+email verification, additional event type, Zoho removal

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-4 | v1.0 | 8/8 | Complete | 2026-04-28 |
| 5-11 | v1.1 | 24/24 | Complete | 2026-05-06 |
| 12-19 | v2.0 | 26/26 | Complete | 2026-05-27 |
| 20. Zoho Data Foundation | v3.0 | 2/2 | Complete | 2026-05-28 |
| 21. Shared Template & Build Infrastructure | v3.0 | 2/2 | Complete   | 2026-05-29 |
| 22. Category Subpages & Navigation | v3.0 | 3/3 | Complete   | 2026-05-29 |
| 23. Cross-Category Search | v3.0 | 2/2 | Complete    | 2026-05-30 |
| 24. SEO & Staging Deploy | v3.0 | 2/2 | Complete    | 2026-06-03 |
| 25. Cal.com Booking Migration | v4.0 | 1/4 | In Progress|  |
